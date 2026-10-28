import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { approvals, telegramUpdates } from '../../db/schema';
import { parseApprovalCallback } from '../../integrations/telegram/callback';
import type { InlineKeyboard, TelegramClient } from '../../integrations/telegram/client';
import { TelegramError } from '../../integrations/telegram/errors';
import { parseStartCommand } from '../../integrations/telegram/pairing';
import { spokenText } from '../../integrations/speech/spoken';
import { answerToTelegramParts, escapeHtml } from '../../integrations/telegram/text';
import type { TelegramMessage, TelegramUpdate } from '../../integrations/telegram/webhook';
import type { Clock } from '../../lib/clock';
import { formatDate, formatDateTime, formatRupiah } from '../../lib/format';
import { translate, type Locale, type MessageKey } from '../../lib/i18n';
import { limiter } from '../../lib/rate-limit';
import { decideApproval, listPendingApprovals } from '../action-center/approvals';
import { countOpenFindings } from '../action-center/findings';
import { recordAudit } from '../audit/service';
import { listInvoices } from '../billing/invoices';
import { userCtx, type Ctx } from '../ctx';
import { DomainError } from '../errors';
import { can } from '../permissions';
import { MAX_DURATION_MS } from '../meetings/rules';
import { createMeeting } from '../meetings/service';
import { getTaskSummary, listTasks } from '../tasks/service';
import { outcomeText, tasksMessage, type DecisionOutcome } from './cards';
import { findLinkedUser, redeemPairingCode, unlinkChat, type LinkedUser } from './links';

/** What the handler needs from the outside world, so tests can pass fakes and never reach Telegram or a model. */
export interface BotDeps {
  client: Pick<TelegramClient, 'sendMessage' | 'editMessageText' | 'answerCallbackQuery' | 'sendChatAction' | 'downloadFile'> & Partial<Pick<TelegramClient, 'sendVoice'>>;
  clock: Clock;
  /** Public address of the web app, for links in messages. */
  appUrl?: string;
  /** Free text goes to the grounded assistant (M07). Left out, the bot answers with the command list instead. */
  ask?: (ctx: Ctx, question: string, person: LinkedUser, opts?: { spoken?: boolean }) => Promise<string>;
  /** Reads an answer aloud (D-052). Left out, or returning null, the answer stays text only. */
  speak?: (text: string, locale: 'id' | 'en', ctx: Ctx, person: LinkedUser) => Promise<{ ogg: Uint8Array; durationMs: number } | null>;
  /** Short speech to text for a chat voice note (M09 STT). Left out, a voice note is treated as a meeting recording. */
  transcribe?: (ctx: Ctx, audio: Uint8Array, person: LinkedUser) => Promise<{ ok: true; text: string } | { ok: false; message: string }>;
}

/** A voice note up to this long is a message to the assistant; anything longer is a recording (PRD section 6). */
const CHAT_VOICE_MAX_MS = 3 * 60_000;

/** Free-text questions per person per minute: each one is a model call that spends the organization's budget. */
const ASK_PER_MINUTE = 6;

const localeOf = (languageCode: string | undefined): Locale => (languageCode?.toLowerCase().startsWith('en') ? 'en' : 'id');
const ctxOf = (p: LinkedUser, clock: Clock): Ctx => userCtx({ orgId: p.orgId, userId: p.userId, role: p.role }, clock);

/**
 * One webhook update (PRD section 6). Telegram is only another door to the same services as the web: no business rule
 * lives here. Each `update_id` is handled once, however often Telegram resends it. Group chats, other bots and chats
 * that are not linked get nothing about any organization.
 */
export async function handleUpdate(update: TelegramUpdate, deps: BotDeps): Promise<void> {
  const fresh = await db.insert(telegramUpdates).values({ updateId: update.update_id }).onConflictDoNothing().returning({ id: telegramUpdates.updateId });
  if (fresh.length === 0) return;

  if (update.message) return onMessage(update.message, deps);
  if (update.callback_query) return onCallback(update.callback_query, update.update_id, deps);
  if (update.my_chat_member && update.my_chat_member.chat.type === 'private' && update.my_chat_member.new_chat_member.status === 'kicked') {
    // The person blocked the bot: the documented signal (skill section 4). Stop sending there.
    await unlinkChat(update.my_chat_member.chat.id, deps.clock, 'blocked');
  }
}

