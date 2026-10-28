import { describe, expect, it } from 'vitest';
import { allowedStatusMoves, canMoveStatus, daysLate, defaultDueDate, isLate, isOpenWork, overlap, SIMILAR_THRESHOLD, similarity, words } from '../rules';

describe('status moves (BR-M05-01)', () => {
  it('starts, stops, finishes and reopens work, and nothing else', () => {
    expect(allowedStatusMoves('open')).toEqual(['in_progress', 'done']);
    expect(allowedStatusMoves('in_progress')).toEqual(['open', 'done']);
    expect(allowedStatusMoves('done')).toEqual(['open']);
    expect(canMoveStatus('done', 'in_progress')).toBe(false);
    expect(canMoveStatus('open', 'open')).toBe(false);
  });
});

describe('default due date (BR-M05-04)', () => {
  it('gives a Bug or Maintenance task without a date the days of its priority', () => {
    expect(defaultDueDate('bug', 'urgent', '2026-10-28', null)).toBe('2026-10-29');
    expect(defaultDueDate('bug', 'high', '2026-10-28', undefined)).toBe('2026-10-31');
    expect(defaultDueDate('maintenance', 'medium', '2026-10-28', null)).toBe('2026-11-04');
    expect(defaultDueDate('maintenance', 'low', '2026-10-28', null)).toBe('2026-11-11');
  });

  it('keeps a date that was given, and leaves other kinds undated', () => {
    expect(defaultDueDate('bug', 'urgent', '2026-10-28', '2026-12-01')).toBe('2026-12-01');
    expect(defaultDueDate('task', 'urgent', '2026-10-28', null)).toBeNull();
    expect(defaultDueDate('feature', 'high', '2026-10-28', null)).toBeNull();
  });
});

describe('late is derived (BR-M05-03)', () => {
  const base = { status: 'open' as const, dueDate: '2026-10-27', isDraft: false };

  it('is late only after the due date, while not done', () => {
    expect(isLate(base, '2026-10-28')).toBe(true);
    expect(daysLate(base, '2026-10-30')).toBe(3);
    expect(isLate({ ...base, dueDate: '2026-10-28' }, '2026-10-28')).toBe(false); // due today is not late yet
    expect(isLate({ ...base, status: 'done' }, '2026-10-28')).toBe(false);
    expect(isLate({ ...base, dueDate: null }, '2026-10-28')).toBe(false);
    expect(daysLate({ ...base, status: 'done' }, '2026-10-30')).toBe(0);
  });

  it('never counts an AI draft as late or as open work (BR-M05-05)', () => {
    expect(isLate({ ...base, isDraft: true }, '2026-10-28')).toBe(false);
    expect(isOpenWork({ status: 'open', isDraft: true })).toBe(false);
    expect(isOpenWork({ status: 'in_progress', isDraft: false })).toBe(true);
    expect(isOpenWork({ status: 'done', isDraft: false })).toBe(false);
  });
});

describe('similar tasks by word overlap', () => {
  it('ignores case, accents, punctuation and filler words, and meets verb forms at one stem', () => {
    expect([...words('Pengingat WhatsApp TIDAK terkirim, di klinik!')]).toEqual(['pengingat', 'whatsapp', 'kirim', 'klinik']);
    expect(words('dikirim')).toEqual(words('terkirim'));
    expect(words('data')).toEqual(new Set(['data'])); // too short to lose a prefix
    expect(overlap(words('Café login'), words('cafe LOGIN'))).toBe(1);
    expect(overlap(new Set(), words('apa saja'))).toBe(0);
  });

  it('does not let a one-word title match everything that contains it', () => {
    expect(overlap(words('Login'), words('Login kasir gagal setelah update'))).toBe(0.5);
  });

  it('scores two reports of the same problem above the threshold and unrelated work below it', () => {
    const a = { title: 'Pengingat jadwal tidak terkirim untuk janji temu pagi', description: 'Pasien tidak menerima pengingat' };
    const b = { title: 'Pengingat WhatsApp terlambat dikirim ke pasien klinik', description: 'Pengingat janji temu datang terlambat' };
    const c = { title: 'Ekspor laporan pipeline ke CSV', description: null };
    expect(similarity(a, b)).toBeGreaterThanOrEqual(SIMILAR_THRESHOLD);
    expect(similarity(a, c)).toBeLessThan(SIMILAR_THRESHOLD);
    expect(similarity(a, a)).toBe(1);
  });
});
