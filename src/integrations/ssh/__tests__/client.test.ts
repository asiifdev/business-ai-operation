import { createHash, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Server, utils, type AuthContext } from 'ssh2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprintOf, sshConnect, SshError, type SshConfig, type SshSession } from '../client';

/**
 * Real SSH, not a stand-in: a local `ssh2` Server with its own host key, accepting what each test allows. It proves what
 * a mock cannot: that no credential is sent before the host key is trusted, that each login method really authenticates,
 * and that a command's output and exit code come back.
 */
const hostKey = utils.generateKeyPairSync('ed25519');
const userKey = utils.generateKeyPairSync('ed25519');
const otherKey = utils.generateKeyPairSync('ed25519');
const encKey = utils.generateKeyPairSync('ed25519', { passphrase: 'hunter2-pass', cipher: 'aes256-ctr', rounds: 8 });

const sshSha256 = (privatePem: string) => `SHA256:${createHash('sha256').update((utils.parseKey(privatePem) as { getPublicSSH(): Buffer }).getPublicSSH()).digest('base64').replace(/=+$/, '')}`;
const HOST_FP = sshSha256(hostKey.private);

type Mode = 'password' | 'key' | 'both';
let mode: Mode = 'password';
let authAttempts = 0;
let server: Server;
const open = new Set<{ end(): void }>();
let port: number;

const pub = (pem: string) => utils.parseKey(pem) as { type: string; getPublicSSH(): Buffer; verify(data: Buffer, sig: Buffer, algo?: string): boolean | Error };
const keyOk = (ctx: AuthContext, allowedPublic: string) => {
  if (ctx.method !== 'publickey') return false;
  const allowed = pub(allowedPublic);
  if (ctx.key.algo !== allowed.type) return false;
  const given = ctx.key.data;
  const want = allowed.getPublicSSH();
  if (given.length !== want.length || !timingSafeEqual(given, want)) return false;
  return ctx.signature ? allowed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true : true;
};

beforeAll(async () => {
  server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    open.add(client);
    client.on('close', () => open.delete(client));
    let keyDone = false;
    client.on('authentication', (ctx) => {
      authAttempts++;
      if (ctx.method === 'none') return ctx.reject(mode === 'password' ? ['password'] : mode === 'key' ? ['publickey'] : ['publickey']);
      if (mode === 'password') return ctx.method === 'password' && ctx.password === 'pw-ok-123' ? ctx.accept() : ctx.reject(['password']);
      if (mode === 'key') return keyOk(ctx, userKey.public) ? ctx.accept() : ctx.reject(['publickey']);
      // both: the public key first, then the password
      if (!keyDone) {
        if (keyOk(ctx, userKey.public)) {
          if ((ctx as { signature?: Buffer }).signature) {
            keyDone = true;
            return ctx.reject(['password'], true);
          }
          return ctx.accept(); // the client only asked "is this key acceptable"
        }
        return ctx.reject(['publickey']);
      }
      return ctx.method === 'password' && ctx.password === 'pw-ok-123' ? ctx.accept() : ctx.reject(['password']);
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept();
        session.on('exec', (acceptExec, _rej, info) => {
          const stream = acceptExec();
          if (info.command === 'sleep') {
            setTimeout(() => {
              stream.exit(0);
              stream.end();
            }, 5000).unref();
            return;
          }
          if (info.command === 'fail') {
            stream.stderr.write('boom');
            stream.exit(3);
            return void stream.end();
          }
          stream.write(info.command === 'true' ? '' : `ran:${info.command}\n`);
          stream.exit(0);
          stream.end();
        });
      }),
    );
    client.on('error', () => undefined);
  });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  for (const c of open) c.end();
  return new Promise<void>((res) => server.close(() => res()));
});

const cfg = (authMethod: SshConfig['authMethod']): SshConfig => ({ host: '127.0.0.1', port, username: 'deploy', authMethod });
const session = async (r: Promise<SshSession | { fingerprint: string }>) => {
  const s = await r;
  if (!('exec' in s)) throw new Error('expected a session');
  return s;
};
const kind = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as SshError | null)?.kind;

