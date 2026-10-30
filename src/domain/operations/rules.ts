/**
 * The decisions of the M17 checks, as pure functions so they can be tested without a network or a database. The I/O
 * (HTTP, GitHub, the tables) lives in `checks.ts`.
 */

/** Consecutive failed checks before a site counts as down (PRD M17 "Uptime": two in a row). */
export const DOWN_AFTER_FAILURES = 2;

export type UptimeState = 'up' | 'down';

export interface UptimeBefore {
  state: UptimeState | null;
  failures: number;
}

export interface UptimeAfter {
  state: UptimeState | null;
  failures: number;
  /** True when the state flipped, so `uptime_changed_at` moves (and a down spell gets its own finding). */
  changed: boolean;
}

/**
 * One check's effect on the stored state. A success resets the count and marks the site up. A failure counts; the site
 * only becomes down on the second failure in a row, so one slow answer does not raise an alarm. Until a site has been
 * reached once, a single failure leaves it unknown (null) rather than calling it down.
 */
export function nextUptime(before: UptimeBefore, ok: boolean): UptimeAfter {
  if (ok) return { state: 'up', failures: 0, changed: before.state !== 'up' };
  const failures = before.failures + 1;
  if (failures >= DOWN_AFTER_FAILURES) return { state: 'down', failures, changed: before.state !== 'down' };
  return { state: before.state, failures, changed: false };
}

/** An HTTP answer counts as up when the server answered without a server error. A 404 or a login page is still "up". */
export const answeredUp = (status: number): boolean => status > 0 && status < 500;

/** A domain we are willing to probe: a plain host name, no scheme, port, path or credentials (BR-M17-04 pattern). */
export const PROBE_DOMAIN = /^(?!-)(?!.*\.\.)[a-z0-9.-]{1,253}(?<!-)$/;

/** Whether a deployment is due for another check, given the organization's interval in minutes. */
export function isDue(lastCheckedAt: Date | null, intervalMin: number, now: Date): boolean {
  return lastCheckedAt === null || now.getTime() - lastCheckedAt.getTime() >= intervalMin * 60_000;
}

/**
 * Names reserved by RFC 2606 and RFC 6761 that never exist on the public internet (`.test`, `.example`, `.invalid`,
 * `.localhost`, `example.com/net/org`). Demo data uses them, so they are "not checkable" rather than "down": probing them
 * would only ever fail and fill the Action Center with false alarms.
 */
export function isReservedDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/\.$/, '');
  return /\.(test|example|invalid|localhost)$/.test(d) || d === 'localhost' || /(^|\.)example\.(com|net|org)$/.test(d);
}
