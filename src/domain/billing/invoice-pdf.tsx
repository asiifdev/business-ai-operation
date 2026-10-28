import { createRequire } from 'node:module';
import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { organizations } from '../../db/schema';
import { longDate } from '../../lib/dates';
import { formatRupiah } from '../../lib/format';
import type { Ctx } from '../ctx';
import { getInvoice } from './invoices';

type Locale = 'id' | 'en';

// IBM Plex Sans is the app's body font. The PDF embeds its static files (react-pdf reads woff/ttf, not woff2 or variable
// fonts), so the invoice looks the same on every machine and nothing depends on a font being installed (D-022).
const require = createRequire(import.meta.url);
const plex = (weight: 400 | 700) => require.resolve(`@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${weight}-normal.woff`);
Font.register({ family: 'IBM Plex Sans', fonts: [{ src: plex(400), fontWeight: 400 }, { src: plex(700), fontWeight: 700 }] });
// Keep words whole: automatic hyphenation breaks Indonesian words at odd places.
Font.registerHyphenationCallback((word) => [word]);

export interface InvoiceDocument {
  locale: Locale;
  org: { name: string; bank: { name: string; accountName: string | null; accountNumber: string } | null };
  client: { name: string; contactName: string | null; email: string | null; phone: string | null; address: string | null };
  number: string | null;
  status: 'draft' | 'sent' | 'paid' | 'void';
  issueDate: string | null;
  dueDate: string;
  lines: { description: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  taxAmount: number;
  taxRateBps: number;
  total: number;
  paid: number;
  balance: number;
  notes: string | null;
}

/**
 * Everything the PDF shows, read from stored data (BR-M03-15). The amounts are the ones saved on the invoice, the same
 * ones the screen shows: nothing is recalculated here, and nothing comes from an AI. Corrections and payments are
 * summed by the same derivation the invoice screen uses.
 */
export async function buildInvoiceDocument(ctx: Ctx, invoiceId: string): Promise<InvoiceDocument> {
  const { invoice, client, items, derived } = await getInvoice(ctx, invoiceId);
  const [org] = await db
    .select({ name: organizations.name, locale: organizations.locale, bankName: organizations.bankName, bankAccountName: organizations.bankAccountName, bankAccountNumber: organizations.bankAccountNumber })
    .from(organizations)
    .where(eq(organizations.id, ctx.orgId));
  return {
    locale: org.locale,
    org: { name: org.name, bank: org.bankName && org.bankAccountNumber ? { name: org.bankName, accountName: org.bankAccountName, accountNumber: org.bankAccountNumber } : null },
    client: { name: client.name, contactName: client.contactName, email: client.email, phone: client.phone, address: client.address },
    number: invoice.number,
    status: invoice.status,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    lines: items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    taxRateBps: invoice.taxRateBps,
    total: invoice.total,
    paid: derived.paid,
    balance: invoice.status === 'paid' ? 0 : Math.max(invoice.total - derived.paid, 0),
    notes: invoice.notes,
  };
}

const L = {
  id: { invoice: 'INVOICE', billTo: 'Ditagihkan kepada', number: 'Nomor', issued: 'Tanggal terbit', due: 'Jatuh tempo', desc: 'Deskripsi', qty: 'Jml', price: 'Harga satuan', amount: 'Jumlah', subtotal: 'Subtotal', tax: 'Pajak', total: 'Total', paid: 'Sudah dibayar', balance: 'Sisa tagihan', notes: 'Catatan', pay: 'Informasi pembayaran', bank: 'Bank', holder: 'Atas nama', account: 'Nomor rekening', page: 'Halaman', draft: 'DRAF', paidStamp: 'LUNAS', voidStamp: 'BATAL', none: 'Belum diberi nomor' },
  en: { invoice: 'INVOICE', billTo: 'Bill to', number: 'Number', issued: 'Issue date', due: 'Due date', desc: 'Description', qty: 'Qty', price: 'Unit price', amount: 'Amount', subtotal: 'Subtotal', tax: 'Tax', total: 'Total', paid: 'Paid', balance: 'Balance due', notes: 'Notes', pay: 'Payment details', bank: 'Bank', holder: 'Account name', account: 'Account number', page: 'Page', draft: 'DRAFT', paidStamp: 'PAID', voidStamp: 'VOID', none: 'Not numbered yet' },
} as const;

// A print document has no CSS variables, so these are the brand colours written once, here.
const INK = '#14213d';
const MUTED = '#5b6478';
const RULE = '#d9dde6';
const BRAND = '#1f4f9e';

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 56, paddingHorizontal: 44, fontSize: 10, fontFamily: 'IBM Plex Sans', color: INK },
  // Not on `page`: a line height there makes react-pdf 4.9 drop the page number (`render` text) from the footer.
  body: { lineHeight: 1.4 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  org: { fontSize: 15, fontWeight: 'bold', color: BRAND },
  title: { fontSize: 22, fontWeight: 'bold', textAlign: 'right', letterSpacing: 1 },
  stamp: { marginTop: 4, alignSelf: 'flex-end', borderWidth: 1, borderColor: MUTED, color: MUTED, paddingHorizontal: 6, paddingVertical: 1, fontSize: 9, fontWeight: 'bold' },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 28 },
  label: { fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  strong: { fontWeight: 'bold' },
  metaRight: { width: 200 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  table: { marginTop: 26, borderTopWidth: 1, borderTopColor: INK },
  th: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: RULE, color: MUTED, fontSize: 8, textTransform: 'uppercase' },
  tr: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: RULE },
  cDesc: { flex: 1, paddingRight: 8 },
  cQty: { width: 36, textAlign: 'right' },
  cPrice: { width: 92, textAlign: 'right' },
  cAmount: { width: 96, textAlign: 'right' },
  totals: { marginTop: 14, alignSelf: 'flex-end', width: 250 },
  totRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  grand: { borderTopWidth: 1, borderTopColor: INK, marginTop: 4, paddingTop: 6, fontSize: 12, fontWeight: 'bold' },
  section: { marginTop: 24 },
  footerLeft: { position: 'absolute', bottom: 28, left: 44, fontSize: 8, color: MUTED },
  footerRight: { position: 'absolute', bottom: 28, left: 0, right: 44, textAlign: 'right', fontSize: 8, color: MUTED },
});

