import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import type { Db } from '../db/client';
import { AiRun, type AiRunStatus, type ToolLogEntry } from '../domain/ai/runs';
import { requestApproval as defaultRequestApproval } from '../domain/approvals/service';
import type { Ctx } from '../domain/ctx';
import { DomainError } from '../domain/errors';
import { can } from '../domain/permissions';
import { AiProviderError, type AiErrorKind } from './errors';
import { AI_LABEL, NOT_AI_LABEL, NO_DATA_REFUSAL, OUT_OF_SCOPE_REFUSAL, detectLocale, friendlyAiError, type Locale } from './messages';
import { findUnverifiedNumbers } from './numbers';
import type { AiProvider } from './provider';
import type { ToolRegistry } from './tools/registry';
import type { ChatMessage, ChatRequest, Effort } from './types';
import { UNTRUSTED_NOTICE } from './untrusted';

/** BR-M07-06 default: five rounds of tool calls per run. */
export const DEFAULT_MAX_ROUNDS = 5;
/** Input plus output tokens one run may use across all rounds (BR-M07-06, CR-11). */
export const DEFAULT_MAX_RUN_TOKENS = 60_000;
/** Longest tool result handed to the model. A larger one is replaced by an error rather than cut in half. */
const MAX_TOOL_RESULT_CHARS = 20_000;
/** Two broken tool calls in one run end it: a model that cannot form arguments should not keep burning budget. */
const MAX_INVALID_CALLS = 2;

export interface AgentInput {
  provider: AiProvider;
  db: Db;
  ctx: Ctx;
  registry: ToolRegistry;
  /** Our own trusted instructions for this feature. */
  instructions: string;
  /** The conversation. Anything from outside (documents, chat, transcripts) must already be wrapped with `wrapUntrusted`. */
  messages: ChatMessage[];
  effort: Effort;
  maxTokens: number;
  feature?: 'agent' | 'minutes';
  model?: string;
  maxRounds?: number;
  maxRunTokens?: number;
  /** Ask for the final answer as JSON (structured output). Validate it with Zod afterwards. */
  schema?: ChatRequest['schema'];
  cacheKey?: string;
  locale?: Locale;
  inputSummary?: string;
  entityType?: string;
  entityId?: string;
  /** The finding this run explains, when an `act` tool proposes a follow-up for it. */
  findingId?: string | null;
  /**
   * `strict` (the assistant): no tool result, no answer. A final answer must follow at least one successful tool call and
   * may only contain numbers that appear in tool results; otherwise the model gets one correction and then the fixed
   * "no data" text replaces its answer. `advisory` (the assistant): the model may talk, discuss and recommend without a
   * tool call, but numbers still have to come from tool results and out-of-scope questions still end in the fixed refusal.
   * `none` (extraction from text we provide): the default.
   */
  grounding?: 'strict' | 'advisory' | 'none';
  /** Extra values the answer may mention that did not come from a tool, such as today's date. */
  trustedNumbers?: string[];
  requestApproval?: typeof defaultRequestApproval;
}

export interface AgentResult {
  ok: boolean;
  /** "AI-assisted" when it worked, "this is not an AI result" when it did not (BR-M07-11). */
  label: string;
  status: AiRunStatus;
  text: string | null;
  json?: unknown;
  /** Friendly explanation when `ok` is false. */
  message?: string;
  errorKind?: AiErrorKind | 'rounds' | 'tool_args' | 'run_tokens';
  runId: string | null;
  rounds: number;
  costMicroUsd: number;
  tools: ToolLogEntry[];
  pendingApprovals: Array<{ id: string; tool: string }>;
  /** Numbers in the answer that no tool result contained (BR-M07-10). The caller decides what to do with them. */
  unverifiedNumbers: string[];
  /** True when the answer followed at least one successful tool result (always true for a normal strict answer). */
  grounded: boolean;
  /** True when `text` is a fixed refusal instead of a model answer (strict grounding only). */
  refused: boolean;
  refusalReason?: 'no_data' | 'out_of_scope' | 'unverified_numbers';
  /** Tools whose results the answer rests on, in order of first use. Shown to the user as the sources. */
  sources: string[];
}

const toJson = (value: unknown) => JSON.stringify(value);

/**
 * The agent loop (BRD-M07 §4). It checks the budget, offers the model only the tools the user's role may use, runs
 * `read` and `draft` tools straight away through their service, and turns an `act` tool into a pending approval that a
 * human decides later. It stops at a final answer, at the round limit or at the token limit, and always writes the run.
 * Failures come back as `ok: false` with a friendly message, never as an exception the page cannot handle.
 */
