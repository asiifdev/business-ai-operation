import { useEffect, useRef, useState } from 'react';
import type { MessageKey } from '../../lib/i18n';
import { useT } from '../../lib/use-t';
import { Checkbox } from '../forms/Checkbox';
import { FormField } from '../forms/FormField';
import { RadioGroup } from '../forms/RadioGroup';
import { TextInput } from '../forms/TextInput';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';

type Phase = 'idle' | 'connecting' | 'live' | 'saving' | 'saved' | 'empty';
type Source = 'mic' | 'mic_tab';
interface Line { turnId: number; speaker: string | null; text: string }

/** Runs inside the audio thread: 128-sample blocks in, 80 ms frames of 16-bit PCM out (1,920 samples at 24 kHz). */
const WORKLET = `
class Pcm extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1920); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === 1920) {
        const out = new Int16Array(1920);
        for (let k = 0; k < 1920; k++) { const s = Math.max(-1, Math.min(1, this.buf[k])); out[k] = s < 0 ? s * 32768 : s * 32767; }
        this.port.postMessage(out.buffer, [out.buffer]);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-24k', Pcm);`;

const ERROR_KEY: Record<string, MessageKey> = { budget: 'lvErrBudget', forbidden: 'lvErrForbidden', rate_limited: 'lvErrRate', unavailable: 'lvErrService', config: 'lvErrService', timeout: 'lvErrService' };

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * A meeting transcribed while it happens (D-051). The browser captures the microphone, and optionally the audio of a meeting
 * tab, as 24 kHz PCM and streams it to our server, which relays it to the realtime transcription service. Captions come back
 * as people speak; at the end the transcript becomes a meeting and the minutes are written like for an upload. Audio is not
 * recorded anywhere.
 */