const mono = (n: number) => formatRupiah(n);

/** The printable invoice. A pure view of an `InvoiceDocument`: it adds no figure of its own. */
export function InvoicePdf({ doc }: { doc: InvoiceDocument }) {
  const l = L[doc.locale];
  const date = (iso: string) => longDate(doc.locale, iso);
  const stamp = doc.status === 'draft' ? l.draft : doc.status === 'paid' ? l.paidStamp : doc.status === 'void' ? l.voidStamp : null;
  return (
    <Document title={`${l.invoice} ${doc.number ?? ''}`.trim()} author={doc.org.name}>
      <Page size="A4" style={s.page}>
        <View style={s.body}>
        <View style={s.head}>
          <Text style={s.org}>{doc.org.name}</Text>
          <View>
            <Text style={s.title}>{l.invoice}</Text>
            {stamp && <Text style={s.stamp}>{stamp}</Text>}
          </View>
        </View>

        <View style={s.meta}>
          <View style={{ maxWidth: 260 }}>
            <Text style={s.label}>{l.billTo}</Text>
            <Text style={s.strong}>{doc.client.name}</Text>
            {doc.client.contactName && <Text>{doc.client.contactName}</Text>}
            {doc.client.address && <Text>{doc.client.address}</Text>}
            {doc.client.email && <Text>{doc.client.email}</Text>}
            {doc.client.phone && <Text>{doc.client.phone}</Text>}
          </View>
          <View style={s.metaRight}>
            <View style={s.metaRow}><Text style={{ color: MUTED }}>{l.number}</Text><Text style={s.strong}>{doc.number ?? l.none}</Text></View>
            {doc.issueDate && <View style={s.metaRow}><Text style={{ color: MUTED }}>{l.issued}</Text><Text>{date(doc.issueDate)}</Text></View>}
            <View style={s.metaRow}><Text style={{ color: MUTED }}>{l.due}</Text><Text style={s.strong}>{date(doc.dueDate)}</Text></View>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.th} fixed>
            <Text style={s.cDesc}>{l.desc}</Text>
            <Text style={s.cQty}>{l.qty}</Text>
            <Text style={s.cPrice}>{l.price}</Text>
            <Text style={s.cAmount}>{l.amount}</Text>
          </View>
          {doc.lines.map((line, i) => (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={s.cDesc}>{line.description}</Text>
              <Text style={s.cQty}>{line.quantity}</Text>
              <Text style={s.cPrice}>{mono(line.unitPrice)}</Text>
              <Text style={s.cAmount}>{mono(line.lineTotal)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals} wrap={false}>
          <View style={s.totRow}><Text style={{ color: MUTED }}>{l.subtotal}</Text><Text>{mono(doc.subtotal)}</Text></View>
          {doc.taxRateBps > 0 && (
            <View style={s.totRow}><Text style={{ color: MUTED }}>{`${l.tax} (${String(doc.taxRateBps / 100).replace('.', doc.locale === 'id' ? ',' : '.')}%)`}</Text><Text>{mono(doc.taxAmount)}</Text></View>
          )}
          <View style={[s.totRow, s.grand]}><Text>{l.total}</Text><Text>{mono(doc.total)}</Text></View>
          {doc.paid > 0 && (
            <>
              <View style={s.totRow}><Text style={{ color: MUTED }}>{l.paid}</Text><Text>{mono(doc.paid)}</Text></View>
              <View style={s.totRow}><Text style={s.strong}>{l.balance}</Text><Text style={s.strong}>{mono(doc.balance)}</Text></View>
            </>
          )}
        </View>

        {doc.notes && (
          <View style={s.section} wrap={false}>
            <Text style={s.label}>{l.notes}</Text>
            <Text>{doc.notes}</Text>
          </View>
        )}
        {doc.org.bank && (
          <View style={s.section} wrap={false}>
            <Text style={s.label}>{l.pay}</Text>
            <Text>{`${l.bank}: ${doc.org.bank.name}`}</Text>
            {doc.org.bank.accountName && <Text>{`${l.holder}: ${doc.org.bank.accountName}`}</Text>}
            <Text>{`${l.account}: ${doc.org.bank.accountNumber}`}</Text>
          </View>
        )}

        </View>
        <Text style={s.footerLeft} fixed>{doc.org.name}</Text>
        <Text style={s.footerRight} fixed render={({ pageNumber, totalPages }) => `${l.page} ${pageNumber}/${totalPages}`} />
      </Page>
    </Document>
  );
}

/** The PDF file for one invoice the caller may see (`billing.read`). */
export async function renderInvoicePdf(ctx: Ctx, invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
  const doc = await buildInvoiceDocument(ctx, invoiceId);
  const buffer = await renderToBuffer(<InvoicePdf doc={doc} />);
  const base = (doc.number ?? `draft-${invoiceId.slice(-6)}`).replace(/[^A-Za-z0-9._-]+/g, '-');
  return { buffer, filename: `${base}.pdf` };
}
