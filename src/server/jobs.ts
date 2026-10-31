import { enqueueJob } from '../domain/jobs/queue';
import { executeRun, RunBusy } from '../domain/flows/engine';
import { markMeetingFailedIfStuck, processMeeting } from './meeting-process';
import { renderVideo } from './video-render';
import { ensureWorker, PermanentJobError, type JobHandler, type JobType } from './worker';

/**
 * Every background job type and its handler. A meeting whose retries ran out is marked failed with a plain message, so
 * the page never shows "processing" forever.
 */
export const JOB_HANDLERS: Record<JobType, JobHandler> = {
  // A flow run (D-061). Busy (another worker, or one of its servers is in use) is not an error: it waits and tries again.
  'flow.run': async (payload, job) => {
    const runId = String(payload.runId ?? '');
    try {
      return { outcome: await executeRun(runId) };
    } catch (err) {
      if (err instanceof RunBusy) {
        await enqueueJob((await import('../db/client')).db, { orgId: job.orgId ?? '', type: 'flow.run', payload: { runId }, runAfter: new Date(Date.now() + 15_000) });
        return { outcome: 'busy' };
      }
      throw err;
    }
  },
  // A slideshow video built from a saved script (D-086). Failures are final and said on the project, never retried.
  'video.render': async (payload) => renderVideo(payload),
  'meeting.process': async (payload, job) => {
    try {
      return await processMeeting(payload);
    } catch (err) {
      if (!(err instanceof PermanentJobError) && job.attempts >= job.maxAttempts) {
        await markMeetingFailedIfStuck(String(payload.meetingId ?? ''), 'Pemrosesan gagal setelah beberapa percobaan. Coba proses ulang nanti.');
      }
      throw err;
    }
  },
};

/** Starts the job worker for this process (once). */
export const startJobs = () => ensureWorker(JOB_HANDLERS);
