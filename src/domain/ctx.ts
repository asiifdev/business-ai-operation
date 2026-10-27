import type { Clock } from '../lib/clock';
import { systemClock } from '../lib/clock';
import type { Role } from './permissions';

/** Who is acting (BR-M15-02): a person, an AI run on someone's behalf, or the system. */
export type Actor = `user:${string}` | `ai:${string}` | `system:${string}`;

/**
 * Built once per request, job or bot update. Every service takes it first.
 * `orgId` always comes from the verified session, never from user input or model output (BR-M01-01).
 */
export interface Ctx {
  orgId: string;
  actor: Actor;
  /** The person whose permissions apply. For AI/Telegram actions this is the user they act for (BR-M01-08). */
  userId: string;
  role: Role;
  /** Set when an AI run acts on behalf of `userId`. */
  aiRunId?: string;
  clock: Clock;
}

export function userCtx(input: { orgId: string; userId: string; role: Role }, clock: Clock = systemClock): Ctx {
  return { ...input, actor: `user:${input.userId}`, clock };
}
