import { describe, expect, it } from 'vitest';
import { keepGrounded, mergeTurns, minutesNarrative, minutesSchema, quoteFound, sniffAudio, stamp, transcriptLines, type Minutes } from '../rules';

const bytes = (...head: Array<number | string>) => {
  const out: number[] = [];
  for (const h of head) typeof h === 'string' ? out.push(...[...h].map((c) => c.charCodeAt(0))) : out.push(h);
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
};

describe('audio formats are recognised from the bytes (BR-M09-02)', () => {
  it('knows wav, ogg, mp3, m4a and webm', () => {
    expect(sniffAudio(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toBe('wav');
    expect(sniffAudio(bytes('OggS'))).toBe('ogg');
    expect(sniffAudio(bytes('ID3'))).toBe('mp3');
    expect(sniffAudio(bytes(0xff, 0xfb))).toBe('mp3');
    expect(sniffAudio(bytes(0, 0, 0, 0x20, 'ftyp'))).toBe('m4a');
    expect(sniffAudio(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('webm');
  });

  it('refuses anything else, whatever its name claims', () => {
    expect(sniffAudio(bytes('%PDF-1.7'))).toBeNull();
    expect(sniffAudio(bytes('<html>'))).toBeNull();
    expect(sniffAudio(new Uint8Array(4))).toBeNull();
  });
});

describe('joining pieces of a long recording', () => {
  it('shifts times by each piece offset and keeps the order', () => {
    const turns = mergeTurns([
      { offsetMs: 0, turns: [{ startMs: 0, endMs: 4000, transcript: 'Selamat pagi semua.', speaker: 'A' }, { startMs: 4000, endMs: 9000, transcript: 'Pagi.', speaker: 'B' }] },
      { offsetMs: 540_000, turns: [{ startMs: 1000, endMs: 5000, transcript: 'Lanjut ke anggaran.', speaker: 'A' }, { startMs: 5000, endMs: 6000, transcript: '   ', speaker: 'B' }] },
    ]);
    expect(turns.map((t) => [t.seq, t.speaker, t.startMs, t.endMs])).toEqual([
      [1, 'A', 0, 4000],
      [2, 'B', 4000, 9000],
      [3, 'A2', 541_000, 545_000], // labels only hold inside one transcription
    ]);
  });

  it('keeps plain labels for a single piece', () => {
    expect(mergeTurns([{ offsetMs: 0, turns: [{ startMs: 0, endMs: 1, transcript: 'Halo', speaker: 'B' }] }])[0].speaker).toBe('B');
  });

  it('writes lines with the time and the name a person gave', () => {
    expect(stamp(605_400)).toBe('10:05');
    expect(transcriptLines([{ speaker: 'A', startMs: 65_000, text: 'Halo' }, { speaker: 'B', startMs: 70_000, text: 'Ya' }], { A: 'Budi' })).toBe('[01:05] Budi: Halo\n[01:10] Pembicara B: Ya');
  });
});

const transcript = '[00:00] Pembicara A: Tolong Dimas siapkan demo kasir untuk Toko Maju minggu depan ya.\n[00:09] Pembicara B: Harganya kemarin disebut dua juta per bulan.';

describe('every draft rests on words that were said (BR-M09-07)', () => {
  it('finds a quote despite case, punctuation and spacing', () => {
    expect(quoteFound(transcript, 'tolong Dimas siapkan demo kasir   untuk toko maju!')).toBe(true);
    expect(quoteFound(transcript, 'Dimas akan mengirim proposal besok')).toBe(false);
    expect(quoteFound(transcript, 'Harganya kemarin')).toBe(false); // too short to prove anything
  });

  it('drops invented items and counts them', () => {
    const minutes: Minutes = {
      summary: 'Membahas demo kasir.',
      decisions: [],
      actionItems: [
        { title: 'Siapkan demo kasir', owner: 'Dimas', quote: 'Dimas siapkan demo kasir untuk Toko Maju' },
        { title: 'Kirim invoice', owner: '', quote: 'kirim invoice sekarang juga ke semua klien' },
      ],
      leads: [],
      mentionedFigures: [{ what: 'Harga per bulan', quote: 'Harganya kemarin disebut dua juta per bulan' }],
    };
    const { minutes: kept, dropped } = keepGrounded(minutes, transcript);
    expect(kept.actionItems.map((a) => a.title)).toEqual(['Siapkan demo kasir']);
    expect(kept.mentionedFigures).toHaveLength(1);
    expect(dropped).toBe(1);
  });
});

describe('minutes text', () => {
  const labels = { summary: 'Ringkasan', decisions: 'Keputusan', actionItems: 'Action item', owner: 'Penanggung jawab', figures: 'Disebut dalam rapat', none: 'Tidak ada' };

  it('quotes figures said in the meeting instead of restating them (BR-M09-06)', () => {
    const text = minutesNarrative(
      { summary: 'Demo kasir dibahas.', decisions: ['Demo hari Senin'], actionItems: [{ title: 'Siapkan demo', owner: 'Dimas', quote: 'siapkan demo kasir' }], leads: [], mentionedFigures: [{ what: 'Harga', quote: 'dua juta per bulan' }] },
      labels,
    );
    expect(text).toContain('Ringkasan\nDemo kasir dibahas.');
    expect(text).toContain('- Demo hari Senin');
    expect(text).toContain('- Siapkan demo (Penanggung jawab: Dimas): "siapkan demo kasir"');
    expect(text).toContain('Disebut dalam rapat\n- Harga: "dua juta per bulan"');
  });

  it('says "none" for empty sections and leaves out the figures section when there are none', () => {
    const text = minutesNarrative({ summary: '', decisions: [], actionItems: [], leads: [], mentionedFigures: [] }, labels);
    expect(text).toBe('Ringkasan\nTidak ada\n\nKeputusan\n- Tidak ada\n\nAction item\n- Tidak ada');
  });

  it('rejects a model answer that does not have the shape', () => {
    expect(minutesSchema.safeParse({ summary: 'x' }).success).toBe(false);
  });
});
