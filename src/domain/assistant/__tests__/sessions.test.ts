import { afterAll, describe, expect, it } from 'vitest';
import { pg } from '../../../db/client';
import { makeOrg } from '../../ai/__tests__/support';
import type { Ctx } from '../../ctx';
import { appendTurns, beginAnswer, endAnswer, deleteSession, getSession, listSessions, renameSession, telegramConversation, titleFrom } from '../sessions';

afterAll(async () => {
  await pg.end();
});

const user = (text: string) => ({ kind: 'user' as const, body: { text } });
const reply = (text: string) => ({ kind: 'assistant' as const, body: { ok: true, text, sources: [], tools: [], pendingApprovals: [], drafts: [] } });

describe('assistant sessions (D-078)', () => {
  it('stores a conversation in order and titles it from the first question', async () => {
    const o = await makeOrg();
    const id = await appendTurns(o.ownerCtx, null, [user('Siapa klien kita yang paling lama?'), reply('Toko Sinar.')], 'Siapa klien kita yang paling lama?');
    await appendTurns(o.ownerCtx, id, [user('Dan yang terbaru?'), reply('Kafe Senja.')], 'Dan yang terbaru?');
    const session = await getSession(o.ownerCtx, id);
    expect(session.title).toBe('Siapa klien kita yang paling lama?');
    expect(session.messages.map((m) => [m.seq, m.kind])).toEqual([[1, 'user'], [2, 'assistant'], [3, 'user'], [4, 'assistant']]);
    expect((session.messages[3].body as { text: string }).text).toBe('Kafe Senja.');
  });

  it('lists only the caller\'s own sessions, newest first, and filters by title', async () => {
    const o = await makeOrg();
    const a = await appendTurns(o.ownerCtx, null, [user('Invoice lewat jatuh tempo'), reply('Ada dua.')], 'Invoice lewat jatuh tempo');
    const b = await appendTurns(o.ownerCtx, null, [user('Tugas terlambat'), reply('Satu.')], 'Tugas terlambat');
    await appendTurns(o.staffCtx, null, [user('Rahasia staf'), reply('Ok.')], 'Rahasia staf');
    expect((await listSessions(o.ownerCtx)).map((s) => s.id)).toEqual([b, a]);
    expect((await listSessions(o.ownerCtx, { q: 'invoice' })).map((s) => s.id)).toEqual([a]);
    expect((await listSessions(o.ownerCtx, { q: '%' })).length).toBe(0); // a wildcard is text, not a pattern
    expect((await listSessions(o.staffCtx)).map((s) => s.title)).toEqual(['Rahasia staf']);
  });

  it('shows nobody else\'s conversation, not even to the owner, and not across organizations', async () => {
    const o = await makeOrg();
    const other = await makeOrg();
    const staffId = await appendTurns(o.staffCtx, null, [user('Pribadi'), reply('Ok.')], 'Pribadi');
    await expect(getSession(o.ownerCtx, staffId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(appendTurns(o.ownerCtx, staffId, [user('x')], 'x')).rejects.toMatchObject({ code: 'not_found' });
    await expect(renameSession(o.ownerCtx, staffId, 'Diubah')).rejects.toMatchObject({ code: 'not_found' });
    await expect(deleteSession(other.ownerCtx, staffId)).rejects.toMatchObject({ code: 'not_found' });
    expect((await getSession(o.staffCtx, staffId)).title).toBe('Pribadi');
  });

  it('renames and deletes the caller\'s own session, messages included', async () => {
    const o = await makeOrg();
    const id = await appendTurns(o.ownerCtx, null, [user('Halo'), reply('Hai.')], 'Halo');
    await renameSession(o.ownerCtx, id, '  Sapaan  ');
    expect((await getSession(o.ownerCtx, id)).title).toBe('Sapaan');
    await expect(renameSession(o.ownerCtx, id, '   ')).rejects.toBeDefined();
    await deleteSession(o.ownerCtx, id);
    await expect(getSession(o.ownerCtx, id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('shortens a long first question to one line', () => {
    expect(titleFrom('a\n\n b   c')).toBe('a b c');
    expect(titleFrom('x'.repeat(200)).length).toBe(80);
  });
});

describe('a question that is still being answered (D-090)', () => {
  it('is stored at once and the conversation says it is pending until the answer is stored', async () => {
    const o = await makeOrg();
    const id = await appendTurns(o.ownerCtx, null, [user('Berapa tagihan yang belum dibayar?')], 'Berapa tagihan yang belum dibayar?');
    beginAnswer(id);
    const during = await getSession(o.ownerCtx, id);
    expect(during.pending).toBe(true);
    expect(during.messages.map((m) => m.kind)).toEqual(['user']);
    await appendTurns(o.ownerCtx, id, [reply('Dua invoice.')], '');
    endAnswer(id);
    const after = await getSession(o.ownerCtx, id);
    expect(after.pending).toBe(false);
    expect(after.messages.map((m) => m.kind)).toEqual(['user', 'assistant']);
  });
});

describe('the Telegram conversation (D-092)', () => {
  const at = (ctx: Ctx, iso: string): Ctx => ({ ...ctx, clock: { now: () => new Date(iso) } });

  it('survives a restart: the stored turns come back for the next question, only from Telegram sessions', async () => {
    const o = await makeOrg();
    const ctx = at(o.ownerCtx, '2026-11-01T15:14:00Z');
    expect(await telegramConversation(ctx)).toEqual({ sessionId: null, history: [] });
    await appendTurns(ctx, null, [user('Dari web'), reply('Ini web.')], 'Dari web');
    const id = await appendTurns(ctx, null, [user('Buat proposal untuk Kafe Senja'), reply('Paket yang mana?')], 'Buat proposal untuk Kafe Senja', 'telegram');
    const later = await telegramConversation(at(o.ownerCtx, '2026-11-01T15:40:00Z'));
    expect(later.sessionId).toBe(id);
    expect(later.history).toEqual([
      { role: 'user', content: 'Buat proposal untuk Kafe Senja' },
      { role: 'assistant', content: 'Paket yang mana?' },
    ]);
    // the staff member's conversation is their own
    expect((await telegramConversation(at(o.staffCtx, '2026-11-01T15:40:00Z'))).sessionId).toBeNull();
    // it shows in the person's web history too
    expect((await listSessions(ctx)).map((s) => s.id)).toContain(id);
  });

  it('starts afresh after 30 quiet minutes', async () => {
    const o = await makeOrg();
    await appendTurns(at(o.ownerCtx, '2026-11-01T15:00:00Z'), null, [user('halo'), reply('Halo!')], 'halo', 'telegram');
    expect((await telegramConversation(at(o.ownerCtx, '2026-11-01T15:29:00Z'))).history).toHaveLength(2);
    expect(await telegramConversation(at(o.ownerCtx, '2026-11-01T15:31:00Z'))).toEqual({ sessionId: null, history: [] });
  });
});
