import { eq } from 'drizzle-orm';
import { EventEmitter } from 'node:events';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../db/client';
import { aiRuns, jobs, meetings, meetingTurns } from '../../db/schema';
import { makeOrg } from '../../domain/ai/__tests__/support';
import { setAiBudget } from '../../domain/ai/budget';
import { runLiveSession, type ClientSocket, type OpenUpstream, type UpstreamEvents } from '../live-meeting';

afterAll(async () => {
  await pg.end();
});

/** A browser socket that records what the server sends and lets the test play the browser. */
function fakeBrowser() {
  const bus = new EventEmitter();
  const sent: Array<Record<string, unknown>> = [];
  const socket = {
    send: (data: string) => void sent.push(JSON.parse(data)),
    close: () => undefined,
    on: (event: string, fn: (...args: never[]) => void) => bus.on(event, fn as (...args: unknown[]) => void),
  } as ClientSocket;
  const waitFor = async (type: string) => {
    for (let i = 0; i < 200 && !sent.some((m) => m.type === type); i++) await new Promise((r) => setTimeout(r, 10));
    return sent.find((m) => m.type === type);
  };
  return {
    socket,
    sent,
    waitFor,
    text: (value: unknown) => bus.emit('message', Buffer.from(JSON.stringify(value)), false),
    audio: (bytes = 3840) => bus.emit('message', Buffer.alloc(bytes), true),
    hangUp: () => bus.emit('close'),
  };
}

/** A transcription service that answers the audio with scripted events and closes after `endStream`. */
function fakeUpstream(script: Array<Record<string, unknown>>) {
  const received: number[] = [];
  let ended = false;
  const open: OpenUpstream = async (events: UpstreamEvents) => ({
    send: (pcm) => void received.push(pcm.byteLength),
    end: () => {
      ended = true;
      for (const event of script) events.onEvent(event);
      events.onClose(1000, '');
    },
    close: () => undefined,
  });
  return { open, received, wasEnded: () => ended };
}

const SCRIPT = [
  { type: 'speechStart', turnId: 1, audioProcessedMs: 400 },
  { type: 'transcript', transcript: 'kita bahas invoice Aksara', final: false, audioProcessedMs: 1500 },
  { type: 'speaker', label: 'A', audioProcessedMs: 1600 },
  { type: 'speechEnd', turnId: 1, audioProcessedMs: 2400 },
  { type: 'speechComplete', turnId: 1, transcript: 'Kita bahas invoice Aksara.', audioProcessedMs: 2500 },
];

