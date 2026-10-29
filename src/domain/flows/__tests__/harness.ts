import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ssh2 from 'ssh2';
import { aapanelPost } from '../../../integrations/aapanel/client';
import { sshConnect } from '../../../integrations/ssh/client';
import { systemClock } from '../../../lib/clock';
import type { RunServices } from '../engine';

const { Server, utils } = ssh2;

/**
 * A small real world for the flow engine to run in:
 *  - an SSH server that really executes what it is sent (`sh -c`, with the script on stdin) inside a sandbox folder;
 *  - the real `git`, `base64`, `chmod`, `mkdir` and `awk`; only `php`, `composer`, `npm`, `node`, `pm2` and `ss` are small
 *    scripts that record how they were called (nothing here may install anything);
 *  - a local git repository standing in for GitHub;
 *  - an HTTP server that answers like the aaPanel we probed on 2026-10-29 (v2 envelope, signature checked).
 */
export const PANEL_KEY = 'panel-key-for-tests-0123456789abcdef';
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const HOST_KEY = utils.generateKeyPairSync('ed25519');
export const HOST_FINGERPRINT = `SHA256:${createHash('sha256').update((utils.parseKey(HOST_KEY.private) as { getPublicSSH(): Buffer }).getPublicSSH()).digest('base64').replace(/=+$/, '')}`;
export const SSH_PASSWORD = 'pw-for-the-test-server';

export interface World {
  dir: string;
  root: string; // where clients are put (folder_root)
  remotes: string;
  execCommands: string[];
  calls: () => string[];
  failOnce(tool: string): void;
  panel: { databases: Array<{ id: number; name: string }>; proxies: Array<{ id: number; name: string; ps: string; proxy_pass: string }>; hits: string[]; refuseNext?: string };
  services: RunServices;
  close(): Promise<void>;
}

