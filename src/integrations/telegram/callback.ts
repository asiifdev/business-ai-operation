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
