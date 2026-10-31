import { describe, expect, it } from 'vitest';
import { engineReady, looksLikeWav } from '../../../integrations/speech/voicestudio';
import { silentWav } from './video-support';
import { clipArgs, concatArgs, concatList, estimateMinutes, progressOf, renderSchema, sceneImagePrompt, sceneSeconds, sceneSpeech, wavDurationMs } from '../video-rules';

describe('video rules (D-086)', () => {
  it('reads the length of a WAV from its header, including 48 kHz and a streamed (unknown size) file', () => {
    expect(wavDurationMs(silentWav(2.5))).toBe(2500);
    expect(wavDurationMs(silentWav(1, 24_000))).toBe(1000);
    const streamed = silentWav(3);
    new DataView(streamed.buffer).setUint32(40, 0xffffffff, true);
    expect(wavDurationMs(streamed)).toBe(3000);
    expect(() => wavDurationMs(new Uint8Array(10))).toThrow();
  });

  it('keeps a scene on screen for its narration plus a breath, never under 2.5 s', () => {
    expect(sceneSeconds(1000)).toBe(2.5);
    expect(sceneSeconds(6000)).toBe(6.7);
  });

  it('narrates the spoken form, and spells the written line with the word list when there is none', () => {
    expect(sceneSpeech({ voiceover: 'Software kami', spoken: 'softwer kami' })).toBe('softwer kami');
    expect(sceneSpeech({ voiceover: 'Kirim invoice sekarang', spoken: '  ' })).toContain('invois');
    expect(sceneSpeech({ voiceover: 'x'.repeat(900), spoken: '' }).length).toBeLessThanOrEqual(400);
  });

  it('asks for pictures without any text, logo or number, in the right frame', () => {
    const p = sceneImagePrompt('Tim berdiskusi di kantor.', '#1F3A5F, krem', 'story');
    expect(p).toMatch(/9:16/);
    expect(p).toMatch(/Tanpa teks/);
    expect(p).toContain('#1F3A5F');
    expect(sceneImagePrompt('Meja kerja', null, 'wide')).toMatch(/16:9/);
  });

  it('builds ffmpeg commands with a slow zoom, fades and exact length, and joins clips as AI made', () => {
    const args = clipArgs({ image: '/t/a.jpg', audio: '/t/a.wav', out: '/t/a.mp4', w: 720, h: 1280, seconds: 4 });
    const vf = args[args.indexOf('-vf') + 1]!;
    expect(vf).toContain('zoompan');
    expect(vf).toContain('d=100');
    expect(vf).toContain('s=720x1280');
    expect(vf).toContain('fade=t=out:st=3.70');
    expect(args).toContain('libx264');
    const join = concatArgs({ list: '/t/l.txt', out: '/t/f.mp4', title: 'Judul "ber\nbaris"' });
    expect(join.join(' ')).toContain('comment=Dibuat dengan AI');
    expect(join.find((a) => a.startsWith('title='))).not.toMatch(/["\n]/);
    expect(concatList(["/t/it's.mp4", '/t/b.mp4'])).toBe("file '/t/it'\\''s.mp4'\nfile '/t/b.mp4'");
  });

  it('moves progress forward through the stages and never past 97 before the file is stored', () => {
    const marks = [progressOf('check', 0, 0), progressOf('images', 0, 5), progressOf('images', 5, 5), progressOf('voice', 0, 5), progressOf('voice', 5, 5), progressOf('assemble', 0, 5), progressOf('assemble', 5, 5)];
    expect([...marks].sort((a, b) => a - b)).toEqual(marks);
    expect(Math.max(...marks)).toBe(97);
    expect(progressOf('images', 9, 5)).toBe(45);
  });

  it('estimates minutes from the scenes and the length', () => {
    expect(estimateMinutes(5, 30)).toBe(7);
    expect(estimateMinutes(1, 5)).toBe(2);
  });

  it('accepts only known narrators and shapes, and bounded edits', () => {
    expect(renderSchema.safeParse({ narrator: 'sinta', aspect: 'story' }).success).toBe(true);
    expect(renderSchema.safeParse({ narrator: 'orang-lain', aspect: 'story' }).success).toBe(false);
    expect(renderSchema.safeParse({ narrator: 'sinta', aspect: 'tall' }).success).toBe(false);
    expect(renderSchema.safeParse({ narrator: 'sinta', aspect: 'wide', scenes: [{ spoken: 'x'.repeat(401), onScreenText: '' }] }).success).toBe(false);
  });

  it('trusts the voice engine only when VoxCPM2 is active and available, and audio only when it is a real WAV', () => {
    expect(engineReady({ active: 'voxcpm2', backends: [{ id: 'voxcpm2', available: true }] })).toBe(true);
    expect(engineReady({ active: 'omnivoice', backends: [{ id: 'omnivoice', available: true }, { id: 'voxcpm2', available: true }] })).toBe(false);
    expect(engineReady({ active: 'voxcpm2', backends: [{ id: 'voxcpm2', available: false }] })).toBe(false);
    expect(engineReady({})).toBe(false);
    expect(looksLikeWav(silentWav(1))).toBe(true);
    expect(looksLikeWav(new TextEncoder().encode('{"error":"nope"}'.padEnd(2000, ' ')))).toBe(false);
  });
});
