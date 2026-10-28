/**
 * The transcript of a meeting that is still going on (D-051). Muse Voice Transcribe realtime sends events while people
 * talk: `speechStart`, `transcript` partials, `speaker`, `speechEnd`, `speechComplete`. This turns them into turns the
 * interface can show as captions and the database can keep. Pure: it knows nothing about sockets.
 *
 * Rules from the provider's documentation: a partial belongs to the turn opened by the most recent `speechStart`; turns can
 * overlap, so state is keyed by `turnId`; `speechEnd` is only a boundary and the text of a turn is its `speechComplete`;
 * a `speaker` label is meaningful only inside one session.
 */
export interface LiveTurn {
  seq: number;
  speaker: string | null;
  startMs: number;
  endMs: number;
  text: string;
}

export type LiveCaption =
  | { type: 'partial'; turnId: number; speaker: string | null; text: string }
  | { type: 'final'; turnId: number; speaker: string | null; text: string; startMs: number; endMs: number };

interface Open {
  turnId: number;
  speaker: string | null;
  startMs: number;
  endMs: number | null;
  text: string;
  done: boolean;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export class LiveTranscript {
  private readonly open = new Map<number, Open>();
  private current: number | null = null;
  /** The most audio the provider reports having processed, in milliseconds. */
  audioMs = 0;

  /** Feeds one provider event. Returns a caption to show, or null for events that change nothing visible. */
  handle(event: Record<string, unknown>): LiveCaption | null {
    this.audioMs = Math.max(this.audioMs, num(event.audioProcessedMs));
    switch (event.type) {
      case 'speechStart': {
        const turnId = num(event.turnId);
        this.turn(turnId, num(event.audioProcessedMs));
        this.current = turnId;
        return null;
      }
      case 'transcript': {
        // Partials carry no turn id. Without a start event, text still must not be lost: open a turn for it.
        const turn = this.current === null ? this.turn(this.nextImplicitId(), this.audioMs) : this.turn(this.current, this.audioMs);
        this.current = turn.turnId;
        turn.text = str(event.transcript);
        return turn.text.trim() ? { type: 'partial', turnId: turn.turnId, speaker: turn.speaker, text: turn.text } : null;
      }
      case 'speaker': {
        if (this.current !== null) this.turn(this.current, this.audioMs).speaker = str(event.label) || null;
        return null;
      }
      case 'speechEnd': {
        const turn = this.turn(num(event.turnId), this.audioMs);
        turn.endMs = num(event.audioProcessedMs);
        if (this.current === turn.turnId) this.current = null;
        return null;
      }
      case 'speechComplete': {
        const turn = this.turn(num(event.turnId), this.audioMs);
        turn.text = str(event.transcript);
        turn.done = true;
        turn.endMs ??= num(event.audioProcessedMs);
        if (this.current === turn.turnId) this.current = null;
        return turn.text.trim() ? { type: 'final', turnId: turn.turnId, speaker: turn.speaker, text: turn.text.trim(), startMs: turn.startMs, endMs: turn.endMs } : null;
      }
      default:
        return null;
    }
  }

  /** The turns so far in time order. A turn that never completed keeps its last partial: nothing said is dropped. */
  turns(): LiveTurn[] {
    return [...this.open.values()]
      .filter((t) => t.text.trim())
      .sort((a, b) => a.startMs - b.startMs || a.turnId - b.turnId)
      .map((t, i) => ({ seq: i + 1, speaker: t.speaker, startMs: t.startMs, endMs: Math.max(t.endMs ?? this.audioMs, t.startMs), text: t.text.trim() }));
  }

  private turn(turnId: number, startMs: number): Open {
    let turn = this.open.get(turnId);
    if (!turn) {
      turn = { turnId, speaker: null, startMs, endMs: null, text: '', done: false };
      this.open.set(turnId, turn);
    }
    return turn;
  }

  private nextImplicitId(): number {
    return Math.min(0, ...this.open.keys()) - 1;
  }
}