async function send(deps: BotDeps, chatId: number, text: string, keyboard?: InlineKeyboard) {
  try {
    await deps.client.sendMessage({ chatId, text, parseMode: 'HTML', replyMarkup: keyboard, disablePreview: true });
  } catch (err) {
    if (err instanceof TelegramError && err.kind === 'blocked') await unlinkChat(chatId, deps.clock, 'blocked');
    else throw err;
  }
}

async function onMessage(message: TelegramMessage, deps: BotDeps) {
  if (message.chat.type !== 'private' || !message.from || message.from.is_bot) return;
  const chatId = message.chat.id;
  const text = message.text?.trim() ?? '';
  const start = parseStartCommand(text);

  if (start) {
    const locale = localeOf(message.from.language_code);
    if (!start.code) {
      const known = await findLinkedUser(chatId);
      return send(deps, chatId, escapeHtml(translate(known?.locale ?? locale, known ? 'tgWelcomeBack' : 'tgWelcome', { name: known?.name ?? '' })));
    }
    const person = await redeemPairingCode(start.code, { id: chatId, username: message.from.username }, deps.clock);
    if (!person) return send(deps, chatId, escapeHtml(translate(locale, 'tgLinkFailed')));
    return send(deps, chatId, `${escapeHtml(translate(person.locale, 'tgLinked', { name: person.name, org: person.organizationName }))}\n\n${helpText(person.locale)}`);
  }

  const person = await findLinkedUser(chatId);
  if (!person) return send(deps, chatId, escapeHtml(translate(localeOf(message.from.language_code), 'tgNotLinked')));
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(person.locale, key, vars);
  const ctx = ctxOf(person, deps.clock);

  const command = /^\/([a-z_]+)(?:@\w+)?\b/i.exec(text)?.[1]?.toLowerCase();
  switch (command) {
    case 'bantuan':
    case 'help':
      return send(deps, chatId, helpText(person.locale));
    case 'status':
      return send(deps, chatId, await statusText(ctx, person.locale));
    case 'overdue':
      return send(deps, chatId, await overdueText(ctx, person.locale));
    case 'tugas':
    case 'tasks':
      return send(deps, chatId, tasksMessage(person.locale, await listTasks(ctx, { assignee: 'me' }), deps.appUrl));
    case 'putus':
    case 'unlink':
      await unlinkChat(chatId, deps.clock, 'command');
      return send(deps, chatId, escapeHtml(t('tgUnlinked')));
    case undefined:
      break;
    default:
      return send(deps, chatId, `${escapeHtml(t('tgUnknownCommand'))}\n\n${helpText(person.locale)}`);
  }

  const audio = message.voice ?? message.audio;
  if (audio) return onVoice(audio, { forceMeeting: Boolean(message.audio) || /^\/(rapat|meeting)\b/i.test(message.caption?.trim() ?? '') }, ctx, person, deps);
  if (message.photo) return send(deps, chatId, escapeHtml(t('tgMediaLater')));
  if (!text) return;
  if (!deps.ask) return send(deps, chatId, helpText(person.locale));
  if (!limiter.allow(`telegram-ask:${person.userId}`, ASK_PER_MINUTE, 60_000)) return send(deps, chatId, escapeHtml(t('tgSlowDown')));

  // The words are data for the grounded assistant, never a command: it can read and draft, and anything risky becomes
  // an approval that a person decides (CR-12).
  await deps.client.sendChatAction(chatId, 'typing').catch(() => undefined);
  const answer = await deps.ask(ctx, text.slice(0, 2000), person);
  for (const part of answerToTelegramParts(answer)) await send(deps, chatId, part);
}

/**
 * A short voice note is a message to the assistant (D-050): it is transcribed and answered like typed text, in text.
 * A recording becomes a meeting only on purpose: an audio file, a caption starting with /rapat, or a voice note longer
 * than three minutes. Then it is downloaded (at most 20 MB), stored and processed by the same job as an upload on the
 * web. The person sent their own voice, which stands for the consent the web form asks for (BR-M09-11, D-047). The
 * summary comes back to this chat when it is ready (see `notifyLinkedUsers`).
 */
