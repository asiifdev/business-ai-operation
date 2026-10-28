import { describe, expect, it } from 'vitest';
import { spokenText } from '../spoken';

describe('spokenText', () => {
  it('reads an answer without markers, bullets as short sentences', () => {
    expect(spokenText('Ada **2** tugas terlambat:\n- Kirim invoice\n- Telepon klien\n\nSaran saya: kerjakan hari ini.')).toEqual({ text: 'Ada 2 tugas terlambat: Kirim invoice. Telepon klien. Saran saya: kerjakan hari ini.', locale: 'id' });
  });

  it('keeps code as plain words and never speaks markup', () => {
    expect(spokenText('Buka `Tugas` di Orbyte.')).toEqual({ text: 'Buka Tugas di Orbyte.', locale: 'id' });
  });

  it('is silent for an empty answer, and tells Indonesian from English so each gets its own voice', () => {
    expect(spokenText('   ')).toBeNull();
    expect(spokenText('Here is what you asked for, please check the list.')).toMatchObject({ locale: 'en' });
    expect(spokenText('Ini daftar yang Anda minta, silakan dicek.')).toMatchObject({ locale: 'id' });
  });

  it('does not read a long answer at all: whole or not at all', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Kalimat nomor ${i + 1} ada di sini.`).join(' ');
    expect(spokenText(long)).toBeNull();
    expect(spokenText(long, 5000)).not.toBeNull();
  });
});
