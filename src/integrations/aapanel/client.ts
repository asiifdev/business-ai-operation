import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * aaPanel API client (skill `aapanel-integration`). One connection option standing on its own (D-055). Only the signing
 * rule and the data query are documented; everything else is ⚠️ unproven and not used here yet.
 */

/** `request_token = md5(request_time + md5(api_key))`, both from the same timestamp (official docs). */
export function signRequest(apiKey: string, requestTime: number): { request_time: string; request_token: string } {
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');
  return { request_time: String(requestTime), request_token: md5(String(requestTime) + md5(apiKey)) };
}

export interface AapanelConfig {
  /** `https://host:port`, origin only. */
  url: string;
  /** The address the host name was checked against; the request goes to it, while the name stays for Host, SNI and the certificate. */
  address?: { address: string; family: 4 | 6 };
  /** Panels often use a self-signed certificate. Off unless the owner chose to accept that risk (⚠️ skill §6). */
  tlsInsecure?: boolean;
}

export type AapanelFailure = 'unreachable' | 'timeout' | 'rejected' | 'unexpected';
export class AapanelError extends Error {
  constructor(
    public readonly kind: AapanelFailure,
    /** The panel's own explanation (for example which IP it refused), cleaned and short. Never the API key. */
    public readonly detail?: string,
  ) {
    super(kind);
    this.name = 'AapanelError';
  }
}

/** POST form request, as community clients report (⚠️ the docs show query strings). The response body is returned as text. */
export function aapanelPost(cfg: AapanelConfig, apiKey: string, path: string, form: Record<string, string> = {}, now: () => number = () => Math.floor(Date.now() / 1000)): Promise<{ status: number; body: string }> {
  // The caller resolved and checked the address; connecting to it (not to a fresh DNS answer) keeps the check meaningful.
  const url = new URL(path, cfg.url);
  const body = new URLSearchParams({ ...form, ...signRequest(apiKey, now()) }).toString();
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) }, timeout: 15_000, ...(cfg.address ? { lookup: (_h: string, _o: unknown, cb: (e: null, a: string, f: number) => void) => cb(null, cfg.address!.address, cfg.address!.family) } : {}), ...(url.protocol === 'https:' ? { rejectUnauthorized: !cfg.tlsInsecure } : {}) },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= 256 * 1024) chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('timeout', () => req.destroy(new AapanelError('timeout')));
    req.on('error', (e) => reject(e instanceof AapanelError ? e : new AapanelError('unreachable')));
    req.end(body);
  });
}

/** The panel's `msg`, as plain short text: control characters removed, the key masked in case it was echoed back. */
export function panelMessage(json: unknown, apiKey: string): string | undefined {
  const msg = (json as { msg?: unknown })?.msg;
  if (typeof msg !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const clean = msg.replace(/[\u0000-\u001f\u007f]/g, ' ').split(apiKey).join('••••').trim().slice(0, 200);
  return clean || undefined;
}

/**
 * What a panel's answer means. Success needs a POSITIVE sign (observed on a real panel 2026-10-29): v2 answers
 * `{status: 0, timestamp, message: <data>}`, v1 answers the data itself (`{data: [...], page, ...}`). A refusal is
 * `{status: false, msg}` with HTTP 200 (wrong key: "Secret key verification failed"; wrong IP: "IP validation failed, your
 * access IP is[x]"). Anything else, such as a login page, is "unexpected", never success.
 */
export function interpretAnswer(json: unknown, apiKey: string): { ok: true } | { ok: false; kind: 'rejected' | 'unexpected'; detail?: string } {
  if (!json || typeof json !== 'object') return { ok: false, kind: 'unexpected' };
  const j = json as { status?: unknown; message?: unknown; data?: unknown };
  if (j.status === false) return { ok: false, kind: 'rejected', detail: panelMessage(json, apiKey) };
  if (j.status === 0 && j.message !== undefined) return { ok: true };
  if (Array.isArray(j.data)) return { ok: true };
  return { ok: false, kind: 'unexpected' };
}

/**
 * Checks that the panel answers a signed request. Newer panels serve `/v2/…`, older ones only `/…`; both are tried, and the
 * first positive answer wins. A refusal stops at once: the same key and IP would be refused on the other path too.
 */
export async function aapanelPing(cfg: AapanelConfig, apiKey: string): Promise<'ok'> {
  let sawNotFound = false;
  for (const path of ['/v2/data?action=getData', '/data?action=getData']) {
    const r = await aapanelPost(cfg, apiKey, path, { table: 'sites', limit: '1', p: '1', search: '', order: '', type: '-1' });
    if (r.status === 404 || r.status === 401 || r.status === 403) {
      sawNotFound = true;
      continue;
    }
    if (r.status !== 200) continue;
    let json: unknown;
    try {
      json = JSON.parse(r.body);
    } catch {
      continue; // the panel's login or error page
    }
    const verdict = interpretAnswer(json, apiKey);
    if (verdict.ok) return 'ok';
    if (verdict.kind === 'rejected') throw new AapanelError('rejected', verdict.detail);
  }
  throw new AapanelError(sawNotFound ? 'rejected' : 'unexpected');
}
