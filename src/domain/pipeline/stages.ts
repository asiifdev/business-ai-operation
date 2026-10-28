import { addDays } from '../billing/dates';

export const STAGES = ['new', 'exploring', 'proposal', 'negotiation', 'won', 'lost'] as const;
export type Stage = (typeof STAGES)[number];

/** The stages a lead moves through while it is still being worked (BR-M04-01). */
export const OPEN_STAGES = ['new', 'exploring', 'proposal', 'negotiation'] as const satisfies readonly Stage[];

export const isOpenStage = (stage: Stage): boolean => (OPEN_STAGES as readonly Stage[]).includes(stage);
export const isFinalStage = (stage: Stage): boolean => !isOpenStage(stage);

/**
 * Where a lead may go from a stage (BR-M04-02). Default rule, awaiting the owner's decision (D-045): an open lead moves one
 * step forward or any number of steps back, can be lost from any open stage, and can only be won from Proposal or
 * Negotiation, so a lead cannot jump from New straight to Won. Won and Lost are final here; reopening is a separate,
 * manager-only action with a note (`reopenLead`).
 */
export function allowedMoves(from: Stage): Stage[] {
  const at = (OPEN_STAGES as readonly Stage[]).indexOf(from);
  if (at === -1) return [];
  const back = OPEN_STAGES.slice(0, at);
  const forward = at < OPEN_STAGES.length - 1 ? [OPEN_STAGES[at + 1]] : [];
  const won: Stage[] = from === 'proposal' || from === 'negotiation' ? ['won'] : [];
  return [...back, ...forward, ...won, 'lost'];
}

export const canMove = (from: Stage, to: Stage): boolean => allowedMoves(from).includes(to);

export interface StagnantInput {
  stage: Stage;
  isDraft: boolean;
  archivedAt: Date | null;
  stageChangedAt: Date;
}

/**
 * A lead is stagnant when it is open, accepted (not an AI draft), not archived, and has stayed in its stage longer than
 * `stagnantDays` (BR-M04-08). Derived from the clock every time; never stored (CR-01).
 */
export function isStagnant(lead: StagnantInput, stagnantDays: number, now: Date): boolean {
  if (!isOpenStage(lead.stage) || lead.isDraft || lead.archivedAt) return false;
  return now.getTime() - lead.stageChangedAt.getTime() > stagnantDays * 24 * 60 * 60 * 1000;
}

/** Whole days a lead has been in its stage, for the card ("12 hari"). */
export function daysInStage(stageChangedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - stageChangedAt.getTime()) / 86_400_000));
}

export interface ValueInput {
  stage: Stage;
  isDraft: boolean;
  archivedAt: Date | null;
  estimatedValue: number | null;
}

/** Pipeline value: the sum of estimated values of open, accepted, unarchived leads (BR-M04-06, -07). The one calculator. */
export function pipelineValue(leads: ValueInput[]): number {
  return leads.reduce((sum, l) => (isOpenStage(l.stage) && !l.isDraft && !l.archivedAt ? sum + (l.estimatedValue ?? 0) : sum), 0);
}

/** The standard onboarding checklist created when a won lead becomes a client (BR-M04-09). */
export const ONBOARDING_CHECKLIST = {
  id: ['Siapkan deployment untuk klien', 'Buat langganan', 'Terbitkan invoice pertama', 'Serah terima ke klien'],
  en: ['Set up the client deployment', 'Create the subscription', 'Issue the first invoice', 'Hand over to the client'],
} as const;

/** A due date a few days out for the checklist items, so they do not all sit undated. */
export const onboardingDueDate = (today: string, index: number): string => addDays(today, 3 * (index + 1));
