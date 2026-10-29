/** The part of fontkit 2 that poster text uses: outlines and advances of a laid out line (D-067). */
declare module 'fontkit' {
  export interface Glyph {
    path: { toSVG(): string };
  }
  export interface Position {
    xAdvance: number;
    xOffset: number;
    yOffset: number;
  }
  export interface Font {
    unitsPerEm: number;
    layout(text: string): { glyphs: Glyph[]; positions: Position[] };
  }
  export function openSync(path: string): Font;
}
