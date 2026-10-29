// `ssh2` is a CommonJS package: Node's native ESM loader (the built server) cannot see its named exports, so it is imported
// as a whole and taken apart here. Named imports work under Vitest and tsx and then fail only in `pnpm start`.
import ssh2, { type AuthenticationType, type ClientChannel } from 'ssh2';
import { checkPrivateKey, normalizePrivateKey } from './key';

const { Client } = ssh2;

/**
 * SSH client (skill `ssh-integration`). One connection option among several, standing on its own (D-055). Three ways to log
 * in: password, private key (with an optional passphrase), or key then password (BR-M17-08). The host key is checked every
 * time: against the pinned fingerprint, or, before anything is pinned, only to read the fingerprint, WITHOUT sending any
 * credential, so a password never goes to a server nobody confirmed.
 */
export type AuthMethod = 'password' | 'private_key' | 'key_and_password';

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
}
export interface SshSecret {
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export type SshFailure = 'unreachable' | 'host_key_mismatch' | 'auth_failed' | 'bad_key' | 'timeout' | 'failed';

/** An error whose message never carries a secret, only a kind the UI can explain. */
export class SshError extends Error {
  constructor(public readonly kind: SshFailure) {
    super(kind);
    this.name = 'SshError';
  }
}

export interface SshSession {
  fingerprint: string;
  exec(command: string, opts?: { timeoutMs?: number; maxBytes?: number }): Promise<{ code: number | null; stdout: string; stderr: string; truncated: boolean }>;
  close(): void;
}

/** OpenSSH style: `SHA256:` and the unpadded base64 of the hash. */
export const fingerprintOf = (hexSha256: string) => `SHA256:${Buffer.from(hexSha256, 'hex').toString('base64').replace(/=+$/, '')}`;

function authHandler(cfg: SshConfig, secret: SshSecret) {
  const key = { type: 'publickey' as const, username: cfg.username, key: secret.privateKey ?? '', passphrase: secret.passphrase };
  const password = { type: 'password' as const, username: cfg.username, password: secret.password ?? '' };
  if (cfg.authMethod === 'password') return [password];
  if (cfg.authMethod === 'private_key') return [key];
  // Key then password, for servers that require both (`AuthenticationMethods publickey,password`).
  return (methodsLeft: AuthenticationType[] | null, partialSuccess: boolean | null) => {
    if (methodsLeft === null) return key;
    if (partialSuccess && methodsLeft.includes('password')) return password;
    return false as const;
  };
}

/**
 * Connects and logs in. With `pinned = null` it only learns the fingerprint and stops before authentication, returning
 * `{ fingerprint }` (the caller must ask the user to confirm it). With a fingerprint it must match, or the connection is
 * refused.
 */
export function sshConnect(cfg: SshConfig, secret: SshSecret, pinned: string | null, opts: { readyTimeoutMs?: number } = {}): Promise<SshSession | { fingerprint: string }> {
  // A key that cannot be read, or a wrong passphrase, would otherwise be skipped silently and look like a refused login.
  // The key is tidied first, so one stored with paste debris (an older save) still works. Only when a credential is about to be
  // sent: the first contact (`pinned === null`) just reads the server's fingerprint and has no key to check yet.
  if (pinned !== null && cfg.authMethod !== 'password') {
    const tidy = normalizePrivateKey(secret.privateKey ?? '');
    if (!tidy || checkPrivateKey(tidy, secret.passphrase) !== 'ok') return Promise.reject(new SshError('bad_key'));
    secret = { ...secret, privateKey: tidy };
  }
  return new Promise((resolve, reject) => {
    const client = new Client();
    let seen = '';
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    client.on('ready', () => {
      done(() =>
        resolve({
          fingerprint: seen,
          close: () => client.end(),
          exec: (command, o = {}) =>
            new Promise((res, rej) => {
              const limit = o.maxBytes ?? 64 * 1024;
              let timer: NodeJS.Timeout | undefined;
              client.exec(command, (err, stream: ClientChannel) => {
                if (err) return rej(new SshError('failed'));
                let stdout = '';
                let stderr = '';
                let truncated = false;
                const take = (acc: string, chunk: Buffer) => {
                  const next = acc + chunk.toString('utf8');
                  if (next.length > limit) {
                    truncated = true;
                    return next.slice(0, limit);
                  }
                  return next;
                };
                stream.on('data', (c: Buffer) => (stdout = take(stdout, c)));
                stream.stderr.on('data', (c: Buffer) => (stderr = take(stderr, c)));
                stream.on('close', (code: number | null) => {
                  if (timer) clearTimeout(timer);
                  res({ code, stdout: stdout.slice(0, limit), stderr: stderr.slice(0, limit), truncated });
                });
                if (o.timeoutMs) {
                  timer = setTimeout(() => {
                    stream.close();
                    rej(new SshError('timeout'));
                  }, o.timeoutMs);
                }
              });
            }),
        }),
      );
    });
    client.on('error', (e: Error & { level?: string }) => {
      client.end();
      done(() => {
        if (pinned === null && seen) return resolve({ fingerprint: seen }); // we aborted on purpose to read the fingerprint
        if (seen && pinned && seen !== pinned) return reject(new SshError('host_key_mismatch'));
        if (e.level === 'client-authentication') return reject(new SshError('auth_failed'));
        if (/Cannot parse privateKey|passphrase|Malformed|Unsupported key/i.test(e.message)) return reject(new SshError('bad_key'));
        if (/timed out|Timed out/i.test(e.message)) return reject(new SshError('timeout'));
        reject(new SshError(/ECONN|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EAI_AGAIN/.test(e.message) ? 'unreachable' : 'failed'));
      });
    });
    client.on('close', () => done(() => (pinned === null && seen ? resolve({ fingerprint: seen }) : reject(new SshError('failed')))));
    try {
      client.connect({
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        authHandler: authHandler(cfg, secret),
        readyTimeout: opts.readyTimeoutMs ?? 15_000,
        keepaliveInterval: 10_000,
        hostHash: 'sha256',
        // Without this the library accepts any host key.
        hostVerifier: (hash: string) => {
          seen = fingerprintOf(hash);
          if (pinned === null) return false; // learn the fingerprint, send no credential
          return seen === pinned;
        },
      });
    } catch {
      done(() => reject(new SshError('bad_key')));
    }
  });
}