export function LiveMeeting() {
  const t = useT();
  const [title, setTitle] = useState('');
  const [source, setSource] = useState<Source>('mic');
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [partial, setPartial] = useState<Line | null>(null);
  const [seconds, setSeconds] = useState(0);
  const stopRef = useRef<() => void>(() => undefined);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => stopRef.current(), []);
  useEffect(() => {
    if (phase !== 'live') return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', warn);
    };
  }, [phase]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lines, partial]);

  async function start() {
    setError(null);
    setLines([]);
    setPartial(null);
    setSeconds(0);
    setPhase('connecting');
    const streams: MediaStream[] = [];
    const release = () => streams.forEach((s) => s.getTracks().forEach((track) => track.stop()));
    try {
      streams.push(await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }));
      if (source === 'mic_tab') {
        // The browser asks which tab to share; only its sound is used (the video is dropped).
        const tab = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (tab.getAudioTracks().length === 0) {
          tab.getTracks().forEach((track) => track.stop());
          throw new Error('no-tab-audio');
        }
        streams.push(tab);
      }
    } catch (err) {
      release();
      setError(t(err instanceof Error && err.message === 'no-tab-audio' ? 'lvErrTabAudio' : 'lvErrPermission'));
      return setPhase('idle');
    }

    const audio = new AudioContext({ sampleRate: 24000 });
    const mix = audio.createGain();
    for (const stream of streams) if (stream.getAudioTracks().length) audio.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(mix);
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await audio.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const worklet = new AudioWorkletNode(audio, 'pcm-24k');
    const silent = audio.createGain();
    silent.gain.value = 0;
    mix.connect(worklet);
    worklet.connect(silent).connect(audio.destination);

    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/meetings/live`);
    socket.binaryType = 'arraybuffer';
    let closedByUs = false;
    const teardown = () => {
      worklet.port.onmessage = null;
      worklet.disconnect();
      void audio.close().catch(() => undefined);
      release();
    };
    const stop = () => {
      if (closedByUs) return;
      closedByUs = true;
      teardown();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'stop' }));
        setPhase('saving');
      }
    };
    stopRef.current = stop;
    // Ending the tab share from the browser's own bar ends the meeting too.
    streams[1]?.getAudioTracks()[0]?.addEventListener('ended', stop);

    socket.onopen = () => socket.send(JSON.stringify({ type: 'start', title: title.trim(), consent: true }));
    worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (socket.readyState === WebSocket.OPEN && !closedByUs) socket.send(e.data);
    };
    socket.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { type: string; turnId?: number; speaker?: string | null; text?: string; code?: string; meetingId?: string | null };
      if (m.type === 'ready') setPhase('live');
      else if (m.type === 'partial') setPartial({ turnId: m.turnId!, speaker: m.speaker ?? null, text: m.text! });
      else if (m.type === 'final') {
        setPartial((p) => (p?.turnId === m.turnId ? null : p));
        setLines((all) => [...all.filter((l) => l.turnId !== m.turnId), { turnId: m.turnId!, speaker: m.speaker ?? null, text: m.text! }]);
      } else if (m.type === 'error') {
        closedByUs = true;
        teardown();
        setError(t(ERROR_KEY[m.code ?? ''] ?? 'lvErrConnection'));
        setPhase('idle');
      } else if (m.type === 'ended') {
        closedByUs = true;
        teardown();
        if (m.meetingId) {
          setPhase('saved');
          window.location.assign(`/app/rapat/${m.meetingId}`);
        } else setPhase('empty');
      }
    };
    socket.onclose = () => {
      if (!closedByUs) {
        teardown();
        setError(t('lvErrConnection'));
        setPhase('idle');
      }
    };
  }

  const busy = phase !== 'idle' && phase !== 'empty';
  return (
    <div className="flex flex-col gap-6">
      <a href="/app/rapat" className="w-fit text-sm text-accent underline underline-offset-4">{t('mtBack')}</a>
      <PageHeader title={t('lvTitle')} intro={t('lvIntro')} />
      {(phase === 'idle' || phase === 'empty') && (
        <Panel>
          <form onSubmit={(e) => { e.preventDefault(); void start(); }} noValidate className="flex max-w-2xl flex-col gap-5">
            <FormField label={t('fMeetingTitle')} required>
              <TextInput value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={160} required autoComplete="off" />
            </FormField>
            <FormField label={t('lvSourceLabel')} help={t('lvSourceHelp')}>
              <RadioGroup
                value={source}
                onChange={(v) => setSource(v as Source)}
                options={[
                  { value: 'mic', label: t('lvSourceMic'), description: t('lvSourceMicHelp') },
                  { value: 'mic_tab', label: t('lvSourceTab'), description: t('lvSourceTabHelp') },
                ]}
              />
            </FormField>
            <Checkbox label={t('mtConsent')} description={t('mtConsentHelp')} checked={consent} onChange={setConsent} />
            {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
            {phase === 'empty' && <p role="status" className="m-0 text-sm text-ink-2">{t('lvNoSpeech')}</p>}
            <Button type="submit" variant="primary" className="w-fit" disabled={!consent || title.trim().length < 2}>{t('lvStart')}</Button>
            <p className="m-0 text-sm text-muted">{t('lvPrivacy')}</p>
          </form>
        </Panel>
      )}
      {busy && (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-base font-medium text-ink" role="status" aria-live="polite">
              {phase === 'connecting' ? t('lvConnecting') : phase === 'saving' || phase === 'saved' ? t('lvSaving') : `${t('lvLive')} · ${clock(seconds)}`}
            </p>
            <Button variant="primary" onClick={() => stopRef.current()} disabled={phase !== 'live'}>{t('lvStop')}</Button>
          </div>
          <div ref={listRef} className="mt-4 flex max-h-[60vh] min-h-48 flex-col gap-3 overflow-y-auto" aria-label={t('lvCaptions')}>
            {lines.length === 0 && !partial && <p className="m-0 text-sm text-muted">{t('lvWaiting')}</p>}
            {lines.map((l) => (
              <p key={l.turnId} className="m-0 text-base text-ink">
                {l.speaker && <span className="mr-2 text-sm font-medium text-accent">{t('lvSpeaker', { label: l.speaker })}</span>}
                {l.text}
              </p>
            ))}
            {partial && (
              <p className="m-0 text-base text-ink-2 italic">
                {partial.speaker && <span className="mr-2 text-sm font-medium not-italic text-accent">{t('lvSpeaker', { label: partial.speaker })}</span>}
                {partial.text}
              </p>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
