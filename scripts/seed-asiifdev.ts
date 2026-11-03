/**
 * Demo data for the ASIIFDEV DIGITAL AGENCY organization (the real company profile, products and packages stay as they
 * are). This script ADDS dummy clients and their billing, deployments, tasks and leads on top, through the same services
 * the app uses. Everything it creates is FAKE: invented businesses, `.test` addresses and `example.test` domains.
 *
 *   pnpm exec node --env-file=.env --import tsx scripts/seed-asiifdev.ts
 *
 * It never edits or deletes existing rows, refuses to run in production, and is safe to run twice (it stops when the
 * dummy clients already exist). It does not create meetings, Marketing Studio images or AI runs: those are made in the UI.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, pg } from '../src/db/client';
import { clients, organizations, packages, products, users } from '../src/db/schema';
import { emitTaskLate, runActionCenterRules } from '../src/domain/action-center/rules';
import { addDays, addMonths, todayIn } from '../src/domain/billing/dates';
import { createInvoiceDraft, markInvoiceSent } from '../src/domain/billing/invoices';
import { recordPayment } from '../src/domain/billing/payments';
import { createSubscription, generateRenewalDrafts } from '../src/domain/billing/subscriptions';
import { userCtx } from '../src/domain/ctx';
import { createLead, moveLead } from '../src/domain/pipeline/leads';
import { createClient } from '../src/domain/portfolio/clients';
import { createDeployment } from '../src/domain/portfolio/deployments';
import { createTask, setTaskStatus } from '../src/domain/tasks/service';
import { fixedClock } from '../src/lib/clock';

if (process.env.NODE_ENV === 'production') {
  console.error('seed-asiifdev refuses to run when NODE_ENV=production.');
  process.exit(1);
}

const ORG_NAME = 'ASIIFDEV DIGITAL AGENCY';
const [org] = await db.select({ id: organizations.id }).from(organizations).where(sql`lower(${organizations.name}) = lower(${ORG_NAME})`);
if (!org) throw new Error(`Organization "${ORG_NAME}" not found. Nothing was changed.`);

const people = await db.select({ id: users.id, role: users.role, name: users.name }).from(users).where(and(eq(users.orgId, org.id), eq(users.isActive, true)));
const owner = people.find((u) => u.role === 'owner');
if (!owner) throw new Error('The organization has no active owner.');
const admin = people.find((u) => u.role === 'admin') ?? owner;
const base = userCtx({ orgId: org.id, userId: owner.id, role: 'owner' });
const ai = { ...base, actor: 'ai:seed' as const };

// Real products and packages already in the organization: look them up, never create or change them.
async function product(name: string) {
  const [p] = await db.select({ id: products.id, version: products.currentVersion }).from(products).where(and(eq(products.orgId, org.id), eq(products.name, name)));
  if (!p) throw new Error(`Product "${name}" not found in ${ORG_NAME}.`);
  const rows = await db.select({ id: packages.id, name: packages.name, price: packages.monthlyPrice }).from(packages).where(and(eq(packages.orgId, org.id), eq(packages.productId, p.id)));
  const pkg = (n: string) => {
    const r = rows.find((x) => x.name === n);
    if (!r) throw new Error(`Package "${n}" not found for ${name}.`);
    return r;
  };
  return { id: p.id, version: p.version ?? 'unknown', basic: pkg('Basic'), pro: pkg('Pro'), enterprise: pkg('Enterprise') };
}
const kendaraan = await product('invly.id - Kendaraan');
const peralatan = await product('invly.id - Peralatan');

const DUMMY_MARK = 'Arunika Trans Rental';
const [already] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.orgId, org.id), eq(clients.name, DUMMY_MARK)));
if (already) {
  console.log('Dummy clients already exist, skipped.');
  await pg.end();
  process.exit(0);
}

// ---- Dummy clients (invented; invly.id is for rental businesses) ----
const mk = async (name: string, contactName: string, slug: string, notes?: string) =>
  (await createClient(base, { name, contactName, email: `${slug}@example.test`, phone: '0812-0000-0000', notes })).id;
const arunika = await mk(DUMMY_MARK, 'Raka Pramudya', 'halo-arunika', 'Rental mobil dan minibus, 3 cabang. Klien sejak awal tahun.');
const bumi = await mk('Bumi Motor Rental Lestari', 'Sinta Maharani', 'admin-bumimotor');
const cakra = await mk('Cakra Sewa Alat Pesta', 'Bayu Aditya', 'info-cakrapesta');
const dwipa = await mk('Dwipa Kamera dan Lensa', 'Laras Wulandari', 'order-dwipakamera');
const ekalaya = await mk('Ekalaya Sewa Alat Berat', 'Hendro Saputro', 'kantor-ekalaya');
const fajar = await mk('Fajar Camping Gear Rental', 'Dewi Kartika', 'cs-fajarcamping');

// ---- Deployments: one installation per client; two are behind the product's current version ----
const behind = '3a91c0e';
const dep = (productId: string, clientId: string, installedVersion: string, domain: string, label?: string) =>
  createDeployment(base, { productId, clientId, environment: 'production', installedVersion, domain, label });
const depArunika = await dep(kendaraan.id, arunika, behind, 'sewa.arunikatrans.example.test'); // behind
await dep(kendaraan.id, bumi, kendaraan.version, 'sewa.bumimotor.example.test');
await dep(peralatan.id, cakra, peralatan.version,'sewa.cakrapesta.example.test');
await dep(peralatan.id, dwipa, behind, 'rental.dwipakamera.example.test'); // behind
const depEkalaya = await dep(peralatan.id, ekalaya, peralatan.version, 'alat.ekalaya.example.test');
await dep(peralatan.id, fajar, peralatan.version, 'camping.fajar.example.test', 'Gudang utama');

// ---- Billing: five months of history, one part-paid overdue invoice, one due today, renewal drafts ----
const clock = fixedClock(new Date());
const real = new Date();
const today = todayIn('Asia/Jakarta', real);
const at = (iso: string) => {
  clock.set(`${iso}T03:00:00Z`);
  return { ...base, clock };
};
const plans = [
  { client: arunika, pkg: kendaraan.enterprise, day: 3, late: 0 },
  { client: bumi, pkg: kendaraan.pro, day: 5, late: 2 },
  { client: cakra, pkg: peralatan.pro, day: 8, late: 0 },
  { client: dwipa, pkg: peralatan.basic, day: 12, late: 5 },
  { client: ekalaya, pkg: peralatan.enterprise, day: 15, late: 1 },
  { client: fajar, pkg: peralatan.basic, day: 20, late: 0 },
];
const dueIn = [28, 31, 25, 22, 3, 5]; // two are due within a week, so the scheduler prepares renewal drafts
for (const [i, p] of plans.entries()) {
  await createSubscription(at(addDays(today, -150)), { clientId: p.client, packageId: p.pkg.id, amount: p.pkg.price, startedOn: addDays(today, -150), nextDueDate: addDays(today, dueIn[i]) });
}
for (let back = 5; back >= 1; back--) {
  const month = addMonths(`${today.slice(0, 7)}-01`, -back);
  for (const p of plans) {
    if (back === 5 && p.day > 12) continue; // newer customers start later
    const due = addDays(month, 10);
    const draft = await createInvoiceDraft(at(month), { clientId: p.client, dueDate: due, items: [{ description: `Langganan invly.id ${p.pkg.name} ${month.slice(0, 7)}`, quantity: 1, unitPrice: p.pkg.price }] });
    await markInvoiceSent(at(month), draft.id);
    const paidOn = addDays(due, p.late - 1);
    await recordPayment(at(paidOn), draft.id, { amount: p.pkg.price, paidOn, method: 'transfer', reference: `TRX-${month.slice(2, 7).replace('-', '')}-${p.day}` });
  }
}
const make = async (client: string, amount: number, due: string, label: string, issued: string) => {
  const d = await createInvoiceDraft(at(issued), { clientId: client, dueDate: due, items: [{ description: label, quantity: 1, unitPrice: amount }] });
  await markInvoiceSent(at(issued), d.id);
  return d.id;
};
const month0 = `${today.slice(0, 7)}-01`;
const paid = await make(arunika, kendaraan.enterprise.price, addDays(today, -2), 'Langganan invly.id Enterprise', month0);
await recordPayment(at(addDays(today, -3)), paid, { amount: kendaraan.enterprise.price, paidOn: addDays(today, -3), method: 'transfer' });
const overdueDue = addDays(today, -12);
const part = await make(ekalaya, 2_000_000, overdueDue, 'Custom fitur pelacakan alat berat + pelatihan staf', addDays(overdueDue, -10));
await recordPayment(at(addDays(today, -9)), part, { amount: 750_000, paidOn: addDays(today, -9), method: 'transfer', note: 'Pembayaran pertama' });
await make(dwipa, peralatan.basic.price, today, 'Langganan invly.id Basic', addDays(today, -9));
await make(fajar, peralatan.basic.price, addDays(today, 6), 'Langganan invly.id Basic', addDays(today, -1));
await createInvoiceDraft(at(today), { clientId: bumi, dueDate: addDays(today, 14), items: [{ description: 'Pelatihan staf cabang baru', quantity: 2, unitPrice: 350_000 }] });
const drafts = await generateRenewalDrafts(org.id, clock.now());

// ---- Tasks (about invly.id), two late, two done, two AI drafts waiting for a decision ----
const t = (title: string, extra: Omit<Parameters<typeof createTask>[1], 'title'>) => createTask(base, { ...extra, title });
const login = await t('Pelanggan tidak bisa login setelah ganti perangkat', { kind: 'bug', priority: 'urgent', dueDate: addDays(today, -2), assigneeId: admin.id, deploymentId: depArunika.id });
await setTaskStatus(base, login.id, 'in_progress');
await t('Struk PDF memotong nama barang yang panjang', { kind: 'bug', priority: 'medium', dueDate: addDays(today, -5), assigneeId: admin.id, deploymentId: depEkalaya.id });
await t('Update invly.id Kendaraan ke versi terbaru', { kind: 'maintenance', priority: 'high', assigneeId: owner.id, deploymentId: depArunika.id });
await t('Ekspor laporan sewa ke Excel per bulan', { kind: 'feature', priority: 'medium', dueDate: addDays(today, 10), clientId: cakra });
await t('Perbarui template proposal agensi', { kind: 'task', priority: 'low', dueDate: addDays(today, 14), assigneeId: owner.id });
const backup = await t('Backup database bulanan klien invly.id', { kind: 'maintenance', priority: 'medium', assigneeId: admin.id });
await setTaskStatus(base, backup.id, 'done');
const handover = await t('Serah terima akun admin ke Fajar Camping Gear Rental', { kind: 'task', priority: 'medium', assigneeId: admin.id, clientId: fajar });
await setTaskStatus(base, handover.id, 'done');
await createTask(ai, { title: 'Tambahkan notifikasi WhatsApp saat sewa jatuh tempo', kind: 'feature', priority: 'medium', clientId: bumi }, { source: 'meeting', sourceQuote: 'Mbak Sinta minta pelanggan diingatkan lewat WhatsApp satu hari sebelum sewa berakhir.' });
await createTask(ai, { title: 'Kalender booking kadang menampilkan alat yang sudah disewa', kind: 'bug', priority: 'high', clientId: dwipa }, { source: 'assistant' });
const late = await emitTaskLate(org.id, new Date());

// ---- Leads: some prospects for the pipeline; one has been quiet longer than the stagnation limit ----
const lead = (name: string, contactName: string, slug: string, needs: string, value: number, daysAgo: number) =>
  createLead(at(addDays(today, -daysAgo)), { name, contactName, email: `${slug}@example.test`, source: 'Referensi klien', needsSummary: needs, estimatedValue: value, assignedTo: owner.id });
await lead('Gamma Rental Mobil Surakarta', 'Teguh Wibowo', 'teguh-gamma', 'Rental mobil 2 cabang, ingin kontrak dan tagihan otomatis.', 6_000_000, 2);
const quiet = await lead('Halim Sewa Sound System', 'Halim Santoso', 'halim-sound', 'Sewa sound system dan panggung, butuh jadwal alat.', 3_000_000, 30); // stagnant
const warm = await lead('Indra Outdoor Gear', 'Indra Kusuma', 'indra-outdoor', 'Penyewaan tenda dan peralatan gunung, ingin multi cabang.', 12_000_000, 9);
await moveLead(at(addDays(today, -8)), warm.id, 'exploring');
const prop = await lead('Jaya Mobil Wedding', 'Yusuf Rahman', 'yusuf-jaya', 'Mobil pengantin dan katering kendaraan; minta penawaran.', 8_000_000, 6);
await moveLead(at(addDays(today, -5)), prop.id, 'exploring');
await moveLead(at(addDays(today, -4)), prop.id, 'proposal');
void quiet;
await runActionCenterRules(org.id, new Date());

console.log(`ASIIFDEV DIGITAL AGENCY demo data added: 6 dummy clients, 6 deployments (2 behind), ${plans.length} subscriptions with 5 months of invoices, ${drafts.created.length} renewal drafts, 9 tasks (${late.raised.length} late-task findings), 4 leads (1 quiet).`);
await pg.end();
