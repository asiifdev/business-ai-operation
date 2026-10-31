import { inflateRawSync } from 'node:zlib';

/**
 * Reads the text of Word, Excel and PowerPoint files (`.docx`, `.xlsx`, `.pptx`) without a library (D-083). These formats are
 * zip archives of XML, and Node already has the one piece that needs (`zlib`). It takes the words and numbers, not the layout,
 * pictures or charts. The file is untrusted: sizes and entry counts are capped so a zip bomb cannot eat memory.
 */
export type OfficeKind = 'document' | 'sheet' | 'slides';

export class OfficeError extends Error {
  constructor(readonly kind: 'legacy' | 'unreadable' | 'too_large' | 'empty') {
    super(kind);
  }
}

const MAX_ENTRIES = 5_000;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_SHEET_ROWS = 3_000;

interface Entry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

function listEntries(zip: Buffer): Entry[] {
  // The end-of-central-directory record sits in the last 64 KB (plus its 22 bytes).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new OfficeError('unreadable');
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff || count > MAX_ENTRIES) throw new OfficeError(count > MAX_ENTRIES ? 'too_large' : 'unreadable');
  const entries: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) throw new OfficeError('unreadable');
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    entries.push({
      method: zip.readUInt16LE(at + 10),
      compressed: zip.readUInt32LE(at + 20),
      size: zip.readUInt32LE(at + 24),
      offset: zip.readUInt32LE(at + 42),
      name: zip.toString('utf8', at + 46, at + 46 + nameLen),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

class Archive {
  private readonly entries: Entry[];
  private inflated = 0;

  constructor(private readonly zip: Buffer) {
    this.entries = listEntries(zip);
  }

  names(): string[] {
    return this.entries.map((e) => e.name);
  }

  read(name: string): string | null {
    const e = this.entries.find((x) => x.name === name);
    if (!e) return null;
    if (e.size > MAX_ENTRY_BYTES) throw new OfficeError('too_large');
    if (this.inflated + e.size > MAX_TOTAL_BYTES) throw new OfficeError('too_large');
    const local = e.offset;
    if (local + 30 > this.zip.length || this.zip.readUInt32LE(local) !== 0x04034b50) throw new OfficeError('unreadable');
    const start = local + 30 + this.zip.readUInt16LE(local + 26) + this.zip.readUInt16LE(local + 28);
    const raw = this.zip.subarray(start, start + e.compressed);
    try {
      const data = e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }) : null;
      if (!data) throw new OfficeError('unreadable');
      this.inflated += data.length;
      return data.toString('utf8');
    } catch (error) {
      if (error instanceof OfficeError) throw error;
      throw new OfficeError('unreadable');
    }
  }
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => safeChar(Number(d)))
    .replace(/&amp;/g, '&');
const safeChar = (code: number) => (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '');
const tidy = (s: string) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const numeric = (names: string[], prefix: string) =>
  names.filter((n) => n.startsWith(prefix) && n.endsWith('.xml')).sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));

/** All `<tag>…</tag>` bodies, in order. */
const all = (xml: string, tag: string): string[] => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]!);
const textRuns = (xml: string, tag: string) => all(xml, tag).map(decode).join('');

function docx(zip: Archive): string {
  const xml = zip.read('word/document.xml');
  if (!xml) throw new OfficeError('unreadable');
  const body = xml
    .replace(/<w:(?:instrText|delText)[^>]*>[\s\S]*?<\/w:(?:instrText|delText)>/g, '')
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:(?:br|cr)[^>]*\/>/g, '\n')
    .replace(/<\/w:p>\s*<\/w:tc>/g, ' | ')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n');
  return tidy(decode(body.replace(/<[^>]+>/g, '')));
}

function xlsx(zip: Archive): string {
  const shared = (zip.read('xl/sharedStrings.xml') ? all(zip.read('xl/sharedStrings.xml')!, 'si') : []).map((si) => textRuns(si, 't'));
  const workbook = zip.read('xl/workbook.xml') ?? '';
  const sheetNames = [...workbook.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map((m) => decode(m[1]!));
  const sheets = numeric(zip.names(), 'xl/worksheets/sheet');
  const out: string[] = [];
  sheets.forEach((file, i) => {
    const xml = zip.read(file) ?? '';
    const rows: string[] = [];
    for (const row of all(xml, 'row')) {
      if (rows.length >= MAX_SHEET_ROWS) {
        rows.push('… (baris selanjutnya dipotong)');
        break;
      }
      const cells = [...row.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((m) => {
        const attrs = m[1]!;
        const inner = m[2] ?? '';
        const type = /\bt="(\w+)"/.exec(attrs)?.[1];
        const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = '';
        if (type === 's' && v !== undefined) value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = textRuns(inner, 't');
        else if (type === 'b') value = v === '1' ? 'BENAR' : 'SALAH';
        else if (v !== undefined) value = decode(v);
        return { ref, value };
      });
      if (cells.some((c) => c.value !== '')) rows.push(cells.map((c) => c.value).join('\t'));
    }
    if (rows.length) out.push(`## Lembar: ${sheetNames[i] ?? `Sheet${i + 1}`}\n${rows.join('\n')}`);
  });
  return tidy(out.join('\n\n'));
}

function pptx(zip: Archive): string {
  const names = zip.names();
  const textOf = (file: string) =>
    all(zip.read(file) ?? '', 'a:p')
      .map((p) => textRuns(p, 'a:t'))
      .filter(Boolean)
      .join('\n');
  const notes = new Map(numeric(names, 'ppt/notesSlides/notesSlide').map((f) => [f.replace(/\D/g, ''), textOf(f)]));
  const out = numeric(names, 'ppt/slides/slide').map((file, i) => {
    const note = notes.get(file.replace(/\D/g, ''));
    return `## Slide ${i + 1}\n${textOf(file)}${note ? `\n(Catatan pembicara: ${note})` : ''}`;
  });
  return tidy(out.join('\n\n'));
}

const EXTENSION: Record<string, OfficeKind> = { docx: 'document', xlsx: 'sheet', pptx: 'slides' };
export const officeKindOf = (fileName: string): OfficeKind | null => EXTENSION[fileName.toLowerCase().split('.').pop() ?? ''] ?? null;
/** Old binary Word, Excel and PowerPoint files (`.doc`, `.xls`, `.ppt`) start with the OLE signature. They cannot be read here. */
export const isLegacyOffice = (bytes: Uint8Array) => bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;

export function readOffice(bytes: Uint8Array, kind: OfficeKind): string {
  if (isLegacyOffice(bytes)) throw new OfficeError('legacy');
  const zip = new Archive(Buffer.from(bytes));
  const text = kind === 'document' ? docx(zip) : kind === 'sheet' ? xlsx(zip) : pptx(zip);
  if (!text) throw new OfficeError('empty');
  return text;
}