export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const locale = input.locale ?? 'id';
  const feature = input.feature ?? 'agent';
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxRunTokens = input.maxRunTokens ?? DEFAULT_MAX_RUN_TOKENS;
  const ask = input.requestApproval ?? defaultRequestApproval;

  const failed = (kind: AgentResult['errorKind'], message: string, run: AiRun | null, rounds: number, status: AiRunStatus = 'error'): AgentResult => ({
    ok: false,
    label: NOT_AI_LABEL[locale],
    status,
    text: null,
    message,
    errorKind: kind,
    runId: run?.id ?? null,
    rounds,
    costMicroUsd: run?.spentMicroUsd ?? 0,
    tools: [...(run?.toolLog ?? [])],
    pendingApprovals: [],
    unverifiedNumbers: [],
    grounded: false,
    refused: false,
    sources: [],
  });

  let run: AiRun;
  try {
    run = await AiRun.start(input.db, input.ctx, {
      feature,
      model: input.model ?? 'muse-spark-1.3',
      inputSummary: input.inputSummary,
      entityType: input.entityType,
      entityId: input.entityId,
    });
  } catch (error) {
    if (error instanceof AiProviderError) return failed(error.kind, friendlyAiError(error.kind, locale), null, 0, error.kind === 'budget' ? 'blocked_budget' : 'error');
    throw error;
  }

  const aiCtx = run.ctx;
  const offered = input.registry.specsFor(input.ctx.role);
  const messages: ChatMessage[] = [{ role: 'developer', content: `${input.instructions}\n\n${UNTRUSTED_NOTICE}` }, ...input.messages];
  const safetyIdentifier = createHash('sha256').update(`${input.ctx.orgId}:${input.ctx.userId}`).digest('hex').slice(0, 32);
  const toolOutputs: string[] = [];
  const pendingApprovals: Array<{ id: string; tool: string }> = [];
  let invalidCalls = 0;
  let rejectedCall = false;
  let outOfScope = false;
  let corrections = 0;
  let rounds = 0;
  const strict = input.grounding === 'strict';
  const guarded = strict || input.grounding === 'advisory';
  // Fixed refusals follow the language the person wrote in, not only their interface language.
  const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
  const refusalLocale = detectLocale(typeof lastUser?.content === 'string' ? lastUser.content : '', locale);
  const sourcesOf = () => [...new Set(run.toolLog.filter((t) => t.status === 'ok').map((t) => t.name))];

  const stop = async (kind: AgentResult['errorKind'], message: string, error: string, status: AiRunStatus = 'error'): Promise<AgentResult> => {
    await run.finish(status, { error });
    return failed(kind, message, run, rounds, status);
  };

  /** Runs one tool call the model asked for and returns the text to hand back to it. Never throws. */
  const execute = async (call: { id: string; name: string; argumentsJson: string }, round: number): Promise<string> => {
    const tool = input.registry.get(call.name);
    const log = (status: ToolLogEntry['status']) => run.addTool({ round, name: call.name.slice(0, 64), tier: tool?.tier ?? 'unknown', status });

    // Unknown, forbidden, or not allowed for this role: the same answer, and it is recorded (BRD-M07 §10).
    if (!tool || !can(input.ctx.role, tool.permission)) {
      rejectedCall = true;
      log('rejected');
      return toJson({ error: 'tool_tidak_tersedia' });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(call.argumentsJson || '{}');
    } catch {
      invalidCalls += 1;
      log('invalid_args');
      return toJson({ error: 'argumen_bukan_json' });
    }
    const parsed = tool.args.safeParse(raw);
    if (!parsed.success) {
      invalidCalls += 1;
      log('invalid_args');
      // Field names and reasons only, never the values the model sent.
      return toJson({ error: 'argumen_tidak_valid', rincian: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(akar)'}: ${i.message}`) });
    }

    if (tool.tier === 'act') {
      const describe = tool.describe as (args: unknown) => string;
      const approval = await ask(input.db, aiCtx, { tool: tool.name, args: parsed.data, rationale: describe(parsed.data), findingId: input.findingId ?? null });
      pendingApprovals.push({ id: approval.id, tool: tool.name });
      log('pending_approval');
      return toJson({ status: 'menunggu_persetujuan_manusia', approvalId: approval.id, catatan: 'Aksi belum dijalankan. Seorang manusia harus menyetujuinya lebih dulu.' });
    }

    try {
      const output = await (tool.run as (ctx: Ctx, args: unknown) => Promise<unknown>)(aiCtx, parsed.data);
      const text = toJson(output ?? null);
      if (text.length > MAX_TOOL_RESULT_CHARS) {
        log('failed');
        return toJson({ error: 'hasil_terlalu_besar', catatan: 'Persempit permintaan, misalnya dengan batas jumlah.' });
      }
      log('ok');
      toolOutputs.push(text);
      if (output && typeof output === 'object' && (output as { outOfScope?: unknown }).outOfScope === true) outOfScope = true;
      return text;
    } catch (error) {
      log('failed');
      // A business-rule refusal is safe and useful to tell the model; anything else is not.
      // The reason is what lets the assistant explain a refusal and suggest a fix (duplicate name, wrong state, a field out of range).
      if (error instanceof DomainError) return toJson({ error: error.code, ...(error.message && error.message !== error.code ? { alasan: error.message } : {}) });
      if (error instanceof ZodError) return toJson({ error: 'validasi', rincian: error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(akar)'}: ${i.message}`) });
      return toJson({ error: 'gagal_dijalankan' });
    }
  };

  try {
    for (rounds = 1; rounds <= maxRounds; rounds += 1) {
      if (rounds > 1) await run.assertBudget();
      if (run.tokens >= maxRunTokens) return await stop('run_tokens', friendlyAiError('timeout', locale), 'run token limit reached');

      const result = await input.provider.chat({
        messages,
        tools: offered.length ? offered : undefined,
        schema: input.schema,
        effort: input.effort,
        maxTokens: input.maxTokens,
        model: input.model,
        cacheKey: input.cacheKey,
        safetyIdentifier,
      });
      run.addChat(result.meta.model, result.usage);

      if (result.toolCalls.length === 0) {
        const text = result.text ?? '';
        const unverified = findUnverifiedNumbers(text, toolOutputs, input.trustedNumbers);
        const grounded = toolOutputs.length > 0;

        if (guarded && ((strict && !grounded) || unverified.length > 0)) {
          // One correction, then the fixed refusal: the model's own words are never shown when they rest on nothing.
          if (corrections < 1 && rounds < maxRounds) {
            corrections += 1;
            messages.push({ role: 'assistant', content: text });
            messages.push({
              role: 'developer',
              content: grounded || !strict
                ? `Jawaban Anda memuat angka yang tidak ada di hasil tool (${unverified.join(', ')}). Tulis ulang hanya dengan angka dari hasil tool, atau hapus angka itu.`
                : 'Anda belum memanggil tool. Jangan jawab dari pengetahuan sendiri: panggil tool yang relevan, atau panggil report_out_of_scope bila tidak ada tool yang cocok.',
            });
            continue;
          }
          const reason = grounded || !strict ? 'unverified_numbers' : 'no_data';
          await run.finish('ok', { outputSummary: `refused: ${reason}` });
          return {
            ok: true,
            label: NOT_AI_LABEL[locale],
            status: 'ok',
            text: NO_DATA_REFUSAL[refusalLocale],
            runId: run.id,
            rounds,
            costMicroUsd: run.spentMicroUsd,
            tools: [...run.toolLog],
            pendingApprovals,
            unverifiedNumbers: unverified,
            grounded,
            refused: true,
            refusalReason: reason,
            sources: sourcesOf(),
          };
        }

        const status: AiRunStatus = rejectedCall ? 'rejected_tool' : 'ok';
        await run.finish(status, { outputSummary: text });
        return {
          ok: true,
          label: AI_LABEL[locale],
          status,
          text,
          json: result.json,
          runId: run.id,
          rounds,
          costMicroUsd: run.spentMicroUsd,
          tools: [...run.toolLog],
          pendingApprovals,
          unverifiedNumbers: unverified,
          grounded,
          refused: false,
          sources: sourcesOf(),
        };
      }

      messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) messages.push({ role: 'tool', toolCallId: call.id, content: await execute(call, rounds) });
      if (guarded && outOfScope) {
        await run.finish('ok', { outputSummary: 'refused: out_of_scope' });
        return {
          ok: true,
          label: NOT_AI_LABEL[locale],
          status: 'ok',
          text: OUT_OF_SCOPE_REFUSAL[refusalLocale],
          runId: run.id,
          rounds,
          costMicroUsd: run.spentMicroUsd,
          tools: [...run.toolLog],
          pendingApprovals,
          unverifiedNumbers: [],
          grounded: false,
          refused: true,
          refusalReason: 'out_of_scope',
          sources: [],
        };
      }
      if (invalidCalls >= MAX_INVALID_CALLS) {
        return await stop('tool_args', friendlyAiError('invalid_output', locale), 'the model sent invalid tool arguments twice');
      }
    }
    rounds = maxRounds;
    return await stop('rounds', friendlyAiError('timeout', locale), `tool round limit (${maxRounds}) reached`);
  } catch (error) {
    if (error instanceof AiProviderError) {
      // A call that used tokens but gave nothing usable still costs money.
      if (error.details.usage) run.addChat(input.model ?? 'muse-spark-1.3', error.details.usage);
      return await stop(error.kind, friendlyAiError(error.kind, locale), `${error.kind}: ${error.message}`, error.kind === 'budget' ? 'blocked_budget' : 'error');
    }
    await run.finish('error', { error: 'unexpected error' });
    throw error;
  }
}
