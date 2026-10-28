import { describe, expect, it } from 'vitest';
import { respellForSpeech } from '../lexicon';

describe('respellForSpeech', () => {
  it('writes English words the way an Indonesian says them, whatever the case', () => {
    expect(respellForSpeech('Kirim Invoice untuk Orbyte sebelum deadline.')).toBe('Kirim invois untuk orbait sebelum dedlain.');
  });

  it('only changes whole words and leaves Indonesian text alone', () => {
    expect(respellForSpeech('Kami membahas invoicenya dan klien Aksara.')).toBe('Kami membahas invoicenya dan klien Aksara.');
    expect(respellForSpeech('Ada 2 tugas terlambat.')).toBe('Ada 2 tugas terlambat.');
  });

  it('reads words typed in capitals as words, and knows the everyday English of image and agency work', () => {
    expect(respellForSpeech('ASIIFDEV DIGITAL AGENCY belum bisa generate image.')).toBe('asiifdev digital ejensi belum bisa generet imej.');
  });
});