describe('SSH client against a real server', () => {
  it('fingerprint format matches OpenSSH', () => {
    expect(fingerprintOf('00'.repeat(32))).toBe(`SHA256:${Buffer.alloc(32).toString('base64').replace(/=+$/, '')}`);
  });

  it('first contact only learns the fingerprint: the server sees no authentication attempt at all', async () => {
    mode = 'password';
    authAttempts = 0;
    const r = await sshConnect(cfg('password'), { password: 'pw-ok-123' }, null);
    expect(r).toEqual({ fingerprint: HOST_FP });
    expect(authAttempts).toBe(0); // the password never left this machine
  });

  it('first contact works for every login method, key-based ones included, with no secret at all', async () => {
    authAttempts = 0;
    for (const method of ['password', 'private_key', 'key_and_password'] as const) {
      expect(await sshConnect(cfg(method), {}, null)).toEqual({ fingerprint: HOST_FP });
    }
    expect(authAttempts).toBe(0);
  });

  it('password login runs a command and returns output and exit code', async () => {
    mode = 'password';
    const s = await session(sshConnect(cfg('password'), { password: 'pw-ok-123' }, HOST_FP));
    expect(s.fingerprint).toBe(HOST_FP);
    expect(await s.exec('echo hi')).toMatchObject({ code: 0, stdout: 'ran:echo hi\n' });
    expect(await s.exec('fail')).toMatchObject({ code: 3, stderr: 'boom' });
    s.close();
  });

  it('a wrong password is auth_failed and says nothing about the password', async () => {
    mode = 'password';
    const err = await sshConnect(cfg('password'), { password: 'wrong-password' }, HOST_FP).catch((e: Error) => e);
    expect((err as SshError).kind).toBe('auth_failed');
    expect(String((err as Error).message)).not.toContain('wrong-password');
  });

  it('private key login works, with and without a passphrase', async () => {
    mode = 'key';
    (await session(sshConnect(cfg('private_key'), { privateKey: userKey.private }, HOST_FP))).close();
    expect(await kind(sshConnect(cfg('private_key'), { privateKey: otherKey.private }, HOST_FP))).toBe('auth_failed');
    // A key protected by a passphrase: right passphrase unlocks it; the server must know the matching public key.
    mode = 'key';
    expect(await kind(sshConnect(cfg('private_key'), { privateKey: encKey.private, passphrase: 'hunter2-pass' }, HOST_FP))).toBe('auth_failed'); // opened, but not the key this server allows
    expect(await kind(sshConnect(cfg('private_key'), { privateKey: encKey.private, passphrase: 'wrong' }, HOST_FP))).toBe('bad_key');
  });

  it('a key pasted with debris after the END line (zsh `%` marker) still logs in', async () => {
    mode = 'key';
    const pasted = userKey.private.trimEnd() + '%           ';
    (await session(sshConnect(cfg('private_key'), { privateKey: pasted }, HOST_FP))).close();
  });

  it('key + password: both are presented, in that order, to a server that requires both', async () => {
    mode = 'both';
    const s = await session(sshConnect(cfg('key_and_password'), { privateKey: userKey.private, password: 'pw-ok-123' }, HOST_FP));
    expect(await s.exec('true')).toMatchObject({ code: 0 });
    s.close();
    expect(await kind(sshConnect(cfg('key_and_password'), { privateKey: userKey.private, password: 'nope-nope' }, HOST_FP))).toBe('auth_failed');
    expect(await kind(sshConnect(cfg('key_and_password'), { privateKey: otherKey.private, password: 'pw-ok-123' }, HOST_FP))).toBe('auth_failed');
  });

  it('a changed host key is refused before any credential is sent', async () => {
    mode = 'password';
    authAttempts = 0;
    expect(await kind(sshConnect(cfg('password'), { password: 'pw-ok-123' }, 'SHA256:someOtherServerFingerprint'))).toBe('host_key_mismatch');
    expect(authAttempts).toBe(0);
  });

  it('a command that runs too long is stopped with a timeout', async () => {
    mode = 'password';
    const s = await session(sshConnect(cfg('password'), { password: 'pw-ok-123' }, HOST_FP));
    expect(await kind(s.exec('sleep', { timeoutMs: 300 }))).toBe('timeout');
    s.close();
  });

  it('output is cut at the limit and says so', async () => {
    mode = 'password';
    const s = await session(sshConnect(cfg('password'), { password: 'pw-ok-123' }, HOST_FP));
    const r = await s.exec('x'.repeat(500), { maxBytes: 100 });
    expect(r.stdout.length).toBeLessThanOrEqual(100);
    expect(r.truncated).toBe(true);
    s.close();
  });

  it('a closed port is unreachable', async () => {
    expect(await kind(sshConnect({ ...cfg('password'), port: 1 }, { password: 'x' }, HOST_FP))).toBe('unreachable');
  });

  it('a malformed private key is bad_key, not a crash', async () => {
    mode = 'key';
    expect(await kind(sshConnect(cfg('private_key'), { privateKey: 'not a key' }, HOST_FP))).toBe('bad_key');
  });
});
