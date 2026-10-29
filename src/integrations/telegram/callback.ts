/**
 * `callback_data` for approval buttons: `ap:<approvalId>:<y|n|d>` (PRD §6). Telegram allows 1 to 64 bytes. It carries
 * only an opaque id: the server looks everything else up and re-checks who is pressing (the data is not trusted).
 */
export type ApprovalAction = 'y' | 'n' | 'd';

const PATTERN = /^ap:([0-9A-Za-z_-]{1,40}):([ynd])$/;

export function encodeApprovalCallback(approvalId: string, action: ApprovalAction): string {
  const data = `ap:${approvalId}:${action}`;
  if (!PATTERN.test(data) || Buffer.byteLength(data) > 64) throw new Error('Approval id cannot be used in callback_data');
  return data;
}

export function parseApprovalCallback(data: string | undefined): { approvalId: string; action: ApprovalAction } | null {
  const match = data ? PATTERN.exec(data) : null;
  return match ? { approvalId: match[1], action: match[2] as ApprovalAction } : null;
}

/**
 * Poster buttons (D-066): `pt:<scope>` picks who the poster is about, `pg:<scope>:<purpose>` makes it. `scope` is `o` for the
 * company or a product id; `purpose` is one letter. Like every callback this is only a hint: the server checks who presses.
 */
export const POSTER_PURPOSE_CODE = { launch: 'l', promo: 'p', education: 'e', release: 'r', brand: 'b' } as const;
export type PosterPurpose = keyof typeof POSTER_PURPOSE_CODE;

const POSTER_PICK = /^pt:(o|[0-9A-Za-z_-]{1,40})$/;
const POSTER_MAKE = /^pg:(o|[0-9A-Za-z_-]{1,40}):([lperb])$/;

export function encodePosterPick(scope: string): string {
  const data = `pt:${scope}`;
  if (!POSTER_PICK.test(data) || Buffer.byteLength(data) > 64) throw new Error('Scope cannot be used in callback_data');
  return data;
}

export function encodePosterMake(scope: string, purpose: PosterPurpose): string {
  const data = `pg:${scope}:${POSTER_PURPOSE_CODE[purpose]}`;
  if (!POSTER_MAKE.test(data) || Buffer.byteLength(data) > 64) throw new Error('Scope cannot be used in callback_data');
  return data;
}

export function parsePosterCallback(data: string | undefined): { kind: 'pick'; scope: string } | { kind: 'make'; scope: string; purpose: PosterPurpose } | null {
  if (!data) return null;
  const pick = POSTER_PICK.exec(data);
  if (pick) return { kind: 'pick', scope: pick[1] };
  const make = POSTER_MAKE.exec(data);
  if (!make) return null;
  const purpose = (Object.keys(POSTER_PURPOSE_CODE) as PosterPurpose[]).find((k) => POSTER_PURPOSE_CODE[k] === make[2]);
  return purpose ? { kind: 'make', scope: make[1], purpose } : null;
}
