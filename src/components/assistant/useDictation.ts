import { useEffect, useRef, useState } from 'react';
import { upload } from '../../lib/api-client';

export type DictationState = 'idle' | 'recording' | 'transcribing';
export type DictationProblem = 'denied' | 'unsupported' | 'empty' | 'failed' | null;

const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
/** A recording longer than this stops by itself, so one forgotten tap never records for long. */
const MAX_MS = 120_000;

/**
 * Speaking instead of typing: records from the microphone, sends the recording to `/api/assistant/dictate` (Muse Voice Transcribe)
 * and hands the words to `onText`. The words land in the box for the person to read and send; nothing is sent by itself.
 */
export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>('idle');
  const [problem, setProblem] = useState<DictationProblem>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const supported = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  function release() {
    window.clearTimeout(timer.current);
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    recorder.current = null;
  }

  async function send(blob: Blob) {
    setState('transcribing');
    try {
      const form = new FormData();
      form.append('audio', blob, blob.type.includes('mp4') ? 'voice.m4a' : 'voice.webm');
      const out = await upload<{ ok: true; text: string } | { ok: false; reason: string }>('/api/assistant/dictate', form);
      if (out.ok) onTextRef.current(out.text);
      else setProblem(out.reason === 'empty' ? 'empty' : 'failed');
    } catch {
      setProblem('failed');
    } finally {
      setState('idle');
    }
  }

  async function start() {
    if (state !== 'idle') return;
    setProblem(null);
    if (!supported) return setProblem('unsupported');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setProblem('denied');
    }
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
      release();
      if (blob.size < 1500) {
        setState('idle');
        setProblem('empty');
      } else void send(blob);
    };
    recorder.current = rec;
    rec.start();
    setState('recording');
    timer.current = window.setTimeout(() => stop(), MAX_MS);
  }

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  // Leaving the page while recording releases the microphone.
  useEffect(() => release, []);

  return { state, problem, supported, toggle: () => (state === 'recording' ? stop() : void start()), clearProblem: () => setProblem(null) };
}
