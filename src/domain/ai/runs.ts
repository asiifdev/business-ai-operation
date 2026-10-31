import { eq } from 'drizzle-orm';
import { AiProviderError } from '../../ai/errors';
import { chatCostMicroUsd, imageCostMicroUsd, transcribeCostMicroUsd, webSearchCostMicroUsd } from '../../ai/pricing';
import type { AiFeature, Usage } from '../../ai/types';
import type { Db } from '../../db/client';
import { newId } from '../../db/ids';
import { aiRuns } from '../../db/schema';
import type { Ctx } from '../ctx';
import { getBudgetStatus } from './budget';

export type AiRunStatus = 'ok' | 'error' | 'blocked_budget' | 'rejected_tool';

export type ToolLogStatus = 'ok' | 'rejected' | 'invalid_args' | 'failed' | 'pending_approval';

/** One tool attempt inside a run: what the model asked for and what happened. No arguments or results (BR-M15-06). */
export interface ToolLogEntry {
  round: number;
  name: string;
  tier: 'read' | 'draft' | 'act' | 'unknown';
  status: ToolLogStatus;
}

export interface AiRunStart {
  feature: AiFeature;
  model: string;
  /** Short and free of document text (BR-M15-06). */
  inputSummary?: string;
  entityType?: string;
  entityId?: string;
}

const SUMMARY_MAX = 200;
export const summarize = (text: string | null | undefined): string | null => (text ? text.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX) : null);

/**
 * One row in `ai_runs` per feature run (BRD-M07 §4): an agent run with several rounds is still one row, with the rounds
 * and tools listed in `tools`. The row is written first as an honest "did not finish" error and updated at the end, so
 * a crash never leaves a run that looks successful (and the id exists for approvals and audit to point at).
 */
export class AiRun {
  private inputTokens = 0;
  private outputTokens = 0;
  private audioMs = 0;
  private images = 0;
  private costMicroUsd = 0;
  private readonly tools: ToolLogEntry[] = [];
  private finished = false;

  private constructor(
    private readonly db: Db,
    private readonly baseCtx: Ctx,
    readonly id: string,
    readonly feature: AiFeature,
    private model: string,
  ) {}

  /**
   * Checks today's budget and opens the run. When the budget is spent it records a `blocked_budget` row and throws
   * `AiProviderError('budget')`, so the caller shows "AI budget used up" and every non-AI feature keeps working.
   */
  static async start(db: Db, ctx: Ctx, input: AiRunStart): Promise<AiRun> {
    const id = newId();
    const now = ctx.clock.now();
    const status = await getBudgetStatus(db, ctx.orgId, input.feature, now);
    const base = {
      id,
      orgId: ctx.orgId,
      feature: input.feature,
      onBehalfOf: ctx.userId,
      model: input.model,
      inputSummary: summarize(input.inputSummary),
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      startedAt: now,
    };
    if (status.exhausted) {
      await db.insert(aiRuns).values({ ...base, status: 'blocked_budget', error: 'daily budget used up', finishedAt: now });
      throw new AiProviderError('budget', 'The daily AI budget for this feature is used up');
    }
    await db.insert(aiRuns).values({ ...base, status: 'error', error: 'run did not finish' });
    return new AiRun(db, ctx, id, input.feature, input.model);
  }

  /** The context tools and services run with: still the person's permissions, but the actor is this AI run (BR-M15-02). */
  get ctx(): Ctx {
    return { ...this.baseCtx, actor: `ai:${this.id}`, aiRunId: this.id };
  }

  get spentMicroUsd(): number {
    return this.costMicroUsd;
  }

  get tokens(): number {
    return this.inputTokens + this.outputTokens;
  }

  /** Re-checks the budget between rounds: what earlier runs spent today plus what this run has used so far. */
  async assertBudget(): Promise<void> {
    const status = await getBudgetStatus(this.db, this.baseCtx.orgId, this.feature, this.baseCtx.clock.now());
    if (status.spentMicroUsd + this.costMicroUsd >= status.limitMicroUsd) {
      throw new AiProviderError('budget', 'The daily AI budget for this feature is used up');
    }
  }

  addChat(model: string, usage: Usage): number {
    this.model = model;
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    const cost = chatCostMicroUsd(model, usage);
    this.costMicroUsd += cost;
    return cost;
  }

  addAudio(durationMs: number): number {
    this.audioMs += durationMs;
    const cost = transcribeCostMicroUsd(durationMs);
    this.costMicroUsd += cost;
    return cost;
  }

  addImages(count: number): number {
    this.images += count;
    const cost = imageCostMicroUsd(count);
    this.costMicroUsd += cost;
    return cost;
  }

  addSearches(count: number): number {
    const cost = webSearchCostMicroUsd(count);
    this.costMicroUsd += cost;
    return cost;
  }

  addTool(entry: ToolLogEntry): void {
    this.tools.push(entry);
  }

  get toolLog(): readonly ToolLogEntry[] {
    return this.tools;
  }

  async finish(status: AiRunStatus, extra: { outputSummary?: string | null; error?: string | null } = {}): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    await this.db
      .update(aiRuns)
      .set({
        status,
        model: this.model,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        audioMs: this.audioMs || null,
        images: this.images || null,
        costMicroUsd: this.costMicroUsd,
        tools: this.tools,
        outputSummary: summarize(extra.outputSummary),
        error: status === 'ok' || status === 'rejected_tool' ? null : (summarize(extra.error) ?? 'unknown error'),
        finishedAt: this.baseCtx.clock.now(),
      })
      .where(eq(aiRuns.id, this.id));
  }
}
