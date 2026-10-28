import { z } from 'zod';

/** Upload limit for one recording. Pieces sent to the model are cut to 9 minutes anyway (BR-M09-01). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Longest recording processed: about an hour of a meeting, a few cents of transcription. */
export const MAX_DURATION_MS = 60 * 60 * 1000;

export type AudioFormat = 'mp3' | 'wav' | 'm4a' | 'ogg' | 'webm';

/**
 * The audio formats accepted (BR-M09-02), recognised from the file's first bytes rather than its name or the MIME type
 * the browser claims. Everything is converted to WAV before transcription.
 */
export function sniffAudio(bytes: Uint8Array): AudioFormat | null {
  const at = (i: number, ...v: number[]) => v.every((b, k) => bytes[i + k] === b);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  if (bytes.length < 12) return null;
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'wav';
  if (ascii(0, 'OggS')) return 'ogg';
  if (ascii(0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'mp3';
  if (ascii(4, 'ftyp')) return 'm4a';
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'webm';
  return null;
}

export interface SegmentTurns {
  offsetMs: number;
  turns: Array<{ startMs: number; endMs: number; transcript: string; speaker?: string }>;
}

/**
 * Joins the turns of each piece in order, shifting times by the piece's offset. Speaker labels from Muse are only valid
 * inside one transcription, so `A` in the second piece is not known to be `A` in the first: labels of later pieces get
 * the piece number (`A2`, `B2`) and a person maps them to names (BR-M09-12). Empty turns are dropped.
 */
export function mergeTurns(segments: SegmentTurns[]): Array<{ seq: number; speaker: string | null; startMs: number; endMs: number; text: string }> {
  const out: Array<{ seq: number; speaker: string | null; startMs: number; endMs: number; text: string }> = [];
  segments.forEach((segment, index) => {
    for (const turn of segment.turns) {
      const text = turn.transcript.trim();
      if (!text) continue;
      const speaker = turn.speaker ? (index === 0 || segments.length === 1 ? turn.speaker : `${turn.speaker}${index + 1}`) : null;
      out.push({ seq: out.length + 1, speaker, startMs: segment.offsetMs + turn.startMs, endMs: segment.offsetMs + turn.endMs, text });
    }
  });
  return out;
}

/** `12:05` for a position in the recording. */
export function stamp(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** `[12:05] Budi: …` lines for the model and for people. Names come from the person's speaker map when set. */
export function transcriptLines(turns: Array<{ speaker: string | null; startMs: number; text: string }>, speakerMap: Record<string, string> = {}): string {
  return turns
    .map((t) => `[${stamp(t.startMs)}] ${t.speaker ? (speakerMap[t.speaker] ?? `Pembicara ${t.speaker}`) : '?'}: ${t.text}`)
    .join('\n');
}

/** What the model must return (structured output). Every item carries the exact words it rests on (BR-M09-07). */
export const minutesSchema = z.object({
  summary: z.string().max(3000),
  decisions: z.array(z.string().max(500)).max(30),
  actionItems: z.array(z.object({ title: z.string().max(200), owner: z.string().max(120), quote: z.string().max(600) })).max(30),
  leads: z.array(z.object({ name: z.string().max(120), contactName: z.string().max(120), needs: z.string().max(1000), quote: z.string().max(600) })).max(10),
  mentionedFigures: z.array(z.object({ what: z.string().max(200), quote: z.string().max(600) })).max(30),
});
export type Minutes = z.infer<typeof minutesSchema>;

const str = (maxLength: number) => ({ type: 'string', maxLength });
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

/** The same shape as JSON Schema for `strict` structured output (skill meta-model-api-integration section 4). */
export const MINUTES_JSON_SCHEMA = obj({
  summary: str(3000),
  decisions: { type: 'array', items: str(500) },
  actionItems: { type: 'array', items: obj({ title: str(200), owner: str(120), quote: str(600) }) },
  leads: { type: 'array', items: obj({ name: str(120), contactName: str(120), needs: str(1000), quote: str(600) }) },
  mentionedFigures: { type: 'array', items: obj({ what: str(200), quote: str(600) }) },
});

const norm = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Whether a quote really is in the transcript. A model can invent a sentence; an item whose quote is not there is
 * dropped, so every draft can be traced to words that were actually said (BR-M09-07). Case, punctuation and spacing do
 * not matter; at least four words are needed so a stray "ya" proves nothing.
 */
export function quoteFound(transcript: string, quote: string): boolean {
  const q = norm(quote);
  return q.split(' ').filter(Boolean).length >= 4 && norm(transcript).includes(q);
}

/** Keeps only items whose quote is found, and reports how many were dropped. */
export function keepGrounded(minutes: Minutes, transcript: string): { minutes: Minutes; dropped: number } {
  const ok = <T extends { quote: string }>(items: T[]) => items.filter((i) => quoteFound(transcript, i.quote));
  const kept = { ...minutes, actionItems: ok(minutes.actionItems), leads: ok(minutes.leads), mentionedFigures: ok(minutes.mentionedFigures) };
  const dropped = minutes.actionItems.length - kept.actionItems.length + (minutes.leads.length - kept.leads.length) + (minutes.mentionedFigures.length - kept.mentionedFigures.length);
  return { minutes: kept, dropped };
}

export interface MinutesLabels {
  summary: string;
  decisions: string;
  actionItems: string;
  owner: string;
  figures: string;
  none: string;
}

/** The minutes as the text of the minutes document. Figures said in the meeting are quoted, never restated (BR-M09-06). */
export function minutesNarrative(m: Minutes, labels: MinutesLabels): string {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : `- ${labels.none}`);
  const parts = [
    `${labels.summary}\n${m.summary.trim() || labels.none}`,
    `${labels.decisions}\n${list(m.decisions.map((d) => d.trim()).filter(Boolean))}`,
    `${labels.actionItems}\n${list(m.actionItems.map((a) => `${a.title.trim()}${a.owner.trim() ? ` (${labels.owner}: ${a.owner.trim()})` : ''}: "${a.quote.trim()}"`))}`,
  ];
  if (m.mentionedFigures.length) parts.push(`${labels.figures}\n${list(m.mentionedFigures.map((f) => `${f.what.trim()}: "${f.quote.trim()}"`))}`);
  return parts.join('\n\n');
}
