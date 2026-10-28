import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../db/client';
import { makeOrg } from '../../domain/ai/__tests__/support';
import { FakeProvider, say } from '../fake-provider';
import { toSpokenIndonesian } from '../spoken';

afterAll(async () => {
  await pg.end();
});

const speak = async (answer: string, text: string) => {
  const o = await makeOrg();
  const fake = new FakeProvider({ chat: [say(answer)] });
  const out = await toSpokenIndonesian({ db, ctx: o.ownerCtx, text, organizationName: 'ASIIFDEV DIGITAL AGENCY', provider: fake });
  return { out, fake };
};

describe('toSpokenIndonesian (D-052)', () => {
  it('uses the model\'s respelling of English words and names, and tells it the organization name', async () => {
    const text = 'Halo! Generate image atau video belum bisa di ASIIFDEV DIGITAL AGENCY.';
    const { out, fake } = await speak('Halo! Generet imej atau video belum bisa di asif dev digital ejensi.', text);
    expect(out).toBe('Halo! Generet imej atau video belum bisa di asif dev digital ejensi.');
    expect(JSON.stringify(fake.chatCalls[0].messages)).toContain('ASIIFDEV DIGITAL AGENCY');
  });

  it('refuses a rewrite that changes a number and falls back to the plain word list', async () => {
    const { out } = await speak('Ada tiga puluh tujuh invois terlambat.', 'Ada 2 invoice terlambat.');
    expect(out).toBe('Ada 2 invois terlambat.');
  });

  it('falls back when the model says nothing or something far too long, or when the call fails', async () => {
    expect((await speak('   ', 'Kirim invoice sekarang.')).out).toBe('Kirim invois sekarang.');
    expect((await speak('x'.repeat(500), 'Kirim invoice sekarang.')).out).toBe('Kirim invois sekarang.');
    const o = await makeOrg();
    const broken = new FakeProvider({ chat: [] });
    expect(await toSpokenIndonesian({ db, ctx: o.ownerCtx, text: 'Kirim invoice sekarang.', organizationName: 'X', provider: broken })).toBe('Kirim invois sekarang.');
  });
});
