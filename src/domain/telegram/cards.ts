import type { InlineKeyboard } from '../../integrations/telegram/client';
import { encodeApprovalCallback } from '../../integrations/telegram/callback';
import { escapeHtml, escapeHtmlAttr, MAX_MESSAGE } from '../../integrations/telegram/text';
import { formatDate, formatRupiah } from '../../lib/format';
import { translate, type Locale, type MessageKey } from '../../lib/i18n';
import type { ApprovalCard } from '../action-center/approvals';
import type { FindingRule } from '../action-center/facts';
import type { FindingCard } from '../action-center/findings';
import type { TaskRow } from '../tasks/service';

/**
 * What the bot writes, as pure functions of data the services already returned (BR-M08-03: every figure is read from the
 * record, never written by a model). Everything that is not our own markup is escaped, because names, titles and AI text
 * come from people and models (skill telegram-bot-integration section 5).
 */

const RULE: Record<FindingRule, MessageKey> = {
  invoice_overdue: 'ruleInvoiceOverdue',
  invoice_draft_ready: 'ruleInvoiceDraftReady',
  renewal_upcoming: 'ruleRenewalUpcoming',
  task_late: 'ruleTaskLate',
  lead_stagnant: 'ruleLeadStagnant',
  deployment_outdated: 'ruleDeploymentOutdated',
  deployment_down: 'ruleDeploymentDown',
};

const ACT_TOOL: Record<string, MessageKey> = { mark_invoice_sent: 'toolMarkInvoiceSent', finalize_document: 'toolFinalizeDocument' };

/** A link into the web app, or nothing when the app address is unknown. */
const appLink = (appUrl: string | undefined, path: string | null, label: string) =>
  appUrl && path ? `<a href="${escapeHtmlAttr(`${appUrl.replace(/\/$/, '')}${path}`)}">${escapeHtml(label)}</a>` : '';

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The figures of a finding, one or two short lines. */
export function findingFactsLines(locale: Locale, card: Pick<FindingCard, 'facts'>): string[] {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const f = card.facts;
  if (f.kind === 'invoice') {
    const amount = f.status === 'sent' ? `${t('factBalance')}: ${formatRupiah(f.balance)}` : `${t('colTotal')}: ${formatRupiah(f.total)}`;
    const late = f.overdue ? ` · ${t('tgDaysLate', { n: f.daysOverdue })}` : '';
    return [`${escapeHtml(f.number ?? t('factDraftNumber'))} · ${escapeHtml(f.clientName)}`, `${amount} · ${t('fDueDate')}: ${formatDate(f.dueDate)}${late}`];
  }
  if (f.kind === 'subscription') {
    return [`${escapeHtml(f.clientName)} · ${escapeHtml(f.productName)} ${escapeHtml(f.packageName)}`, `${t('colAmount')}: ${formatRupiah(f.amount)} · ${t('fDueDate')}: ${formatDate(f.nextDueDate)}`];
  }
  if (f.kind === 'task') {
    const parts = [f.dueDate ? `${t('fDueDate')}: ${formatDate(f.dueDate)}` : null, f.late ? t('tgDaysLate', { n: f.daysLate }) : null, `${t('factAssignee')}: ${escapeHtml(f.assigneeName ?? t('factNoAssignee'))}`];
    return [`${escapeHtml(f.title)}${f.clientName ? ` · ${escapeHtml(f.clientName)}` : ''}`, parts.filter(Boolean).join(' · ')];
  }
  return [t('factMissing')];
}

/** A finding as a Telegram message: what happened, the figures, the saved AI explanation (labelled), and a link. */
export function findingMessage(locale: Locale, card: Pick<FindingCard, 'rule' | 'facts' | 'explanation' | 'aiRunId' | 'href'>, appUrl?: string): string {
  const t = (key: MessageKey) => translate(locale, key);
  const lines = [`<b>${escapeHtml(t(RULE[card.rule]))}</b>`, ...findingFactsLines(locale, card)];
  if (card.explanation) lines.push('', `<i>${escapeHtml(t(card.aiRunId ? 'aiAssistedLabel' : 'notAiLabel'))}</i>`, escapeHtml(cut(card.explanation, 1200)));
  const link = appLink(appUrl, card.href, t('tgOpenInApp'));
  if (link) lines.push('', link);
  return cut(lines.join('\n'), MAX_MESSAGE);
}

