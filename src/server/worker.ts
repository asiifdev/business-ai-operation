import { hostname } from 'node:os';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { jobs } from '../db/schema';
import type { JobType } from '../domain/jobs/queue';
import { type Clock, systemClock } from '../lib/clock';

export type { JobType };

/**
 * The job queue (PRD section 7, D-008): rows in `jobs`, claimed with FOR UPDATE SKIP LOCKED so two processes never take
 * the same one, retried with a growing wait up to `max_attempts`, then left `failed` with the last error. Used for work
 * that is too long for a request: meeting processing now, image generation later.
 */


/** A handler gets the payload and returns a small result to store. A `PermanentJobError` fails at once, without retries. */
export type JobHandler = (payload: Record<string, unknown>, job: { id: string; orgId: string | null; attempts: number; maxAttempts: number }) => Promise<unknown>;

export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/** 30 s, 2 min, 8 min: enough for a rate limit or a brief outage to pass. */
export const retryDelayMs = (attempt: number) => 30_000 * 4 ** Math.max(attempt - 1, 0);

/** A job whose process died mid-run is taken back after this long. Longer than the slowest meeting we accept. */
const STALE_MS = 30 * 60_000;

const WORKER_ID = `${hostname()}:${process.pid}`;

/**
 * Claims and runs at most one due job. Returns whether it found one, so a caller can drain the queue in a loop.
 */
export async function runNextJob(handlers: Partial<Record<JobType, JobHandler>>, clock: Clock = systemClock): Promise<boolean> {
  const types = Object.keys(handlers);
  if (types.length === 0) return false;
  const now = clock.now();
  // Jobs left `running` by a process that died go back to the queue. Queue times are compared with the DATABASE clock
  // (`run_after` defaults to its now()), so a server whose clock is off cannot skip or rush jobs.
  await db
    .update(jobs)
    .set({ status: 'queued', lockedAt: null, lockedBy: null })
    .where(and(eq(jobs.status, 'running'), sql`${jobs.lockedAt} <= now() - ${`${STALE_MS / 1000} seconds`}::interval`));

  const claimed = await db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      select id from ${jobs}
      where status = 'queued' and run_after <= now() and type in (${sql.join(types.map((k) => sql`${k}`), sql`, `)})
      order by run_after
      limit 1
      for update skip locked`);
    const id = rows[0]?.id;
    if (!id) return null;
    const [job] = await tx
      .update(jobs)
      .set({ status: 'running', attempts: sql`${jobs.attempts} + 1`, lockedAt: now, lockedBy: WORKER_ID })
      .where(eq(jobs.id, id))
      .returning();
    return job;
  });
  if (!claimed) return false;

  const handler = handlers[claimed.type as JobType]!;
  try {
    const result = await handler(claimed.payload as Record<string, unknown>, { id: claimed.id, orgId: claimed.orgId, attempts: claimed.attempts, maxAttempts: claimed.maxAttempts });
    await db.update(jobs).set({ status: 'done', result: (result ?? null) as object, finishedAt: clock.now(), lockedAt: null, lockedBy: null }).where(eq(jobs.id, claimed.id));
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    const final = err instanceof PermanentJobError || claimed.attempts >= claimed.maxAttempts;
    await db
      .update(jobs)
      .set(final ? { status: 'failed', lastError: message, finishedAt: clock.now(), lockedAt: null, lockedBy: null } : { status: 'queued', lastError: message, runAfter: new Date(clock.now().getTime() + retryDelayMs(claimed.attempts)), lockedAt: null, lockedBy: null })
      .where(eq(jobs.id, claimed.id));
    console.error(`job ${claimed.type} ${claimed.id} ${final ? 'failed' : 'will retry'}: ${message}`);
  }
  return true;
}

const globalForWorker = globalThis as unknown as { __worker?: ReturnType<typeof setInterval>; __workerBusy?: boolean };

/** Starts polling once per process (every 5 s). `SCHEDULER=off` turns it off together with the ticker. */
export function ensureWorker(handlers: Partial<Record<JobType, JobHandler>>): void {
  if (globalForWorker.__worker || process.env.SCHEDULER === 'off') return;
  const tick = async () => {
    if (globalForWorker.__workerBusy) return; // one job at a time per process: meeting processing is heavy
    globalForWorker.__workerBusy = true;
    try {
      while (await runNextJob(handlers)) {
        /* drain what is due */
      }
    } catch (err) {
      console.error('worker failed', err instanceof Error ? err.message : err);
    } finally {
      globalForWorker.__workerBusy = false;
    }
  };
  globalForWorker.__worker = setInterval(() => void tick(), 5_000);
  globalForWorker.__worker.unref();
}
