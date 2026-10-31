/**
 * The narrators a video can use (D-086). A narrator is a name, a voice description for the voice engine and a fixed `seed`,
 * so the same narrator sounds the same in every video. They live here, not in the voice engine's own profile list, so a
 * lost profile or a new laptop never loses a narrator.
 *
 * `sinta` is the voice picked by the owner after the first listening test (2026-10-31). The description is Indonesian on
 * purpose: tests showed an English description makes the engine read acronyms letter by letter ("ei ai"), while this one
 * reads Indonesian text with a natural accent. A male narrator is not offered yet: English descriptions give a male voice
 * but fail that reading test, and Indonesian ones came out female.
 */
export interface Narrator {
  key: string;
  name: string;
  /** Plain-words label shown under the name. */
  blurb: string;
  /** Sent to the voice engine as the voice design description. */
  description: string;
  seed: number;
  language: 'id';
}

export const NARRATORS = {
  sinta: { key: 'sinta', name: 'Sinta', blurb: 'Perempuan dewasa, tenang dan hangat', description: 'perempuan dewasa, suara tenang, hangat, profesional, tempo sedang', seed: 7, language: 'id' },
} as const satisfies Record<string, Narrator>;

export type NarratorKey = keyof typeof NARRATORS;
export const NARRATOR_KEYS = Object.keys(NARRATORS) as [NarratorKey, ...NarratorKey[]];
export const DEFAULT_NARRATOR: NarratorKey = 'sinta';

export const narratorOf = (key: string): Narrator => (NARRATORS as Record<string, Narrator>)[key] ?? NARRATORS[DEFAULT_NARRATOR];
