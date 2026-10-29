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
  /** Panels often use a self-signed certificate. Off unless the owner chose to accept that risk (⚠️ skill §6). */
  tlsInsecure?: boolean;
}

export type AapanelFailure = 'unreachable' | 'timeout' | 'rejected' | 'unexpected';
export class AapanelError extends Error {
  constructor(public readonly kind: AapanelFailure) {
    super(kind);
    this.name = 'AapanelError';
  }
}

/** POST form request, as community clients report (⚠️ the docs show query strings). The response body is returned as text. */
export function aapanelPost(cfg: AapanelConfig, apiKey: string, path: string, form: Record<string, string> = {}, now: () => number = () => Math.floor(Date.now() / 1000)): Promise<{ status: number; body: string }> {
  const url = new URL(path, cfg.url);
  const body = new URLSearchParams({ ...form, ...signRequest(apiKey, now()) }).toString();
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) }, timeout: 15_000, ...(url.protocol === 'https:' ? { rejectUnauthorized: !cfg.tlsInsecure } : {}) },
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

/**
 * Checks that the panel answers a signed request. ⚠️ Which path a given panel version serves is unproven: the docs show
 * `/v2/data?action=getData`, older panels use `/data?action=getData`. A wrong key or an address missing from the panel's
 * IP whitelist is reported by some panels as 404 (forum reports), so a 404 is described as "rejected".
 */
export async function aapanelPing(cfg: AapanelConfig, apiKey: string): Promise<'ok'> {
  let lastStatus = 0;
  for (const path of ['/v2/data?action=getData', '/data?action=getData']) {
    const r = await aapanelPost(cfg, apiKey, path, { table: 'sites', limit: '1', p: '1', search: '', order: '', type: '-1' });
    lastStatus = r.status;
    if (r.status === 200) {
      try {
        const json = JSON.parse(r.body) as unknown;
        if (json && typeof json === 'object' && (json as { status?: unknown }).status === false) throw new AapanelError('rejected');
        return 'ok';
      } catch (e) {
        if (e instanceof AapanelError) throw e;
        // Not JSON: probably the panel's login or 404 page.
      }
    }
  }
  throw new AapanelError(lastStatus === 404 || lastStatus === 401 || lastStatus === 403 ? 'rejected' : 'unexpected');
}