/** An approval card with Approve / Reject / Detail (PRD section 6). The text says exactly what will run. */
export function approvalMessage(locale: Locale, a: Pick<ApprovalCard, 'id' | 'tool' | 'rationale' | 'target' | 'expiresAt'>, timezoneFormat: (d: Date) => string): { text: string; keyboard: InlineKeyboard } {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const lines = [`<b>${escapeHtml(t('apTitle'))}</b>`, escapeHtml(ACT_TOOL[a.tool] ? t(ACT_TOOL[a.tool]) : a.tool), escapeHtml(cut(a.rationale, 600))];
  if (a.target) lines.push(`${escapeHtml(a.target.number ?? t('factDraftNumber'))} · ${escapeHtml(a.target.clientName)} · ${formatRupiah(a.target.total)}`);
  lines.push('', `<i>${escapeHtml(t('apByAi'))}</i> · ${escapeHtml(t('apExpires', { when: timezoneFormat(a.expiresAt) }))}`);
  return {
    text: lines.join('\n'),
    keyboard: {
      inline_keyboard: [
        [
          { text: t('apApprove'), callback_data: encodeApprovalCallback(a.id, 'y'), style: 'success' },
          { text: t('apReject'), callback_data: encodeApprovalCallback(a.id, 'n'), style: 'danger' },
        ],
        [{ text: t('tgDetail'), callback_data: encodeApprovalCallback(a.id, 'd') }],
      ],
    },
  };
}

export type DecisionOutcome = 'approved' | 'rejected' | 'refused' | 'already_decided' | 'expired' | 'forbidden' | 'not_found';

const OUTCOME: Record<DecisionOutcome, MessageKey> = {
  approved: 'apDone',
  rejected: 'apRejected',
  refused: 'tgRefused',
  already_decided: 'tgAlreadyDecided',
  expired: 'tgExpired',
  forbidden: 'apNoRight',
  not_found: 'tgApprovalGone',
};

/** The short answer on the button press (at most 200 characters) and the line that replaces the buttons on the card. */
export function outcomeText(locale: Locale, outcome: DecisionOutcome, by?: string): { toast: string; line: string } {
  const text = translate(locale, OUTCOME[outcome]);
  const line = by && (outcome === 'approved' || outcome === 'rejected') ? `${text} (${by})` : text;
  return { toast: cut(text, 200), line: `<b>${escapeHtml(line)}</b>` };
}

/** `/tugas`: the person's open tasks, late first, with no more than ten lines. */
export function tasksMessage(locale: Locale, tasks: Array<Pick<TaskRow, 'title' | 'dueDate' | 'late' | 'daysLate' | 'clientName' | 'status'>>, appUrl?: string): string {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  if (tasks.length === 0) return escapeHtml(t('tgNoTasks'));
  const lines = [`<b>${escapeHtml(t('tgTasksTitle'))}</b>`];
  for (const task of tasks.slice(0, 10)) {
    const bits = [task.dueDate ? formatDate(task.dueDate) : null, task.late ? t('tgDaysLate', { n: task.daysLate }) : null, task.clientName ? escapeHtml(task.clientName) : null].filter(Boolean);
    lines.push(`${task.late ? '•' : '◦'} ${escapeHtml(cut(task.title, 120))}${bits.length ? ` (${bits.join(' · ')})` : ''}`);
  }
  if (tasks.length > 10) lines.push(escapeHtml(t('tgMore', { n: tasks.length - 10 })));
  const link = appLink(appUrl, '/app/task?assignee=me', t('tgOpenInApp'));
  if (link) lines.push('', link);
  return lines.join('\n');
}

/** The answer to a voice note: the minutes in short, how many drafts wait, and a link (BR-M09 section 9). */
export function meetingReadyMessage(locale: Locale, m: { id: string; title: string; status: 'uploaded' | 'processing' | 'done' | 'failed'; error: string | null; narrative: string | null; tasks: number; leads: number }, appUrl?: string): string {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const lines = m.status === 'done'
    ? [`<b>${escapeHtml(t('tgMeetingDone', { title: m.title }))}</b>`, '', `<i>${escapeHtml(t('aiAssistedLabel'))}</i>`, escapeHtml(cut(m.narrative ?? '', 2500)), '', escapeHtml(t('tgMeetingDrafts', { tasks: m.tasks, leads: m.leads }))]
    : [`<b>${escapeHtml(t('tgMeetingFailed', { title: m.title }))}</b>`, escapeHtml(m.error ?? '')];
  const link = appLink(appUrl, `/app/rapat/${m.id}`, t('tgOpenInApp'));
  if (link) lines.push('', link);
  return cut(lines.join('\n'), MAX_MESSAGE);
}
