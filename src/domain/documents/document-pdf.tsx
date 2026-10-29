import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { organizations } from '../../db/schema';
import { longDate } from '../../lib/dates';
import { formatRupiah } from '../../lib/format';
// Registers the embedded IBM Plex Sans files and the no-hyphenation rule once for every PDF (D-022, D-040).
import '../billing/invoice-pdf';
import type { Ctx } from '../ctx';
import { getDocument, type DocumentDetail } from './service';

type Locale = 'id' | 'en';

export interface PrintableDocument extends Pick<DocumentDetail, 'kind' | 'status' | 'number' | 'version' | 'title' | 'narrative' | 'items' | 'subtotal' | 'taxAmount' | 'taxRateBps' | 'total' | 'validUntil' | 'isAiDraft'> {
  locale: Locale;
  orgName: string;
  recipient: string | null;
  finalizedAt: Date | null;
}

const L = {
  id: { proposal: 'PROPOSAL', quotation: 'QUOTATION', minutes: 'NOTULEN', for: 'Untuk', number: 'Nomor', version: 'Versi', date: 'Tanggal', valid: 'Berlaku sampai', desc: 'Deskripsi', qty: 'Jml', price: 'Harga satuan', amount: 'Jumlah', subtotal: 'Subtotal', tax: 'Pajak', total: 'Total', page: 'Halaman', draft: 'DRAF', ai: 'DIBANTU AI · BELUM DITINJAU', none: 'Belum diberi nomor' },
  en: { proposal: 'PROPOSAL', quotation: 'QUOTATION', minutes: 'MINUTES', for: 'Prepared for', number: 'Number', version: 'Version', date: 'Date', valid: 'Valid until', desc: 'Description', qty: 'Qty', price: 'Unit price', amount: 'Amount', subtotal: 'Subtotal', tax: 'Tax', total: 'Total', page: 'Page', draft: 'DRAFT', ai: 'AI-ASSISTED · NOT REVIEWED', none: 'Not numbered yet' },
} as const;

const INK = '#14213d';
const MUTED = '#5b6478';
const RULE = '#d9dde6';
const BRAND = '#1f4f9e';

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 56, paddingHorizontal: 44, fontSize: 10, fontFamily: 'IBM Plex Sans', color: INK },
  body: { lineHeight: 1.4 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  org: { fontSize: 15, fontWeight: 'bold', color: BRAND },
  kind: { fontSize: 22, fontWeight: 'bold', textAlign: 'right', letterSpacing: 1 },
  stamp: { marginTop: 4, alignSelf: 'flex-end', borderWidth: 1, borderColor: MUTED, color: MUTED, paddingHorizontal: 6, paddingVertical: 1, fontSize: 9, fontWeight: 'bold' },
  title: { marginTop: 24, fontSize: 16, fontWeight: 'bold' },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  label: { fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  strong: { fontWeight: 'bold' },
  metaRight: { width: 200 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  narrative: { marginTop: 22 },
  para: { marginBottom: 8 },
  table: { marginTop: 22, borderTopWidth: 1, borderTopColor: INK },
  th: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: RULE, color: MUTED, fontSize: 8, textTransform: 'uppercase' },
  tr: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: RULE },
  cDesc: { flex: 1, paddingRight: 8 },
  cQty: { width: 36, textAlign: 'right' },
  cPrice: { width: 92, textAlign: 'right' },
  cAmount: { width: 96, textAlign: 'right' },
  totals: { marginTop: 14, alignSelf: 'flex-end', width: 250 },
  totRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  grand: { borderTopWidth: 1, borderTopColor: INK, marginTop: 4, paddingTop: 6, fontSize: 12, fontWeight: 'bold' },
  footerLeft: { position: 'absolute', bottom: 28, left: 44, fontSize: 8, color: MUTED },
  footerRight: { position: 'absolute', bottom: 28, left: 0, right: 44, textAlign: 'right', fontSize: 8, color: MUTED },
});

/** Everything the PDF shows, read from the stored document: no figure is recalculated here (BR-M06-06). */
export async function buildPrintableDocument(ctx: Ctx, id: string): Promise<PrintableDocument> {
  const d = await getDocument(ctx, id);
  const [org] = await db.select({ name: organizations.name, locale: organizations.locale }).from(organizations).where(eq(organizations.id, ctx.orgId));
  return {
    kind: d.kind,
    status: d.status,
    number: d.number,
    version: d.version,
    title: d.title,
    narrative: d.narrative,
    items: d.items,
    subtotal: d.subtotal,
    taxAmount: d.taxAmount,
    taxRateBps: d.taxRateBps,
    total: d.total,
    validUntil: d.validUntil,
    isAiDraft: d.isAiDraft,
    locale: org.locale,
    orgName: org.name,
    recipient: d.clientName ?? d.leadName,
    finalizedAt: d.finalizedAt,
  };
}

