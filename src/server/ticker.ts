import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { organizations } from '../db/schema';
import { generateDailyBriefing } from '../domain/action-center/briefing';
import { explainPendingFindings } from '../domain/action-center/explain';
import { runActionCenterRules, sweepActionCenter } from '../domain/action-center/rules';
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

/** Everything that runs once a day per organization, at its scheduler hour: billing rules first, then the Action Center's. */
export async function runDailyRules(orgId: string, now: Date) {
  const billing = await runBillingRules(orgId, now);
  const actions = await runActionCenterRules(orgId, now);
  return { ...billing, ...actions };
}

/**
 * Optional work around the daily rules. Off by default so tests of the ticker touch nothing else; `ensureTicker` turns
 * all of it on. `sweep` runs every tick; `afterDaily` and `briefing` call the model, so they run outside the lock's
 * transaction (a slow model call must not hold the ticker's connection) and each failure is only logged.
 */
export interface TickHooks {
  sweep?: (orgId: string, now: Date) => Promise<unknown>;
  afterDaily?: (orgId: string, clock: Clock) => Promise<unknown>;
  briefing?: (orgId: string, clock: Clock) => Promise<unknown>;
}

/**
 * One pass of the ticker (PRD section 7): under the advisory lock, find every organization whose scheduler hour has come
 * and which this process has not swept today, and run the daily rules for it. A second process, or a second tick, does
 * no harm: nothing is made twice, because each rule goes through `automation.once`. Returns the organizations it ran for.
 */
export async function runTick(state: TickState, clock: Clock = systemClock, runRules: (orgId: string, now: Date) => Promise<unknown> = runDailyRules, hooks: TickHooks = {}): Promise<string[]> {
  const ran: string[] = [];
  const briefingDue: Array<{ orgId: string; key: string; today: string }> = [];
  await db.transaction(async (tx) => {
    const [{ locked }] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${TICKER_LOCK_KEY}) as locked`);
    if (!locked) return; // another process is ticking
    const orgs = await tx.select({ id: organizations.id, timezone: organizations.timezone, hour: organizations.schedulerHour, briefingHour: organizations.briefingHour }).from(organizations);
    const now = clock.now();
    for (const org of orgs) {
      const today = todayIn(org.timezone, now);
      if (hooks.sweep) {
        try {
          await hooks.sweep(org.id, now);
        } catch (err) {
          console.error(`ticker: sweep failed for ${org.id}`, err instanceof Error ? err.message : err);
        }
      }
      const briefingKey = `briefing:${org.id}`;
      if (hooks.briefing && state.get(briefingKey) !== today && localHour(org.timezone, now) >= org.briefingHour) briefingDue.push({ orgId: org.id, key: briefingKey, today });
      if (state.get(org.id) === today || localHour(org.timezone, now) < org.hour) continue;
      try {
        await runRules(org.id, now);
        state.set(org.id, today);
        ran.push(org.id);
      } catch (err) {
        console.error(`ticker: daily rules failed for ${org.id}; will retry on the next tick`, err instanceof Error ? err.message : err);
      }
    }
  });

  for (const orgId of ran) {
    if (!hooks.afterDaily) break;
    await hooks.afterDaily(orgId, clock).catch((err) => console.error(`ticker: follow-up failed for ${orgId}`, err instanceof Error ? err.message : err));
  }
  for (const due of briefingDue) {
    try {
      await hooks.briefing!(due.orgId, clock);
      state.set(due.key, due.today);
    } catch (err) {
      console.error(`ticker: briefing failed for ${due.orgId}; will retry on the next tick`, err instanceof Error ? err.message : err);
    }
  }
  return ran;
}

const globalForTicker = globalThis as unknown as { __ticker?: ReturnType<typeof setInterval> };

/** Explanations the scheduler prepares per organization per day; a person can always ask for more from the card. */
const AUTO_EXPLAIN_PER_DAY = 3;

/** Starts the ticker once per process. `SCHEDULER=off` turns it off (for example on a replica that should not run jobs). */
export function ensureTicker(): void {
  if (globalForTicker.__ticker || process.env.SCHEDULER === 'off') return;
  const state: TickState = new Map();
  const hooks: TickHooks = {
    sweep: sweepActionCenter,
    afterDaily: (orgId, clock) => explainPendingFindings(orgId, clock, AUTO_EXPLAIN_PER_DAY),
    briefing: (orgId, clock) => generateDailyBriefing(orgId, clock),
  };
  const tick = () => void runTick(state, systemClock, runDailyRules, hooks).catch((err) => console.error('ticker failed', err instanceof Error ? err.message : err));
  globalForTicker.__ticker = setInterval(tick, INTERVAL_MS);
  globalForTicker.__ticker.unref(); // never keeps the process alive by itself
  console.log('scheduler started: daily rules at each organization\'s scheduler hour, briefing at its briefing hour, housekeeping every minute');
  setTimeout(tick, 5_000).unref(); // do not wait a whole minute after a restart
}
