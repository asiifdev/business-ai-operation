import { z } from 'zod';
import { NARRATOR_KEYS } from '../../config/narrators';
import { respellForSpeech } from '../../integrations/speech/lexicon';
import { ASPECTS } from './rules';

// D-086. Pure rules for the slideshow video: the sizes, what a scene says, the ffmpeg commands, the progress. No I/O here,
// so all of it is testable without ffmpeg, the voice engine or the network.

/** The shapes a video may have. The picture comes from Muse Image at `ASPECTS[key]`; the video is cut to `w` x `h`. */
export const VIDEO_ASPECTS = {
  story: { w: 720, h: 1280 },
  square: { w: 1024, h: 1024 },
  wide: { w: 1280, h: 720 },
} as const;
export type VideoAspect = keyof typeof VIDEO_ASPECTS;
export const VIDEO_ASPECT_KEYS = Object.keys(VIDEO_ASPECTS) as [VideoAspect, ...VideoAspect[]];
export const imageSizeOf = (aspect: VideoAspect) => ASPECTS[aspect];

export interface StoredScene {
  from: number;
  to: number;
  visual: string;
  voiceover: string;
  /** The narration written the way it is said aloud (English words spelled as an Indonesian says them). */
  spoken?: string;
  onScreenText: string;
}

/** The person's own edits to the script before the video is made: only what is said and what is shown as text. */
export const renderSchema = z.object({
  narrator: z.enum(NARRATOR_KEYS),
  aspect: z.enum(VIDEO_ASPECT_KEYS),
  scenes: z.array(z.object({ spoken: z.string().trim().max(400), onScreenText: z.string().trim().max(60) })).max(12).optional(),
});
export type RenderInput = z.input<typeof renderSchema>;

/** What the narrator reads for a scene: the spoken form, or, when there is none, the written line spelled with the word list. */
export function sceneSpeech(scene: Pick<StoredScene, 'voiceover' | 'spoken'>): string {
  const text = scene.spoken?.trim() ? scene.spoken.trim() : respellForSpeech(scene.voiceover);
  return text.replace(/\s+/g, ' ').trim().slice(0, 400);
}

/** The picture prompt for one scene. Pictures never carry text or a logo: code draws those (BR-M10-01). */
export function sceneImagePrompt(visual: string, colors: string | null | undefined, aspect: VideoAspect): string {
  const frame = aspect === 'story' ? 'komposisi vertikal 9:16' : aspect === 'wide' ? 'komposisi lebar 16:9' : 'komposisi persegi';
  return [
    `${visual.trim().replace(/[.\s]+$/, '')}.`,
    `Foto komersial modern yang bersih, pencahayaan lembut, ${frame}, subjek jelas, ruang kosong di bagian bawah gambar.`,
    colors?.trim() ? `Selaraskan nuansa warna dengan: ${colors.trim()}.` : '',
    'Tanpa teks, tanpa huruf, tanpa angka, tanpa logo, tanpa watermark.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Length of a PCM WAV in milliseconds, read from its header (VoiceStudio gives 48 kHz, which the transcription checker refuses). */
export function wavDurationMs(bytes: Uint8Array): number {
  if (bytes.byteLength < 44 || String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF') throw new Error('not a WAV file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let byteRate = 0;
  let dataBytes = -1;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') byteRate = view.getUint32(offset + 16, true);
    if (id === 'data') {
      // A streamed WAV may say 0 or 0xFFFFFFFF; then the rest of the file is the data.
      dataBytes = size === 0 || size === 0xffffffff || offset + 8 + size > bytes.byteLength ? bytes.byteLength - offset - 8 : size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (byteRate <= 0 || dataBytes < 0) throw new Error('unreadable WAV header');
  return Math.round((dataBytes / byteRate) * 1000);
}

/** How long a scene's picture stays: the narration plus a short breath, never shorter than 2.5 s. */
export const sceneSeconds = (audioMs: number) => Math.max(2.5, Math.round((audioMs / 1000 + 0.7) * 10) / 10);

export const FPS = 25;
export const FADE_S = 0.3;

/** ffmpeg arguments that turn one picture and its narration into a clip: slow zoom, short fades, h264 + aac. */
export function clipArgs(input: { image: string; audio: string; out: string; w: number; h: number; seconds: number }): string[] {
  const { w, h, seconds } = input;
  const frames = Math.round(seconds * FPS);
  const fadeOut = Math.max(0, seconds - FADE_S).toFixed(2);
  const vf = [
    `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase`,
    `crop=${w * 2}:${h * 2}`,
    `zoompan=z='min(zoom+0.0006,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${FPS}`,
    `fade=t=in:st=0:d=${FADE_S}`,
    `fade=t=out:st=${fadeOut}:d=${FADE_S}`,
    'format=yuv420p',
  ].join(',');
  return ['-y', '-loop', '1', '-i', input.image, '-i', input.audio, '-vf', vf, '-af', `apad=whole_dur=${seconds},aresample=48000`, '-t', String(seconds), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-ac', '1', '-shortest', input.out];
}

/** ffmpeg arguments that join clips with identical settings into one MP4, marked as AI made in its metadata. */
export function concatArgs(input: { list: string; out: string; title: string }): string[] {
  const clean = input.title.replace(/[\r\n"]/g, ' ').slice(0, 120);
  return ['-y', '-f', 'concat', '-safe', '0', '-i', input.list, '-c', 'copy', '-movflags', '+faststart', '-metadata', `title=${clean}`, '-metadata', 'comment=Dibuat dengan AI (Orbyte): gambar oleh Muse Image, suara oleh mesin suara lokal', input.out];
}

/** The text file `concat` reads. Paths are ours (a temp folder), but a quote is escaped anyway. */
export const concatList = (paths: readonly string[]) => paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');

export type VideoStage = 'check' | 'images' | 'voice' | 'assemble';

/** One progress number from the stage and how many scenes of that stage are done (images 5-45, voice 45-75, assemble 75-97). */
export function progressOf(stage: VideoStage, done: number, total: number): number {
  const part = total > 0 ? Math.min(done, total) / total : 0;
  if (stage === 'check') return 2;
  if (stage === 'images') return Math.round(5 + part * 40);
  if (stage === 'voice') return Math.round(45 + part * 30);
  return Math.round(75 + part * 22);
}

/** A rough minutes estimate shown before starting: about 55 s per picture and 3x the speech length for the voice. */
export function estimateMinutes(scenes: number, seconds: number): number {
  return Math.max(2, Math.round((scenes * 55 + seconds * 3 + 30) / 60));
}
