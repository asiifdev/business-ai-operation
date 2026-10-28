import { randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { auditLog, invoices, telegramLinks } from '../../../db/schema';
import type { TelegramUpdate } from '../../../integrations/telegram/webhook';
import { encodeApprovalCallback } from '../../../integrations/telegram/callback';
import { makeOrg } from '../../ai/__tests__/support';
import { requestApproval } from '../../approvals/service';
import { createInvoiceDraft } from '../../billing/invoices';
import { createClient } from '../../portfolio/clients';
import { createTask } from '../../tasks/service';
import { handleUpdate, type BotDeps } from '../bot';
import { createPairingCode, findLinkedUser } from '../links';
import { notifyLinkedUsers } from '../notify';

afterAll(async () => {
  await pg.end();
});

/** A Telegram that records what the bot would send. */
function fakeTelegram() {
  const sent: Array<{ chatId: number; text: string; keyboard?: unknown }> = [];
  const edited: Array<{ chatId: number; messageId: number; text: string }> = [];
  const answers: Array<{ id: string; text?: string }> = [];
  let nextMessage = 100;
  const client: BotDeps['client'] = {
    sendMessage: async (m) => {
      sent.push({ chatId: m.chatId, text: m.text, keyboard: m.replyMarkup });
      return { message_id: nextMessage++ };
    },
    editMessageText: async (m) => {
      edited.push({ chatId: m.chatId, messageId: m.messageId, text: m.text });
      return true;
    },
    answerCallbackQuery: async (a) => {
      answers.push({ id: a.id, text: a.text });
      return true;
    },
    sendChatAction: async () => true,
    downloadFile: async () => new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  };
  return { client, sent, edited, answers };
}

// Update ids and chat ids are global in the test database, so every test draws its own.
const uid = () => randomInt(1, 2 ** 31);
const chat = (id: number) => ({ id, type: 'private' });
const textUpdate = (chatId: number, text: string): TelegramUpdate => ({ update_id: uid(), message: { message_id: 1, from: { id: chatId, is_bot: false, language_code: 'id' }, chat: chat(chatId), date: 0, text } });
const pressUpdate = (chatId: number, data: string): TelegramUpdate => ({ update_id: uid(), callback_query: { id: `cb${uid()}`, from: { id: chatId }, data, message: { message_id: 55, chat: chat(chatId) } } });

async function linkedOrg() {
  const o = await makeOrg();
  const tg = fakeTelegram();
  const deps: BotDeps = { client: tg.client, clock: o.clock, appUrl: 'https://app.example.test' };
  const link = async (ctx: typeof o.ownerCtx) => {
    const chatId = uid();
    const { code } = await createPairingCode(ctx, 'orbyte_test_bot');
    await handleUpdate(textUpdate(chatId, `/start ${code}`), deps);
    return chatId;
  };
  return { o, tg, deps, link };
}

describe('pairing (PRD section 6)', () => {
  it('links a chat with a one-time code, and refuses the same code twice', async () => {
    const { o, tg, deps } = await linkedOrg();
    const { code } = await createPairingCode(o.ownerCtx, 'orbyte_test_bot');
    const first = uid();
    await handleUpdate(textUpdate(first, `/start ${code}`), deps);
    expect(await findLinkedUser(first)).toMatchObject({ userId: o.ownerCtx.userId, orgId: o.orgId });
    expect(tg.sent.at(-1)!.text).toContain('Tertaut');

    const second = uid();
    await handleUpdate(textUpdate(second, `/start ${code}`), deps);
    expect(await findLinkedUser(second)).toBeNull();
    expect(tg.sent.at(-1)!.text).toContain('tidak bisa dipakai');
  });

  it('refuses an expired code with the same neutral answer', async () => {
    const { o, tg, deps } = await linkedOrg();
    const { code } = await createPairingCode(o.ownerCtx, 'orbyte_test_bot');
    o.clock.set(new Date(o.clock.now().getTime() + 11 * 60_000));
    const chatId = uid();
    await handleUpdate(textUpdate(chatId, `/start ${code}`), deps);
    expect(await findLinkedUser(chatId)).toBeNull();
    expect(tg.sent.at(-1)!.text).toContain('tidak bisa dipakai');
  });

  it('tells an unlinked chat nothing about any organization', async () => {
    const { o, tg, deps } = await linkedOrg();
    await createInvoiceDraft(o.ownerCtx, { clientId: (await createClient(o.ownerCtx, { name: 'Rahasia Corp' })).id, dueDate: '2026-11-01', items: [{ description: 'x', quantity: 1, unitPrice: 5 }] });
    const stranger = uid();
    await handleUpdate(textUpdate(stranger, '/overdue'), deps);
    await handleUpdate(textUpdate(stranger, 'siapa klien kita?'), deps);
    expect(tg.sent.map((m) => m.text).every((t) => t.includes('belum tertaut'))).toBe(true);
    expect(tg.sent.some((m) => m.text.includes('Rahasia'))).toBe(false);
  });

  it('handles each update id once, however often Telegram resends it', async () => {
    const { o, tg, deps, link } = await linkedOrg();
    const chatId = await link(o.ownerCtx);
    const before = tg.sent.length;
    const update = textUpdate(chatId, '/status');
    await handleUpdate(update, deps);
    await handleUpdate(update, deps);
    expect(tg.sent.length).toBe(before + 1);
  });

  it('ends the link with /putus, and when the person blocks the bot', async () => {
    const { o, deps, link } = await linkedOrg();
    const chatId = await link(o.ownerCtx);
    await handleUpdate(textUpdate(chatId, '/putus'), deps);
    expect(await findLinkedUser(chatId)).toBeNull();

    const again = await link(o.staffCtx);
    await handleUpdate({ update_id: uid(), my_chat_member: { chat: chat(again), from: { id: again }, date: 0, new_chat_member: { status: 'kicked' } } }, deps);
    const [row] = await db.select().from(telegramLinks).where(eq(telegramLinks.chatId, again));
    expect(row.unlinkedAt).not.toBeNull();
  });
});

describe('commands follow the person role (BR-M01-08)', () => {
  it('gives /overdue to managers only, and /tugas the person own tasks', async () => {
    const { o, tg, deps, link } = await linkedOrg();
    const staffChat = await link(o.staffCtx);
    await handleUpdate(textUpdate(staffChat, '/overdue'), deps);
    expect(tg.sent.at(-1)!.text).toContain('hanya untuk Pemilik dan Admin');
    await createTask(o.ownerCtx, { title: 'Perbaiki struk', assigneeId: o.staffCtx.userId, dueDate: '2026-10-20' });
    await handleUpdate(textUpdate(staffChat, '/tugas'), deps);
    expect(tg.sent.at(-1)!.text).toContain('Perbaiki struk');
    expect(tg.sent.at(-1)!.text).toContain('terlambat 8 hari');
  });
});

async function draftApproval(o: Awaited<ReturnType<typeof makeOrg>>) {
  const client = (await createClient(o.ownerCtx, { name: 'Kopi Senja' })).id;
  const invoice = await createInvoiceDraft(o.ownerCtx, { clientId: client, dueDate: '2026-11-05', items: [{ description: 'Langganan', quantity: 1, unitPrice: 99_000 }] });
  const approval = await requestApproval(db, o.ownerCtx, { tool: 'mark_invoice_sent', args: { invoiceId: invoice.id }, rationale: 'Tandai draf invoice ini terkirim.' });
  return { invoiceId: invoice.id, approvalId: approval.id };
}

describe('approval buttons (PRD section 6, BR-M08-06/-07)', () => {
  it('approves through the same service as the web, once, and replaces the buttons with the result', async () => {
    const { o, tg, deps, link } = await linkedOrg();
    const chatId = await link(o.ownerCtx);
    const { invoiceId, approvalId } = await draftApproval(o);

    await handleUpdate(pressUpdate(chatId, encodeApprovalCallback(approvalId, 'y')), deps);
    const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId));
    expect(inv.status).toBe('sent');
    expect(tg.answers.at(-1)!.text).toBe('Disetujui dan dijalankan.');
    expect(tg.edited.at(-1)).toMatchObject({ chatId, messageId: 55 });
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'telegram.approval_decided')));
    expect(audit).toHaveLength(1);

    // A second press (or the web button a moment later) does nothing more.
    await handleUpdate(pressUpdate(chatId, encodeApprovalCallback(approvalId, 'y')), deps);
    expect(tg.answers.at(-1)!.text).toBe('Sudah diputuskan sebelumnya.');
  });

  it('never lets staff decide a money action, and leaves the card for someone who may', async () => {
    const { o, tg, deps, link } = await linkedOrg();
    const staffChat = await link(o.staffCtx);
    const { approvalId, invoiceId } = await draftApproval(o);
    await handleUpdate(pressUpdate(staffChat, encodeApprovalCallback(approvalId, 'y')), deps);
    const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId));
    expect(inv.status).toBe('draft');
    expect(tg.edited).toHaveLength(0);
  });

  it('ignores a forged button from a chat that is not linked', async () => {
    const { o, tg, deps } = await linkedOrg();
    const { approvalId, invoiceId } = await draftApproval(o);
    await handleUpdate(pressUpdate(uid(), encodeApprovalCallback(approvalId, 'y')), deps);
    const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId));
    expect(inv.status).toBe('draft');
    expect(tg.answers.at(-1)!.text).toContain('belum tertaut');
  });
});

describe('notifications', () => {
  it('sends a pending approval as a card with buttons once, to people who may decide it', async () => {
    const { o, tg, deps, link } = await linkedOrg();
    const ownerChat = await link(o.ownerCtx);
    const staffChat = await link(o.staffCtx);
    await draftApproval(o);
    const before = tg.sent.length;
    await notifyLinkedUsers(o.orgId, deps);
    await notifyLinkedUsers(o.orgId, deps);
    const cards = tg.sent.slice(before);
    expect(cards).toHaveLength(1);
    expect(cards[0].chatId).toBe(ownerChat);
    expect(cards[0].keyboard).toBeDefined();
    expect(cards.some((c) => c.chatId === staffChat)).toBe(false);
  });
});