describe('live meeting session (D-051)', () => {
  it('streams captions, then saves the transcript as a meeting and queues the minutes', async () => {
    const o = await makeOrg();
    const browser = fakeBrowser();
    const upstream = fakeUpstream(SCRIPT);
    const session = runLiveSession(browser.socket, o.ownerCtx, { openUpstream: upstream.open });
    browser.text({ type: 'start', title: 'Rapat mingguan', consent: true });
    await browser.waitFor('ready');
    browser.audio();
    browser.audio();
    browser.text({ type: 'stop' });
    await session;
    const ended = (await browser.waitFor('ended'))!;

    expect(upstream.wasEnded()).toBe(true);
    expect(upstream.received).toEqual([3840, 3840]);
    expect(browser.sent.map((m) => m.type)).toEqual(expect.arrayContaining(['ready', 'final', 'ended']));
    expect(ended.meetingId).toBeTruthy();

    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, ended.meetingId as string));
    expect(meeting).toMatchObject({ orgId: o.orgId, title: 'Rapat mingguan', source: 'live', fileId: null, createdBy: o.ownerCtx.userId });
    expect(await db.select().from(meetingTurns).where(eq(meetingTurns.meetingId, meeting.id))).toMatchObject([{ speaker: 'A', text: 'Kita bahas invoice Aksara.', seq: 1 }]);
    expect((await db.select().from(jobs).where(eq(jobs.orgId, o.orgId))).map((j) => j.type)).toContain('meeting.process');
    expect(await db.select().from(aiRuns).where(eq(aiRuns.orgId, o.orgId))).toMatchObject([{ feature: 'transcribe', status: 'ok' }]);
  });

  it('waits for the connection when the person stops at once, and still saves the words', async () => {
    const o = await makeOrg();
    const browser = fakeBrowser();
    const upstream = fakeUpstream(SCRIPT);
    const session = runLiveSession(browser.socket, o.ownerCtx, { openUpstream: upstream.open });
    browser.text({ type: 'start', title: 'Rapat singkat', consent: true });
    browser.audio();
    browser.text({ type: 'stop' });
    await session;
    expect((await browser.waitFor('ended'))!.meetingId).toBeTruthy();
    expect(upstream.wasEnded()).toBe(true);
  });

  it('refuses to start without consent, and records nothing', async () => {
    const o = await makeOrg();
    const browser = fakeBrowser();
    const session = runLiveSession(browser.socket, o.ownerCtx, { openUpstream: fakeUpstream([]).open });
    browser.text({ type: 'start', title: 'Rapat', consent: false });
    expect(await browser.waitFor('error')).toMatchObject({ code: 'invalid' });
    expect(await db.select().from(meetings).where(eq(meetings.orgId, o.orgId))).toEqual([]);
    browser.hangUp();
    await session;
  });

  it('saves what was said when the browser disconnects without stopping', async () => {
    const o = await makeOrg();
    const browser = fakeBrowser();
    const session = runLiveSession(browser.socket, o.ownerCtx, { openUpstream: fakeUpstream(SCRIPT).open });
    browser.text({ type: 'start', title: 'Rapat putus', consent: true });
    await browser.waitFor('ready');
    browser.audio();
    browser.hangUp();
    await session;
    await browser.waitFor('ended');
    expect(await db.select().from(meetings).where(eq(meetings.orgId, o.orgId))).toMatchObject([{ title: 'Rapat putus', source: 'live' }]);
  });

  it('leaves no meeting behind when nobody said anything', async () => {
    const o = await makeOrg();
    const browser = fakeBrowser();
    const session = runLiveSession(browser.socket, o.ownerCtx, { openUpstream: fakeUpstream([]).open });
    browser.text({ type: 'start', title: 'Ruang kosong', consent: true });
    await browser.waitFor('ready');
    browser.text({ type: 'stop' });
    await session;
    expect(await browser.waitFor('ended')).toMatchObject({ meetingId: null });
    expect(await db.select().from(meetings).where(eq(meetings.orgId, o.orgId))).toEqual([]);
  });

  it('does not open the service when the transcription budget is spent', async () => {
    const o = await makeOrg();
    await setAiBudget(db, o.ownerCtx, 'transcribe', 0);
    const browser = fakeBrowser();
    let opened = false;
    const session = runLiveSession(browser.socket, o.ownerCtx, { openUpstream: async () => ((opened = true), { send: () => undefined, end: () => undefined, close: () => undefined }) });
    browser.text({ type: 'start', title: 'Tanpa anggaran', consent: true });
    expect(await browser.waitFor('error')).toMatchObject({ code: 'budget' });
    expect(opened).toBe(false);
    browser.hangUp();
    await session;
  });

  it('files a live meeting under the person who ran it, staff included', async () => {
    const o = await makeOrg();
    const browser = fakeBrowser();
    const session = runLiveSession(browser.socket, o.staffCtx, { openUpstream: fakeUpstream(SCRIPT).open });
    browser.text({ type: 'start', title: 'Rapat staf', consent: true });
    await browser.waitFor('ready');
    browser.audio();
    browser.text({ type: 'stop' });
    await session;
    await browser.waitFor('ended');
    const [meeting] = await db.select().from(meetings).where(eq(meetings.orgId, o.orgId));
    expect(meeting.createdBy).toBe(o.staffCtx.userId);
  });
});