/** The printable proposal, quotation or minutes. A pure view of a `PrintableDocument`. */
export function DocumentPdf({ doc }: { doc: PrintableDocument }) {
  const l = L[doc.locale];
  const priced = doc.kind !== 'minutes' && doc.items.length > 0;
  const paragraphs = (doc.narrative ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const stamp = doc.isAiDraft ? l.ai : doc.status === 'draft' ? l.draft : null;
  return (
    <Document title={`${l[doc.kind]} ${doc.number ?? ''}`.trim()} author={doc.orgName}>
      <Page size="A4" style={s.page}>
        <View style={s.body}>
          <View style={s.head}>
            <Text style={s.org}>{doc.orgName}</Text>
            <View>
              <Text style={s.kind}>{l[doc.kind]}</Text>
              {stamp && <Text style={s.stamp}>{stamp}</Text>}
            </View>
          </View>

          <Text style={s.title}>{doc.title}</Text>

          <View style={s.meta}>
            <View style={{ maxWidth: 260 }}>
              {doc.recipient && (
                <>
                  <Text style={s.label}>{l.for}</Text>
                  <Text style={s.strong}>{doc.recipient}</Text>
                </>
              )}
            </View>
            <View style={s.metaRight}>
              <View style={s.metaRow}><Text style={{ color: MUTED }}>{l.number}</Text><Text style={s.strong}>{doc.number ?? l.none}</Text></View>
              {doc.version > 1 && <View style={s.metaRow}><Text style={{ color: MUTED }}>{l.version}</Text><Text>{doc.version}</Text></View>}
              {doc.finalizedAt && <View style={s.metaRow}><Text style={{ color: MUTED }}>{l.date}</Text><Text>{longDate(doc.locale, doc.finalizedAt.toISOString().slice(0, 10))}</Text></View>}
              {doc.validUntil && <View style={s.metaRow}><Text style={{ color: MUTED }}>{l.valid}</Text><Text style={s.strong}>{longDate(doc.locale, doc.validUntil)}</Text></View>}
            </View>
          </View>

          {paragraphs.length > 0 && (
            <View style={s.narrative}>
              {paragraphs.map((p, i) => (
                <Text key={i} style={s.para}>{p}</Text>
              ))}
            </View>
          )}

          {priced && (
            <>
              <View style={s.table}>
                <View style={s.th} fixed>
                  <Text style={s.cDesc}>{l.desc}</Text>
                  <Text style={s.cQty}>{l.qty}</Text>
                  <Text style={s.cPrice}>{l.price}</Text>
                  <Text style={s.cAmount}>{l.amount}</Text>
                </View>
                {doc.items.map((line) => (
                  <View key={line.id} style={s.tr} wrap={false}>
                    <Text style={s.cDesc}>{line.description}</Text>
                    <Text style={s.cQty}>{line.quantity}</Text>
                    <Text style={s.cPrice}>{formatRupiah(line.unitPrice)}</Text>
                    <Text style={s.cAmount}>{formatRupiah(line.lineTotal)}</Text>
                  </View>
                ))}
              </View>
              <View style={s.totals} wrap={false}>
                <View style={s.totRow}><Text style={{ color: MUTED }}>{l.subtotal}</Text><Text>{formatRupiah(doc.subtotal)}</Text></View>
                {doc.taxRateBps > 0 && (
                  <View style={s.totRow}><Text style={{ color: MUTED }}>{`${l.tax} (${String(doc.taxRateBps / 100).replace('.', doc.locale === 'id' ? ',' : '.')}%)`}</Text><Text>{formatRupiah(doc.taxAmount)}</Text></View>
                )}
                <View style={[s.totRow, s.grand]}><Text>{l.total}</Text><Text>{formatRupiah(doc.total)}</Text></View>
              </View>
            </>
          )}
        </View>
        <Text style={s.footerLeft} fixed>{doc.orgName}</Text>
        <Text style={s.footerRight} fixed render={({ pageNumber, totalPages }) => `${l.page} ${pageNumber}/${totalPages}`} />
      </Page>
    </Document>
  );
}

/** The PDF file for one document the caller may see (`document.read`). */
export async function renderDocumentPdf(ctx: Ctx, id: string): Promise<{ buffer: Buffer; filename: string }> {
  const doc = await buildPrintableDocument(ctx, id);
  const buffer = await renderToBuffer(<DocumentPdf doc={doc} />);
  const base = (doc.number ?? `${doc.kind}-draft`).replace(/[^A-Za-z0-9._-]/g, '_');
  return { buffer, filename: `${base}.pdf` };
}
