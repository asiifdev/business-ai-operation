import { PiperSpeech, speechEnabled } from './piper';
import type { SpeechProvider } from './provider';

let current: SpeechProvider | undefined;

/** The speech engine, or null when spoken replies are off or Piper is not installed. Tests swap it with `setSpeechProvider`. */
export function getSpeechProvider(): SpeechProvider | null {
  if (current) return current;
  return speechEnabled() ? (current = new PiperSpeech()) : null;
}

export function setSpeechProvider(provider: SpeechProvider | undefined): void {
  current = provider;
}
