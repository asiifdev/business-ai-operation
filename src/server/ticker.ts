import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { organizations } from '../db/schema';
import { runBillingRules } from '../domain/billing/rules';
import { todayIn } from '../domain/billing/dates';
import { type Clock, systemClock } from '../lib/clock';

/** Arbitrary but fixed: every server process asks for the same advisory lock, so only one runs a tick at a time. */
export const TICKER_LOCK_KEY = 7_003_001;
const INTERVAL_MS = 60_000;

/** What this process already did today, per organization. Only an optimization: the rules themselves are idempotent. */
export type TickState = Map<string, string>;

/** The organization's local hour (0-23) at `now`. */
export function localHour(timeZone: string, now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(now)) % 24;
}

/**
 * One pass of the ticker (PRD section 7): under the advisory lock, find every organization whose scheduler hour has come
 * and which this process has not swept today, and run the billing rules for it. A second process, or a second tick, does
 * no harm: nothing is made twice, because each rule goes through `automation.once`. Returns the organizations it ran for.
 */
export async function runTick(state: TickState, clock: Clock = systemClock, runRules: typeof runBillingRules = runBillingRules): Promise<string[]> {
  const ran: string[] = [];
  await db.transaction(async (tx) => {
    const [{ locked }] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${TICKER_LOCK_KEY}) as locked`);
    if (!locked) return; // another process is ticking
    const orgs = await tx.select({ id: organizations.id, timezone: organizations.timezone, hour: organizations.schedulerHour }).from(organizations);
    const now = clock.now();
    for (const org of orgs) {
      const today = todayIn(org.timezone, now);
      if (state.get(org.id) === today || localHour(org.timezone, now) < org.hour) continue;
      try {
        await runRules(org.id, now);
        state.set(org.id, today);
        ran.push(org.id);
      } catch (err) {
        console.error(`ticker: billing rules failed for ${org.id}; will retry on the next tick`, err instanceof Error ? err.message : err);
      }
    }
  });
  return ran;
}

const globalForTicker = globalThis as unknown as { __ticker?: ReturnType<typeof setInterval> };

/** Starts the ticker once per process. `SCHEDULER=off` turns it off (for example on a replica that should not run jobs). */
export function ensureTicker(): void {
  if (globalForTicker.__ticker || process.env.SCHEDULER === 'off') return;
  const state: TickState = new Map();
  const tick = () => void runTick(state).catch((err) => console.error('ticker failed', err instanceof Error ? err.message : err));
  globalForTicker.__ticker = setInterval(tick, INTERVAL_MS);
  globalForTicker.__ticker.unref(); // never keeps the process alive by itself
  console.log('scheduler started: billing rules run once a day per organization, at its scheduler hour');
  setTimeout(tick, 5_000).unref(); // do not wait a whole minute after a restart
}