function shim(bin: string, name: string, body: string) {
  const p = join(bin, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

export async function startWorld(options: { listening?: number[] } = {}): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 'orbyte-flow-'));
  const bin = join(dir, 'bin');
  const root = join(dir, 'www');
  const remotes = join(dir, 'remotes');
  mkdirSync(bin);
  mkdirSync(root);
  mkdirSync(join(remotes, 'acme'), { recursive: true });
  writeFileSync(join(dir, '.bash_profile'), `export PATH="${bin}:$PATH"\n`);

  // The tools we do not install: they log the call, and fail when a test asked them to (`fail-<name>` file, once).
  const log = join(dir, 'calls.log');
  for (const t of ['composer', 'npm', 'php', 'pm2', 'node']) {
    shim(bin, t, `echo "${t} $*" >> "${log}"\nif [ -e "${dir}/fail-${t}" ]; then rm -f "${dir}/fail-${t}"; echo "${t} exploded" >&2; exit 1; fi\nif [ "$1" = "--version" ] || [ "$1" = "-v" ]; then echo "9.9.9"; fi\nexit 0`);
  }
  shim(bin, 'ss', `printf 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:*\\n'\n${(options.listening ?? []).map((p) => `printf 'LISTEN 0 4096 127.0.0.1:${p} 0.0.0.0:*\\n'`).join('\n')}`);

  // A repository that stands in for GitHub: `acme/app` with a Laravel-ish layout and a .env.example.
  const bare = join(remotes, 'acme', 'app.git');
  execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', bare]);
  const work = join(dir, 'seed');
  execFileSync('git', ['clone', '--quiet', bare, work], { stdio: 'ignore' });
  writeFileSync(join(work, '.env.example'), 'APP_NAME=Laravel\nAPP_ENV=local\nAPP_DEBUG=true\nDB_CONNECTION=sqlite\nQUEUE_CONNECTION=database\n');
  writeFileSync(join(work, 'ecosystem.config.cjs'), 'module.exports = { apps: [] };\n');
  mkdirSync(join(work, 'storage'));
  mkdirSync(join(work, 'bootstrap', 'cache'), { recursive: true });
  execFileSync('git', ['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']);
  execFileSync('git', ['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'first'], { stdio: 'ignore' });
  execFileSync('git', ['-C', work, 'push', '--quiet', 'origin', 'HEAD:main'], { stdio: 'ignore' });

  // ---- SSH server: really runs the command it is given, with the script on stdin
  const execCommands: string[] = [];
  const sshServer = new Server({ hostKeys: [HOST_KEY.private] }, (client) => {
    client.on('authentication', (ctx) => (ctx.method === 'password' && ctx.password === SSH_PASSWORD ? ctx.accept() : ctx.reject(['password'])));
    client.on('ready', () =>
      client.on('session', (accept) => {
        accept().on('exec', (acceptExec, _rej, info) => {
          execCommands.push(info.command);
          const stream = acceptExec();
          const child = spawn('/bin/sh', ['-c', info.command], { cwd: dir, env: { HOME: dir, PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null' } });
          stream.pipe(child.stdin);
          child.stdout.on('data', (d: Buffer) => stream.write(d));
          child.stderr.on('data', (d: Buffer) => stream.stderr.write(d));
          child.on('close', (code) => {
            stream.exit(code ?? 1);
            stream.end();
          });
        });
      }),
    );
    client.on('error', () => undefined);
  });
  await new Promise<void>((r) => sshServer.listen(0, '127.0.0.1', r));
  const sshPort = (sshServer.address() as AddressInfo).port;
  const open = new Set<{ end(): void }>();
  sshServer.on('connection', (sock) => open.add(sock as unknown as { end(): void }));

  // ---- aaPanel look-alike (shapes from skill section 4b/4c)
  const panel: World['panel'] = { databases: [{ id: 1, name: 'existing_db' }], proxies: [{ id: 1, name: 'existing.example.com', ps: 'someone else', proxy_pass: 'http://localhost:6012' }], hits: [] };
  let nextId = 100;
  const http: HttpServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const form = new URLSearchParams(body);
      const path = (req.url ?? '').split('?')[0];
      const action = new URL(req.url ?? '/', 'http://x').searchParams.get('action');
      const json = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
      const refuse = (msg: string) => json({ status: false, msg });
      const ok = (message: unknown) => json({ status: 0, timestamp: 1, message });
      const t = form.get('request_time') ?? '';
      if (form.get('request_token') !== md5(t + md5(PANEL_KEY))) return refuse('Secret key verification failed');
      panel.hits.push(`${path}${action ? `?action=${action}` : ''} ${form.get('name') ?? form.get('domains') ?? form.get('site_name') ?? ''}`.trim());
      if (panel.refuseNext && (path + (action ?? '')).includes(panel.refuseNext)) {
        panel.refuseNext = undefined;
        return refuse('the panel said no');
      }
      if (path === '/v2/data' && action === 'getData') {
        const search = form.get('search') ?? '';
        if (form.get('table') === 'databases') return ok({ where: '', page: '', data: panel.databases.filter((d) => d.name.includes(search)) });
        return ok({ where: '', page: '', data: [] });
      }
      if (path === '/v2/database' && action === 'AddDatabase') {
        if (panel.databases.some((d) => d.name === form.get('name'))) return refuse('database already exists');
        if ((form.get('password') ?? '').length < 8) return refuse('weak password');
        panel.databases.push({ id: nextId++, name: form.get('name')! });
        return ok({ result: 'ok' });
      }
      if (path === '/v2/database' && action === 'DeleteDatabase') {
        const i = panel.databases.findIndex((d) => d.name === form.get('name') && String(d.id) === form.get('id'));
        if (i < 0) return refuse('no such database');
        panel.databases.splice(i, 1);
        return ok({ result: 'ok' });
      }
      if (path === '/v2/mod/proxy/com/get_list') {
        const search = form.get('search') ?? '';
        return ok({ code: 0, status: 0, msg: '', data: { data: panel.proxies.filter((p) => p.name.includes(search)), page: '' }, timestamp: 1 });
      }
      if (path === '/v2/mod/proxy/com/create') {
        if (panel.proxies.some((p) => p.name === form.get('domains'))) return refuse('proxy already exists');
        panel.proxies.push({ id: nextId++, name: form.get('domains')!, ps: form.get('remark') ?? '', proxy_pass: form.get('proxy_pass') ?? '' });
        return ok({ result: 'ok' });
      }
      if (path === '/v2/mod/proxy/com/delete') {
        const i = panel.proxies.findIndex((p) => p.name === form.get('site_name') && String(p.id) === form.get('id'));
        if (i < 0) return refuse('no such proxy');
        panel.proxies.splice(i, 1);
        return ok({ result: 'ok' });
      }
      return refuse('unknown endpoint');
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const panelUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  const failFlags = new Set<string>();
  const services: RunServices = {
    async ssh() {
      const s = await sshConnect({ host: '127.0.0.1', port: sshPort, username: 'deploy', authMethod: 'password' }, { password: SSH_PASSWORD }, HOST_FINGERPRINT);
      if (!('exec' in s)) throw new Error('no session');
      return s;
    },
    async panel() {
      return async (path, form) => JSON.parse((await aapanelPost({ url: panelUrl }, PANEL_KEY, path, form ?? {})).body);
    },
    async github() {
      return { client: { listRepositories: async () => [{ fullName: 'acme/app', defaultBranch: 'main' }], installationToken: async () => 'ghs_faketoken_for_tests' } as never, installationId: 1 };
    },
    fetch,
    gitBase: `file://${remotes}`,
    clock: systemClock,
  };
  void failFlags;

  return {
    dir,
    root,
    remotes,
    execCommands,
    calls: () => {
      try {
        return execFileSync('cat', [log]).toString().trim().split('\n').filter(Boolean);
      } catch {
        return [];
      }
    },
    failOnce: (tool) => writeFileSync(join(dir, `fail-${tool}`), ''),
    panel,
    services,
    async close() {
      for (const s of open) s.end();
      await new Promise<void>((r) => sshServer.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}
