import { describe, expect, it } from 'vitest';
import { splitSuggestions } from '../assistant';

describe('follow-up line of an answer (D-090)', () => {
  it('takes the last line off the text and returns at most three suggestions', () => {
    const out = splitSuggestions('Ada dua invoice terlambat.\n\nLanjutan: Buatkan pengingat untuk klien | Tampilkan invoice yang terlambat | Cek tugas terkait | Satu lagi yang tidak perlu');
    expect(out.text).toBe('Ada dua invoice terlambat.');
    expect(out.suggestions).toEqual(['Buatkan pengingat untuk klien', 'Tampilkan invoice yang terlambat', 'Cek tugas terkait']);
  });

  it('leaves an answer without the line untouched', () => {
    expect(splitSuggestions('Selesai.')).toEqual({ text: 'Selesai.', suggestions: [] });
  });
});
