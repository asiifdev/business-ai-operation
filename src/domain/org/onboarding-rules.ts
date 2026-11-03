import { z } from 'zod';

/** First-run wizard steps in the order the person walks them (D-095). */
export const ONBOARDING_STEPS = ['profile', 'finance', 'assistant', 'product', 'client', 'team', 'telegram'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Steps without which the system is not really usable: they feed invoices, the AI's grounding and the catalogue. */
export const REQUIRED_STEPS: readonly OnboardingStep[] = ['profile', 'finance', 'product'];

/** Steps that only the Owner may finish, because the settings they write are Owner-only (BR-M01-07, D-082). */
export const OWNER_STEPS: readonly OnboardingStep[] = ['finance', 'assistant'];

export const stepSchema = z.object({ step: z.enum(ONBOARDING_STEPS) });

export type StepStatus = 'done' | 'skipped' | 'todo';

/** What the data says about each step. Every flag is read from real rows, never from a "finished" button. */
export interface OnboardingFacts {
  profileFilled: boolean;
  bankFilled: boolean;
  productWithPackage: boolean;
  hasClient: boolean;
  activeUsers: number;
  telegramLinked: boolean;
}

export interface OnboardingProgress {
  skipped?: string[];
  confirmed?: string[];
}

export interface OnboardingStepState {
  step: OnboardingStep;
  status: StepStatus;
  required: boolean;
  ownerOnly: boolean;
}

export interface OnboardingState {
  steps: OnboardingStepState[];
  /** Whole percent of the steps that are done (skipped ones do not count). */
  percent: number;
  /** Every required step is done. */
  ready: boolean;
  /** First step that still needs attention (not done, not skipped), or null. */
  next: OnboardingStep | null;
  completedAt: string | null;
}

function isDone(step: OnboardingStep, f: OnboardingFacts, p: OnboardingProgress): boolean {
  switch (step) {
    case 'profile': return f.profileFilled;
    case 'finance': return f.bankFilled;
    case 'assistant': return (p.confirmed ?? []).includes('assistant');
    case 'product': return f.productWithPackage;
    case 'client': return f.hasClient;
    case 'team': return f.activeUsers >= 2;
    case 'telegram': return f.telegramLinked;
  }
}

/** Pure: facts + what the person set aside -> the state the wizard and the dashboard card show. */
export function computeOnboarding(facts: OnboardingFacts, progress: OnboardingProgress, completedAt: Date | null): OnboardingState {
  const skipped = new Set(progress.skipped ?? []);
  const steps = ONBOARDING_STEPS.map<OnboardingStepState>((step) => ({
    step,
    status: isDone(step, facts, progress) ? 'done' : skipped.has(step) ? 'skipped' : 'todo',
    required: REQUIRED_STEPS.includes(step),
    ownerOnly: OWNER_STEPS.includes(step),
  }));
  const done = steps.filter((s) => s.status === 'done').length;
  return {
    steps,
    percent: Math.round((done / steps.length) * 100),
    ready: steps.filter((s) => s.required).every((s) => s.status === 'done'),
    next: steps.find((s) => s.status === 'todo')?.step ?? null,
    completedAt: completedAt ? completedAt.toISOString() : null,
  };
}

/** A profile counts as filled once the AI has something to say about the business: what it does and which field. */
export const profileIsFilled = (p: { industry: string | null; description: string | null }) => Boolean(p.industry?.trim() && p.description?.trim());
