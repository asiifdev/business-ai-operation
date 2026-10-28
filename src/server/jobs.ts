import { markMeetingFailedIfStuck, processMeeting } from './meeting-process';
import { ensureWorker, PermanentJobError, type JobHandler, type JobType } from './worker';

/**
 * Every background job type and its handler. A meeting whose retries ran out is marked failed with a plain message, so
 * the page never shows "processing" forever.
 */
export const JOB_HANDLERS: Record<JobType, JobHandler> = {
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
