/**
 * The narrators a video can use (D-086). A narrator is a name plus ONE fixed reference recording, so every scene of every
 * video is read by the same voice. A voice described only in words is not enough: tested, each scene came out with a
 * slightly different voice, because the engine invents a new one for each text. The reference makes the voice a clone of
 * a sample that this application itself generated (synthetic, no person's voice), kept in `src/config/voices/`.
 *
 * `sinta` is the voice the owner picked after the first listening test (2026-10-31). A male narrator is not offered yet:
 * descriptions in English give a male voice but read acronyms letter by letter, and Indonesian ones came out female.
 */
export interface Narrator {
  key: string;
  name: string;
  /** Plain-words label shown under the name. */
  blurb: string;
  /** The name of the voice profile kept in the voice engine; created from the reference the first time it is needed. */
  profile: string;
  /** The recording in `src/config/voices/`, and the exact words spoken in it. */
  reference: { file: string; text: string };
  seed: number;
  language: 'id';
}

export const NARRATORS = {
  sinta: {
    key: 'sinta',
    name: 'Sinta',
    blurb: 'Perempuan dewasa, tenang dan hangat',
    profile: 'Sinta (Orbyte)',
    reference: {
      file: 'sinta.wav',
      text: 'ASIIFDEV Digital Agency adalah perusahaan teknologi yang berfokus pada AI Engineering, Software Development, dan IT Outsourcing. Kami mengutamakan pemahaman proses bisnis sebelum menentukan solusi teknologi yang tepat.',
    },
    seed: 7,
    language: 'id',
  },
} as const satisfies Record<string, Narrator>;

export type NarratorKey = keyof typeof NARRATORS;
export const NARRATOR_KEYS = Object.keys(NARRATORS) as [NarratorKey, ...NarratorKey[]];
export const DEFAULT_NARRATOR: NarratorKey = 'sinta';

export const narratorOf = (key: string): Narrator => (NARRATORS as Record<string, Narrator>)[key] ?? NARRATORS[DEFAULT_NARRATOR];
