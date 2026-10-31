import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { OfficeError, officeKindOf, readOffice } from '../ooxml';

/** A zip with the given files, deflated (or stored), good enough for the reader. */
function zip(files: Record<string, string>, method: 0 | 8 = 8): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const body = method === 8 ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

describe('Office files without a library (D-083)', () => {
  it('reads Word paragraphs, tabs and tables, and decodes entities', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Penawaran &amp; Harga</w:t></w:r></w:p><w:p><w:r><w:t>Paket Gold</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Rp 750.000</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
    const text = readOffice(zip({ 'word/document.xml': xml }), 'document');
    expect(text).toContain('Penawaran & Harga');
    expect(text).toContain('Paket Gold\tRp 750.000');
    expect(text).toContain('A | B |');
  });

  it('reads Excel sheets with shared strings, numbers, booleans and sheet names, in sheet order', () => {
    const shared = '<sst><si><t>Klien</t></si><si><t>Nominal</t></si><si><r><t>Toko </t></r><r><t>Maju</t></r></si></sst>';
    const book = '<workbook><sheets><sheet name="Penjualan" sheetId="1" r:id="rId1"/><sheet name="Lain" sheetId="2" r:id="rId2"/></sheets></workbook>';
    const s1 = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1250000</v></c><c r="C2" t="b"><v>1</v></c></row></sheetData></worksheet>';
    const s2 = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>catatan</t></is></c></row></sheetData></worksheet>';
    const text = readOffice(zip({ 'xl/sharedStrings.xml': shared, 'xl/workbook.xml': book, 'xl/worksheets/sheet1.xml': s1, 'xl/worksheets/sheet2.xml': s2 }), 'sheet');
    expect(text).toContain('## Lembar: Penjualan\nKlien\tNominal\nToko Maju\t1250000\tBENAR');
    expect(text.indexOf('Penjualan')).toBeLessThan(text.indexOf('Lain'));
    expect(text).toContain('catatan');
  });

  it('reads PowerPoint slides in numeric order with speaker notes', () => {
    const slide = (t: string) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    const text = readOffice(zip({ 'ppt/slides/slide10.xml': slide('Sepuluh'), 'ppt/slides/slide2.xml': slide('Dua'), 'ppt/notesSlides/notesSlide2.xml': slide('Sebut diskon') }, 0), 'slides');
    expect(text.indexOf('Dua')).toBeLessThan(text.indexOf('Sepuluh'));
    expect(text).toContain('(Catatan pembicara: Sebut diskon)');
  });

  it('refuses old binary Office files, broken archives and files with no text', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(() => readOffice(ole, 'document')).toThrowError(expect.objectContaining({ kind: 'legacy' }));
    expect(() => readOffice(new Uint8Array(100), 'document')).toThrowError(OfficeError);
    expect(() => readOffice(zip({ 'word/document.xml': '<w:document><w:body></w:body></w:document>' }), 'document')).toThrowError(expect.objectContaining({ kind: 'empty' }));
  });

  it('maps file extensions to kinds', () => {
    expect(officeKindOf('Laporan.DOCX')).toBe('document');
    expect(officeKindOf('a.xlsx')).toBe('sheet');
    expect(officeKindOf('a.pptx')).toBe('slides');
    expect(officeKindOf('a.doc')).toBeNull();
  });
});