async function onVoice(voice: NonNullable<TelegramMessage['voice']>, opts: { forceMeeting: boolean }, ctx: Ctx, person: LinkedUser, deps: BotDeps) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(person.locale, key, vars);
  if (voice.duration * 1000 > MAX_DURATION_MS) return send(deps, person.chatId, escapeHtml(t('mtErrTooLong')));
  let bytes: Uint8Array;
  try {
    bytes = await deps.client.downloadFile(voice.file_id);
  } catch (err) {
    if (err instanceof TelegramError && err.kind === 'too_large') return send(deps, person.chatId, escapeHtml(t('tgVoiceTooLarge')));
    throw err;
  }
  const asChat = !opts.forceMeeting && voice.duration * 1000 <= CHAT_VOICE_MAX_MS && deps.transcribe && deps.ask;
  if (asChat) return onVoiceChat(bytes, ctx, person, deps);
  try {
    const title = t('tgVoiceTitle', { when: formatDateTime(deps.clock.now(), person.timezone) });
    await createMeeting(ctx, { title, consent: true }, { bytes, name: 'voice.ogg' }, { source: 'telegram' });
  } catch (err) {
    if (err instanceof DomainError && err.code === 'validation') return send(deps, person.chatId, escapeHtml(t('mtErrUnreadable')));
    throw err;
  }
  return send(deps, person.chatId, escapeHtml(t('tgVoiceReceived')));
}

/** The words of a short voice note go to the assistant like typed text, and the answer comes back as a voice note when it can. */
async function onVoiceChat(bytes: Uint8Array, ctx: Ctx, person: LinkedUser, deps: BotDeps) {
  const t = (key: MessageKey) => translate(person.locale, key);
  if (!limiter.allow(`telegram-ask:${person.userId}`, ASK_PER_MINUTE, 60_000)) return send(deps, person.chatId, escapeHtml(t('tgSlowDown')));
  await deps.client.sendChatAction(person.chatId, 'typing').catch(() => undefined);
  const heard = await deps.transcribe!(ctx, bytes, person);
  if (!heard.ok) return send(deps, person.chatId, escapeHtml(heard.message));
  const words = heard.text.trim().slice(0, 2000);
  if (!words) return send(deps, person.chatId, escapeHtml(t('tgVoiceUnclear')));
  const answer = await deps.ask!(ctx, words, person, { spoken: Boolean(deps.speak && deps.client.sendVoice) });
  if (await replyAloud(answer, ctx, person, deps)) return;
  for (const part of answerToTelegramParts(answer)) await send(deps, person.chatId, part);
}

/**
 * Someone who spoke gets the answer as a voice note and nothing else (D-052). Text is the fallback and is sent when the
 * answer cannot be spoken: no speech engine, a voice that failed, an answer that is not Indonesian, or one too long to
 * read aloud whole (a list of invoices is better read than heard). Returns whether the voice note went out.
 */
async function replyAloud(answer: string, ctx: Ctx, person: LinkedUser, deps: BotDeps): Promise<boolean> {
  const chatId = person.chatId;
  if (!deps.speak || !deps.client.sendVoice) return false;
  const words = spokenText(answer);
  if (!words) return false;
  try {
    await deps.client.sendChatAction(chatId, 'record_voice').catch(() => undefined);
    const voice = await deps.speak(words.text, words.locale, ctx, person);
    if (!voice) return false;
    await deps.client.sendVoice({ chatId, bytes: voice.ogg, durationSeconds: voice.durationMs / 1000 });
    return true;
  } catch (err) {
    if (err instanceof TelegramError && err.kind === 'blocked') {
      await unlinkChat(chatId, deps.clock, 'blocked');
      return true; // nobody is there to read the text either
    }
    return false;
  }
}

function helpText(locale: Locale): string {
  const t = (key: MessageKey) => translate(locale, key);
  return [`<b>${escapeHtml(t('tgHelpTitle'))}</b>`, escapeHtml(t('tgHelpCommands')), '', escapeHtml(t('tgHelpFreeText'))].join('\n');
}

/** `/status`: the same counts as the web, through the same services, limited to what this person may see. */
async function statusText(ctx: Ctx, locale: Locale): Promise<string> {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const [findings, pending, tasks] = await Promise.all([countOpenFindings(ctx), listPendingApprovals(ctx), getTaskSummary(ctx)]);
  const lines = [
    `<b>${escapeHtml(t('tgStatusTitle'))}</b>`,
    `${escapeHtml(t('briefingOpenFindings'))}: ${findings}`,
    `${escapeHtml(t('briefingPending'))}: ${pending.filter((p) => p.canDecide).length}`,
    `${escapeHtml(t('taskSumLate'))}: ${tasks.late} · ${escapeHtml(t('taskSumMine'))}: ${tasks.mine}`,
  ];
  if (can(ctx.role, 'billing.read')) {
    const overdue = (await listInvoices(ctx, { overdue: true })).filter((i) => i.overdue);
    lines.push(`${escapeHtml(t('tgOverdueCount'))}: ${overdue.length} · ${formatRupiah(overdue.reduce((sum, i) => sum + i.balance, 0))}`);
  }
  return lines.join('\n');
}

