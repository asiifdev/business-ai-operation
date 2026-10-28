import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { documents, leads, meetings, organizations, tasks } from '../../db/schema';
import type { TelegramClient } from '../../integrations/telegram/client';
import { TelegramError } from '../../integrations/telegram/errors';
import type { Clock } from '../../lib/clock';
import { formatDateTime } from '../../lib/format';
import { listPendingApprovals } from '../action-center/approvals';
import { listFindings } from '../action-center/findings';
import { automationOnce } from '../automation/once';
import { userCtx } from '../ctx';
import { approvalMessage, findingMessage, meetingReadyMessage } from './cards';
import { listLinkedUsers, unlinkChat } from './links';

/** At most this many cards per person per run, so a busy morning does not flood a chat (1 message per second limit). */
const PER_PERSON = 5;

export interface NotifyDeps {
  client: Pick<TelegramClient, 'sendMessage'>;
  clock: Clock;
  appUrl?: string;
}

/**
 * Sends each linked person the Action Center items they may see and have not been sent yet (PRD section 6): approvals
 * they may decide as cards with buttons, and new findings as plain cards. Only items raised after the person linked,
 * so linking does not replay the backlog (`/status` shows that). Each card goes out once per person, whatever the number
 * of ticks or processes, through `automation.once` (BR-M15-04); a failed send rolls back its claim and is retried on the
 * next run. A person who blocked the bot is unlinked and skipped.
 */
export async function notifyLinkedUsers(orgId: string, deps: NotifyDeps): Promise<{ sent: number }> {
  const people = await listLinkedUsers(orgId);
  if (people.length === 0) return { sent: 0 };
  const [org] = await db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, orgId));
  let sent = 0;

  for (const person of people) {
    const ctx = userCtx({ orgId, userId: person.userId, role: person.role }, deps.clock);
    const since = person.linkedAt.getTime();
    const pending = (await listPendingApprovals(ctx)).filter((a) => a.canDecide && a.createdAt.getTime() >= since);
    const covered = new Set(pending.map((a) => a.findingId).filter(Boolean));
    const { findings } = await listFindings(ctx, 'open');
    const fresh = findings.filter((f) => f.createdAt.getTime() >= since && !covered.has(f.id));

    // Voice notes this person sent from Telegram, once processed (or failed): the answer goes back to the same chat.
    const voice = await db
      .select({ id: meetings.id, title: meetings.title, status: meetings.status, error: meetings.error, narrative: documents.narrative })
      .from(meetings)
      .leftJoin(documents, and(eq(documents.orgId, meetings.orgId), eq(documents.id, meetings.minutesDocumentId)))
      .where(and(eq(meetings.orgId, orgId), eq(meetings.createdBy, person.userId), eq(meetings.source, 'telegram'), inArray(meetings.status, ['done', 'failed']), isNull(meetings.contentDeletedAt), gte(meetings.createdAt, person.linkedAt)));
    const draftCounts = async (meetingId: string) => ({
      tasks: (await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.meetingId, meetingId)))).length,
      leads: (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.orgId, orgId), eq(leads.meetingId, meetingId)))).length,
    });

    const queue: Array<{ key: string; build: () => { text: string; keyboard?: Parameters<NotifyDeps['client']['sendMessage']>[0]['replyMarkup'] } }> = [
      ...pending.map((a) => ({ key: `tg:approval:${a.id}:${person.userId}`, build: () => approvalMessage(person.locale, a, (d) => formatDateTime(d, org.timezone)) })),
      ...fresh.map((f) => ({ key: `tg:finding:${f.id}:${person.userId}`, build: () => ({ text: findingMessage(person.locale, f, deps.appUrl) }) })),
    ];
    for (const m of voice) {
      const counts = m.status === 'done' ? await draftCounts(m.id) : { tasks: 0, leads: 0 };
      queue.unshift({ key: `tg:meeting:${m.id}:${person.userId}`, build: () => ({ text: meetingReadyMessage(person.locale, { ...m, ...counts }, deps.appUrl) }) });
    }

    let budget = PER_PERSON;
    for (const item of queue) {
      if (budget === 0) break;
      try {
        const out = await db.transaction((tx) =>
          automationOnce(tx, orgId, 'telegram_notify', item.key, async () => {
            const { text, keyboard } = item.build();
            const msg = await deps.client.sendMessage({ chatId: person.chatId, text, parseMode: 'HTML', replyMarkup: keyboard, disablePreview: true });
            return { messageId: msg.message_id };
          }),
        );
        if (out.ran) {
          sent++;
          budget--;
        }
      } catch (err) {
        if (err instanceof TelegramError && err.kind === 'blocked') {
          await unlinkChat(person.chatId, deps.clock, 'blocked');
          break;
        }
        console.error(`telegram: notify failed for ${orgId}`, err instanceof Error ? err.message : err);
        break; // try this person again on the next run
      }
    }
  }
  return { sent };
}
