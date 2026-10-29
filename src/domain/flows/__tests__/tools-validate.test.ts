import { describe, expect, it } from 'vitest';
import { definitionSchema, hasCommandNode, validateDefinition } from '../definition';
import { getTool, TOOLS } from '../tools';
import { absPath, appDir, relPath } from '../tools/validate';

describe('where a tool may aim (security review, D-063)', () => {
  it.each(['/www/wwwroot/butik.example.com', '/home/deploy/apps/butik', '/var/www/app', '/opt/apps/x'])('accepts the application folder %s', (p) => {
    expect(appDir.safeParse(p).success).toBe(true);
  });
  it.each(['/home/deploy/.ssh', '/home/deploy/.config/app', '/.hidden', '/etc/ssh', '/etc', '/root/app', '/usr/local/bin', '/bin', '/proc/1', '/home/x/../etc', '/', '/a b', '/a;b', 'relative/dir', '/www/wwwroot/x/'])('refuses %s', (p) => {
    expect(appDir.safeParse(p).success).toBe(false);
  });
  it('a path under a folder may not be hidden or climb out', () => {
    for (const p of ['storage/backups', 'bootstrap/cache', 'public/build']) expect(relPath.safeParse(p).success).toBe(true);
    for (const p of ['.ssh', '.ssh/authorized_keys', 'a/.git', '../x', 'a/../b', '/abs']) expect(relPath.safeParse(p).success).toBe(false);
  });
  it('absPath alone still refuses the root and dot segments', () => {
    expect(absPath.safeParse('/').success).toBe(false);
    expect(absPath.safeParse('/a/../b').success).toBe(false);
  });
});

describe('which tools only the Owner may put in a flow (BR-M17-18)', () => {
  it('a free command and a free file write both are, and nothing else', () => {
    expect(TOOLS.filter((t) => t.ownerOnly).map((t) => t.id).sort()).toEqual(['ssh.run_command', 'ssh.write_file']);
  });
  it('a flow with a file write counts as holding a command, so an Admin cannot save it', () => {
    const def = definitionSchema.parse({
      slots: [{ name: 'server', kind: 'ssh' }],
      nodes: [{ id: 'w', tool: 'ssh.write_file', bind: { ssh: 'server' }, config: { path: '/home/deploy/.ssh/authorized_keys', content: 'ssh-ed25519 AAAA attacker' } }],
    });
    expect(hasCommandNode(def)).toBe(true);
    expect(validateDefinition(def, { canUseCommand: false }).problems.map((p) => p.code)).toContain('command_not_allowed');
    expect(validateDefinition(def, { canUseCommand: true }).problems).toEqual([]);
  });
  it('no other tool takes a path that is not an application folder', () => {
    // every `dir` of the SSH tools is validated by `appDir`: aim each at the server's own configuration and see it refused
    for (const id of ['ssh.git_clone', 'ssh.git_update', 'ssh.composer_install', 'ssh.npm', 'ssh.artisan', 'ssh.prepare_folders', 'ssh.pm2', 'ssh.env_set']) {
      const tool = getTool(id)!;
      const base: Record<string, unknown> = { repo: 'a/b', branch: 'main', script: 'ci', command: 'migrate', action: 'start', entries: 'A=1', create: '', writable: '' };
      expect(tool.schema.safeParse({ ...base, dir: '/home/deploy/.ssh' }).success, `${id} must refuse a hidden folder`).toBe(false);
      expect(tool.schema.safeParse({ ...base, dir: '/etc/ssh' }).success, `${id} must refuse /etc`).toBe(false);
      expect(tool.schema.safeParse({ ...base, dir: '/www/wwwroot/app.example.com' }).success, `${id} must accept an application folder`).toBe(true);
    }
  });
});
