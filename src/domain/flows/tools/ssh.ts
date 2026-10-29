import { z } from 'zod';
import { shellQuote } from '../template';
import type { ToolContext, ToolDef } from './types';
import { absPath, appDir, branchName, intFrom, relPath, repoName } from './validate';

/** A failed step: the message is for the run view and is already scrubbed of secrets. */
export class ToolError extends Error {
  constructor(message: string, public readonly output?: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/** Scripts go in on stdin of a login shell, so the PATH of the server's own user (nvm, composer, pm2) applies and nothing sits in `ps`. */
const SHELL = `if command -v bash >/dev/null 2>&1; then exec bash -l -s; else exec sh -s; fi`;

/**
 * Where Node tools usually live when they are not on a login shell's PATH: nvm (set up in `~/.bashrc`, which a login shell
 * skips) and the aaPanel Node manager. Only adds folders that exist and only after the normal PATH, so it never hides a tool.
 */
export const PATH_PRELUDE = [
  'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
  '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1',
  'for d in /www/server/nodejs/*/bin "$HOME"/.nvm/versions/node/*/bin /usr/local/bin "$HOME/.local/bin" "$HOME/.npm-global/bin"; do [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$PATH:$d";; esac; done',
  'export PATH',
  '',
].join('\n');

export async function runScript(t: ToolContext, script: string): Promise<{ stdout: string; log: string }> {
  const session = await t.ssh();
  const r = await session.exec(`sh -c ${shellQuote(SHELL)}`, { stdin: PATH_PRELUDE + script, timeoutMs: t.timeoutMs, maxBytes: 64 * 1024 });
  const log = t.scrub(`${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.trim());
  if (r.code !== 0) throw new ToolError(`the command ended with code ${r.code}`, log);
  return { stdout: r.stdout, log };
}

const ssh = ['ssh'] as const;
const sshGithub = ['ssh', 'github'] as const;

/** `https://x-access-token:<token>@host/owner/repo.git` for the real host; a plain path for a local test folder. */
function remoteUrls(base: string, repo: string, token: string) {
  const plain = `${base}/${repo}.git`;
  return { plain, authed: base.startsWith('https://') ? `https://x-access-token:${token}@${base.slice('https://'.length)}/${repo}.git` : plain };
}

async function repoAllowed(t: ToolContext, repo: string) {
  const { client, installationId } = await t.github();
  const repos = await client.listRepositories(installationId);
  if (!repos.some((r) => r.fullName.toLowerCase() === repo.toLowerCase())) throw new ToolError('this repository is not shared with the Orbyte GitHub App');
  return { token: await client.installationToken(installationId) };
}

const checkTools = z.object({ require: z.string().regex(/^[a-z0-9, ]{0,80}$/).default('') });
const listPorts = z.object({ from: intFrom(1, 65535), to: intFrom(1, 65535) });
const gitClone = z.object({ repo: repoName, branch: branchName, dir: appDir });
const gitUpdate = z.object({ dir: appDir, branch: branchName });
const writeFile = z.object({ path: absPath, content: z.string().max(200_000), mode: z.enum(['600', '640', '644']).default('600'), overwrite: z.coerce.boolean().default(false) });
const composer = z.object({ dir: appDir });
const npm = z.object({ dir: appDir, script: z.enum(['ci', 'build']) });
const artisan = z.object({ dir: appDir, command: z.enum(['key_generate', 'storage_link', 'migrate', 'seed', 'config_cache', 'route_cache', 'view_cache', 'event_cache', 'optimize_clear', 'down', 'up']) });
const prepare = z.object({ dir: appDir, create: z.string().max(400).default(''), writable: z.string().max(400).default('') });
const pm2 = z.object({ dir: appDir, action: z.enum(['start', 'reload', 'save']), file: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/).default('ecosystem.config.cjs') });
const command = z.object({ script: z.string().min(1).max(20_000) });

const ARTISAN: Record<z.infer<typeof artisan>['command'], string> = {
  key_generate: 'php artisan key:generate --force',
  storage_link: 'php artisan storage:link --force',
  migrate: 'php artisan migrate --force',
  seed: 'php artisan db:seed --force',
  config_cache: 'php artisan config:cache',
  route_cache: 'php artisan route:cache',
  view_cache: 'php artisan view:cache',
  event_cache: 'php artisan event:cache',
  optimize_clear: 'php artisan optimize:clear',
  down: 'php artisan down',
  up: 'php artisan up',
};

const list = (csv: string, rule: typeof relPath) => csv.split(',').map((s) => s.trim()).filter(Boolean).map((s) => rule.parse(s));

export const sshTools: ToolDef[] = [
  {
    id: 'ssh.check_tools',
    needs: ssh,
    tier: 'read',
    available: true,
    outputs: ['report'],
    schema: checkTools,
    async run(t, input: z.infer<typeof checkTools>) {
      const { stdout, log } = await runScript(t, `for t in php composer node npm pm2 git; do if command -v "$t" >/dev/null 2>&1; then printf '%s: ok\\n' "$t"; else printf '%s: missing\\n' "$t"; fi; done; df -P / | tail -1`);
      const missing = input.require.split(/[ ,]+/).filter(Boolean).filter((name) => new RegExp(`^${name}: missing$`, 'm').test(stdout));
      if (missing.length) throw new ToolError(`missing on the server: ${missing.join(', ')}`, log);
      return { outputs: { report: stdout.trim() }, log };
    },
  },
  {
    id: 'ssh.list_ports',
    needs: ssh,
    tier: 'read',
    available: true,
    outputs: ['ports'],
    schema: listPorts,
    async run(t, input: z.infer<typeof listPorts>) {
      const { stdout } = await runScript(t, `(ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null) | awk '{print $4}'`);
      const ports = [...new Set(stdout.split('\n').map((l) => Number(l.trim().split(':').pop())).filter((n) => Number.isInteger(n) && n >= input.from && n <= input.to))].sort((a, b) => a - b);
      return { outputs: { ports: ports.join(',') }, log: `${ports.length} port(s) in use between ${input.from} and ${input.to}` };
    },
  },
  {
    id: 'ssh.git_clone',
    needs: sshGithub,
    tier: 'change',
    available: true,
    outputs: ['commit'],
    schema: gitClone,
    async run(t, input: z.infer<typeof gitClone>) {
      const { token } = await repoAllowed(t, input.repo);
      t.track(token);
      const { plain, authed } = remoteUrls(t.gitBase, input.repo, token);
      const script = [
        'set -eu',
        'export GIT_TERMINAL_PROMPT=0',
        `dir=${shellQuote(input.dir)}`,
        'if [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then echo "the folder already exists and is not empty" >&2; exit 3; fi',
        'mkdir -p "$(dirname "$dir")"',
        `git clone --quiet --single-branch --branch ${shellQuote(input.branch)} ${shellQuote(authed)} "$dir"`,
        `git -C "$dir" remote set-url origin ${shellQuote(plain)}`,
        'git -C "$dir" rev-parse HEAD',
      ].join('\n');
      const { stdout, log } = await runScript(t, script);
      const commit = stdout.trim().split('\n').pop() ?? '';
      if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new ToolError('the clone did not report a commit', log);
      return { outputs: { commit }, log: `cloned ${input.repo}@${input.branch} at ${commit.slice(0, 7)}` };
    },
  },
  {
    id: 'ssh.git_update',
    needs: sshGithub,
    tier: 'change',
    available: true,
    outputs: ['commit', 'previous_commit'],
    schema: gitUpdate,
    async run(t, input: z.infer<typeof gitUpdate>) {
      // The repository is the one the folder already tracks; the token is only for the fetch.
      const { client, installationId } = await t.github();
      const token = await client.installationToken(installationId);
      t.track(token);
      const script = [
        'set -eu',
        'export GIT_TERMINAL_PROMPT=0',
        `cd ${shellQuote(input.dir)}`,
        'git rev-parse --git-dir >/dev/null',
        'if [ -n "$(git status --porcelain)" ]; then echo "there are local changes in the folder: refusing to update" >&2; exit 4; fi',
        'plain=$(git remote get-url origin)',
        'before=$(git rev-parse HEAD)',
        `case "$plain" in https://github.com/*) authed="https://x-access-token:"${shellQuote(token)}"@github.com/\${plain#https://github.com/}" ;; *) authed="$plain" ;; esac`,
        'trap \'git remote set-url origin "$plain"\' EXIT',
        'git remote set-url origin "$authed"',
        `git fetch --quiet origin ${shellQuote(input.branch)}`,
        'git merge --ff-only --quiet FETCH_HEAD',
        'echo "before=$before"',
        'echo "after=$(git rev-parse HEAD)"',
      ].join('\n');
      const { stdout, log } = await runScript(t, script);
      const before = /^before=([0-9a-f]{40,64})$/m.exec(stdout)?.[1];
      const after = /^after=([0-9a-f]{40,64})$/m.exec(stdout)?.[1];
      if (!before || !after) throw new ToolError('the update did not report its commits', log);
      return { outputs: { commit: after, previous_commit: before }, log: before === after ? 'already up to date' : `updated ${before.slice(0, 7)} to ${after.slice(0, 7)}` };
    },
  },
  {
    id: 'ssh.write_file',
    needs: ssh,
    tier: 'change',
    available: true,
    // Writing any content to any path IS running code on the server (a shell rc file, an authorized key, a script pm2 starts):
    // it is held to the same rule as a free command, Owner only (BR-M17-18, security review, D-063).
    ownerOnly: true,
    outputs: [],
    secretKeys: ['content'],
    schema: writeFile,
    async run(t, input: z.infer<typeof writeFile>) {
      const b64 = Buffer.from(input.content, 'utf8').toString('base64');
      const script = [
        'set -eu',
        'umask 077',
        `path=${shellQuote(input.path)}`,
        `if [ -e "$path" ] && [ ${input.overwrite ? '0' : '1'} = 1 ]; then echo "the file already exists" >&2; exit 5; fi`,
        'mkdir -p "$(dirname "$path")"',
        `printf '%s' ${shellQuote(b64)} | base64 -d > "$path.orbyte-tmp"`,
        `chmod ${input.mode} "$path.orbyte-tmp"`,
        'mv "$path.orbyte-tmp" "$path"',
      ].join('\n');
      await runScript(t, script);
      return { log: `wrote ${input.path} (${input.content.length} characters, mode ${input.mode})` };
    },
  },
  {
    id: 'ssh.composer_install',
    needs: ssh,
    tier: 'change',
    available: true,
    outputs: [],
    minTimeoutMs: 10 * 60_000,
    schema: composer,
    async run(t, input: z.infer<typeof composer>) {
      const { log } = await runScript(t, `set -eu\ncd ${shellQuote(input.dir)}\ncomposer install --no-dev --optimize-autoloader --no-interaction`);
      return { log: log.split('\n').slice(-12).join('\n') };
    },
  },
  {
    id: 'ssh.npm',
    needs: ssh,
    tier: 'change',
    available: true,
    outputs: [],
    minTimeoutMs: 15 * 60_000,
    schema: npm,
    async run(t, input: z.infer<typeof npm>) {
      const cmd = input.script === 'ci' ? 'npm ci --no-audit --no-fund' : 'npm run build';
      const { log } = await runScript(t, `set -eu\ncd ${shellQuote(input.dir)}\n${cmd}`);
      return { log: log.split('\n').slice(-12).join('\n') };
    },
  },
  {
    id: 'ssh.artisan',
    needs: ssh,
    tier: 'change',
    available: true,
    outputs: [],
    minTimeoutMs: 10 * 60_000,
    schema: artisan,
    async run(t, input: z.infer<typeof artisan>) {
      const { log } = await runScript(t, `set -eu\ncd ${shellQuote(input.dir)}\n${ARTISAN[input.command]}`);
      return { log: log.split('\n').slice(-12).join('\n') };
    },
  },
  {
    id: 'ssh.prepare_folders',
    needs: ssh,
    tier: 'change',
    available: true,
    outputs: [],
    schema: prepare,
    async run(t, input: z.infer<typeof prepare>) {
      const make = list(input.create, relPath);
      const writable = list(input.writable, relPath);
      const lines = ['set -eu', `cd ${shellQuote(input.dir)}`, ...make.map((p) => `mkdir -p ${shellQuote(p)}`), ...writable.map((p) => `chmod -R ug+rwX ${shellQuote(p)}`)];
      await runScript(t, lines.join('\n'));
      return { log: `created ${make.length} folder(s), made ${writable.length} writable` };
    },
  },
  {
    id: 'ssh.pm2',
    needs: ssh,
    tier: 'change',
    available: true,
    outputs: [],
    schema: pm2,
    async run(t, input: z.infer<typeof pm2>) {
      const cmd = input.action === 'start' ? `pm2 start ${shellQuote(input.file)}` : input.action === 'reload' ? `pm2 reload ${shellQuote(input.file)} --update-env` : 'pm2 save';
      const { log } = await runScript(t, `set -eu\ncd ${shellQuote(input.dir)}\n${cmd}`);
      return { log: log.split('\n').slice(-12).join('\n') };
    },
  },
  {
    id: 'ssh.run_command',
    needs: ssh,
    tier: 'change',
    available: true,
    ownerOnly: true,
    outputs: ['stdout'],
    contexts: { script: 'shell' },
    secretKeys: ['script'],
    minTimeoutMs: 10 * 60_000,
    schema: command,
    async run(t, input: z.infer<typeof command>) {
      const { stdout, log } = await runScript(t, input.script);
      return { outputs: { stdout: stdout.trim().slice(0, 2000) }, log };
    },
  },
];

const envSet = z.object({ dir: appDir, entries: z.string().min(1).max(20_000), from_example: z.coerce.boolean().default(true) });

/** Laravel (dotenv) value: plain when it is made of safe characters, else double-quoted with `\`, `"` and `$` escaped. */
export const envValue = (v: string): string => (/^[A-Za-z0-9_.:/@+,-]*$/.test(v) ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\n/g, '\\n')}"`);

/** Applies `KEY=value` lines to the text of an env file: replaces the key where it is, appends it where it is not. */
export function applyEnv(base: string, entries: string): string {
  const wanted = new Map<string, string>();
  for (const raw of entries.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    const key = eq > 0 ? line.slice(0, eq).trim() : '';
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) throw new ToolError(`"${line.slice(0, 40)}" is not a KEY=value line (keys are upper case letters, digits and _)`);
    wanted.set(key, envValue(line.slice(eq + 1)));
  }
  const seen = new Set<string>();
  const lines = base.split('\n').map((l) => {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(l);
    if (!m || !wanted.has(m[1])) return l;
    seen.add(m[1]);
    return `${m[1]}=${wanted.get(m[1])}`;
  });
  const extra = [...wanted].filter(([k]) => !seen.has(k)).map(([k, v]) => `${k}=${v}`);
  return `${[...lines.filter((l, i) => !(i === lines.length - 1 && l === '')), ...extra].join('\n')}\n`;
}

sshTools.push({
  id: 'ssh.env_set',
  needs: ssh,
  tier: 'change',
  available: true,
  outputs: [],
  secretKeys: ['entries'],
  schema: envSet,
  async run(t, input: z.infer<typeof envSet>) {
    const dir = shellQuote(input.dir);
    const read = await runScript(t, `set -eu\ncd ${dir}\nif [ -e .env ]; then echo "exists"; elif [ ${input.from_example ? '1' : '0'} = 1 ] && [ -e .env.example ]; then cat .env.example; else echo ""; fi`);
    if (read.stdout.trim() === 'exists') throw new ToolError('the .env file already exists: refusing to overwrite it');
    const content = applyEnv(read.stdout, input.entries);
    const b64 = Buffer.from(content, 'utf8').toString('base64');
    await runScript(t, `set -eu\numask 077\ncd ${dir}\nprintf '%s' ${shellQuote(b64)} | base64 -d > .env.orbyte-tmp\nchmod 600 .env.orbyte-tmp\nmv .env.orbyte-tmp .env`);
    return { log: `wrote .env with ${input.entries.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length} value(s), mode 600` };
  },
});
