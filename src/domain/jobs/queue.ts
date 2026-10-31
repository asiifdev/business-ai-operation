import type { Db, Tx } from '../../db/client';
import { jobs } from '../../db/schema';

/** Kinds of background work (PRD section 7). Each has one handler, registered with the worker in `src/server/worker.ts`. */
export type JobType = 'meeting.process' | 'flow.run' | 'video.render';

/** Puts a job in the queue in the caller's transaction, so it exists exactly when the record it works on does. */
export async function enqueueJob(tx: Tx | Db, input: { orgId: string; type: JobType; payload: Record<string, unknown>; runAfter?: Date }): Promise<string> {
  const [row] = await tx.insert(jobs).values({ orgId: input.orgId, type: input.type, payload: input.payload, ...(input.runAfter ? { runAfter: input.runAfter } : {}) }).returning({ id: jobs.id });
  return row.id;
}