/** `/overdue`: invoices past their due date with their balance, read from billing (managers only, PRD section 3). */
async function overdueText(ctx: Ctx, locale: Locale): Promise<string> {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  if (!can(ctx.role, 'billing.read')) return escapeHtml(t('tgOverdueNoRight'));
  const overdue = (await listInvoices(ctx, { overdue: true })).filter((i) => i.overdue).sort((a, b) => b.daysOverdue - a.daysOverdue);
  if (overdue.length === 0) return escapeHtml(t('tgNoOverdue'));
  const lines = [`<b>${escapeHtml(t('tgOverdueTitle'))}</b>`];
  for (const i of overdue.slice(0, 15)) {
    lines.push(`• ${escapeHtml(i.number ?? '-')} · ${escapeHtml(i.clientName)} · ${formatRupiah(i.balance)} · ${formatDate(i.dueDate)} (${t('tgDaysLate', { n: i.daysOverdue })})`);
  }
  lines.push('', `${escapeHtml(t('factBalance'))}: ${formatRupiah(overdue.reduce((sum, i) => sum + i.balance, 0))}`);
  return lines.join('\n');
}

type Callback = NonNullable<TelegramUpdate['callback_query']>;

/**
 * A button press on an approval card. The data is not trusted (skill section 6): the presser must be a linked, active
 * person; the approval is looked up in their organization; the decision goes through `decideApproval`, the very function
 * behind the web button, so permission is checked again and web plus Telegram at once still decide only once.
 */
async function onCallback(cb: Callback, updateId: number, deps: BotDeps) {
  const parsed = parseApprovalCallback(cb.data);
  const person = await findLinkedUser(cb.from.id);
  const locale = person?.locale ?? localeOf(cb.from.language_code);
  if (!parsed || !person) {
    await deps.client.answerCallbackQuery({ id: cb.id, text: translate(locale, person ? 'tgApprovalGone' : 'tgNotLinked'), showAlert: !person });
    return;
  }
  const ctx = ctxOf(person, deps.clock);
  const [row] = await db
    .select({ tool: approvals.tool, rationale: approvals.rationale })
    .from(approvals)
    .where(and(eq(approvals.orgId, person.orgId), eq(approvals.id, parsed.approvalId)));

  if (parsed.action === 'd') {
    await deps.client.answerCallbackQuery({ id: cb.id });
    const link = deps.appUrl ? `\n\n<a href="${escapeHtml(`${deps.appUrl.replace(/\/$/, '')}/app/action-center`)}">${escapeHtml(translate(locale, 'tgOpenInApp'))}</a>` : '';
    return send(deps, person.chatId, row ? `${escapeHtml(row.rationale)}${link}` : escapeHtml(translate(locale, 'tgApprovalGone')));
  }

  const decision = parsed.action === 'y' ? 'approve' : 'reject';
  let outcome: DecisionOutcome;
  try {
    const result = await decideApproval(ctx, parsed.approvalId, { decision });
    outcome = result.executed ? 'approved' : decision === 'reject' ? 'rejected' : 'refused';
    await recordAudit(db, { orgId: person.orgId, actor: `user:${person.userId}`, userId: person.userId }, { action: 'telegram.approval_decided', entityType: 'approval', entityId: parsed.approvalId, summary: { decision, outcome, updateId } });
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    outcome = err.code === 'already_decided' || err.code === 'expired' || err.code === 'forbidden' ? err.code : 'not_found';
  }

  const { toast, line } = outcomeText(locale, outcome, person.name);
  await deps.client.answerCallbackQuery({ id: cb.id, text: toast, showAlert: outcome === 'forbidden' || outcome === 'refused' });
  // A press without the right (or on an approval this person cannot see) leaves the card as it is; every other outcome
  // replaces the buttons with the result.
  if (outcome === 'forbidden' || outcome === 'not_found' || !cb.message) return;
  const head = row ? `<b>${escapeHtml(translate(locale, 'apTitle'))}</b>\n${escapeHtml(row.rationale)}\n\n` : '';
  await deps.client.editMessageText({ chatId: cb.message.chat.id, messageId: cb.message.message_id, text: `${head}${line}`, parseMode: 'HTML' }).catch((err) => {
    if (!(err instanceof TelegramError && err.kind === 'bad_request')) throw err; // the card is gone or unchanged
  });
}
