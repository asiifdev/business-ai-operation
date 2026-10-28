/**
 * Demo data (ERD section 8, BR-M01-10). Everything here is FAKE: invented companies, `.test` addresses, a shared demo
 * password. It refuses to run in production, and it is safe to run twice (it stops if the demo owner already exists).
 *
 *   pnpm db:seed
 */
import { eq, sql } from 'drizzle-orm';
import { db, pg } from '../src/db/client';
import { clients, packages, subscriptions, users } from '../src/db/schema';
import { addDays, addMonths, todayIn } from '../src/domain/billing/dates';
import { createInvoiceDraft, markInvoiceSent } from '../src/domain/billing/invoices';
import { recordPayment } from '../src/domain/billing/payments';
import { createSubscription, generateRenewalDrafts } from '../src/domain/billing/subscriptions';
import { userCtx } from '../src/domain/ctx';
import { fixedClock } from '../src/lib/clock';
import { registerOrganization } from '../src/domain/org/service';
import { createClient } from '../src/domain/portfolio/clients';
import { createDeployment } from '../src/domain/portfolio/deployments';
import { createPackage, createProduct } from '../src/domain/portfolio/products';
import { createUser } from '../src/domain/users/service';

if (process.env.NODE_ENV === 'production') {
  console.error('db:seed refuses to run when NODE_ENV=production (BR-M01-10).');
  process.exit(1);
}

const PASSWORD = 'demo-password-123';

async function exists(email: string) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email));
  return Boolean(row);
}

/** An Orbit Studio made before billing existed: add the billing history once, to the same clients and packages. */
async function topUpBilling(email: string) {
  const [owner] = await db.select({ id: users.id, orgId: users.orgId }).from(users).where(eq(sql`lower(${users.email})`, email));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(subscriptions).where(eq(subscriptions.orgId, owner.orgId));
  if (n > 0) return console.log('Orbit Studio already exists (billing included), skipped.');
  const ctx = userCtx({ orgId: owner.orgId, userId: owner.id, role: 'owner' });
  const clientId = async (name: string) => (await db.select({ id: clients.id }).from(clients).where(sql`${clients.orgId} = ${owner.orgId} and ${clients.name} = ${name}`))[0].id;
  const packageId = async (name: string) => (await db.select({ id: packages.id }).from(packages).where(sql`${packages.orgId} = ${owner.orgId} and ${packages.name} = ${name}`))[0].id;
  await billingHistory(
    ctx,
    { aksara: await clientId('Aksara Studio'), kopi: await clientId('Kopi Senja'), klinik: await clientId('Klinik Sehat Sentosa'), maju: await clientId('Toko Bangunan Maju Jaya'), bimbel: await clientId('Bimbel Cerdas Nusantara'), tini: await clientId('Warung Nasi Bu Tini') },
    { crmStarter: await packageId('Starter'), crmBisnis: await packageId('Bisnis'), posKedai: await packageId('Kedai'), posToko: await packageId('Toko'), bookStudio: await packageId('Studio'), bookKlinik: await packageId('Klinik') },
  );
}

async function orbitStudio() {
  const email = 'owner@orbit-studio.test';
  if (await exists(email)) return topUpBilling(email);
  const owner = await registerOrganization({ organizationName: 'Orbit Studio', name: 'Rina Wijaya', email, password: PASSWORD, locale: 'id' });
  const ctx = userCtx({ orgId: owner.orgId, userId: owner.userId, role: 'owner' });
  await createUser(ctx, { name: 'Dimas Pratama', email: 'admin@orbit-studio.test', role: 'admin', password: PASSWORD, locale: 'id' });
  await createUser(ctx, { name: 'Sari Lestari', email: 'staf@orbit-studio.test', role: 'staff', password: PASSWORD, locale: 'id' });

  const crm = (await createProduct(ctx, { name: 'Orbit CRM', description: 'CRM ringan untuk agensi dan bisnis jasa.', currentVersion: '2.1.0' })).id;
  const pos = (await createProduct(ctx, { name: 'Orbit POS', description: 'Kasir dan stok untuk kedai dan toko.', currentVersion: '1.4.2' })).id;
  const booking = (await createProduct(ctx, { name: 'Orbit Booking', description: 'Reservasi dan jadwal untuk klinik dan studio.', currentVersion: '0.9.0' })).id;
  const crmStarter = (await createPackage(ctx, crm, { name: 'Starter', monthlyPrice: 150_000, features: 'Satu pengguna, 500 kontak' })).id;
  const crmBisnis = (await createPackage(ctx, crm, { name: 'Bisnis', monthlyPrice: 450_000, features: 'Sepuluh pengguna, kontak tanpa batas, laporan' })).id;
  const posKedai = (await createPackage(ctx, pos, { name: 'Kedai', monthlyPrice: 99_000, features: 'Satu kasir, stok dasar' })).id;
  const posToko = (await createPackage(ctx, pos, { name: 'Toko', monthlyPrice: 249_000, features: 'Tiga kasir, multi gudang' })).id;
  const bookStudio = (await createPackage(ctx, booking, { name: 'Studio', monthlyPrice: 199_000, features: 'Satu lokasi, pengingat WhatsApp' })).id;
  const bookKlinik = (await createPackage(ctx, booking, { name: 'Klinik', monthlyPrice: 399_000, features: 'Tiga lokasi, rekam kunjungan' })).id;

  const client = async (name: string, contactName: string, slug: string, notes?: string) =>
    (await createClient(ctx, { name, contactName, email: `${slug}@example.test`, phone: '0812-0000-0000', notes })).id;
  const aksara = await client('Aksara Studio', 'Rina Anggraini', 'halo-aksara', 'Klien sejak 2024, pembayaran selalu tepat waktu.');
  const kopi = await client('Kopi Senja', 'Budi Santoso', 'halo-kopisenja');
  const klinik = await client('Klinik Sehat Sentosa', 'dr. Maya Putri', 'admin-kliniksehat');
  const maju = await client('Toko Bangunan Maju Jaya', 'Hendra Gunawan', 'toko-majujaya');
  const bimbel = await client('Bimbel Cerdas Nusantara', 'Ayu Lestari', 'info-bimbelcerdas');
  const tini = await client('Warung Nasi Bu Tini', 'Tini Rahayu', 'butini');

  const dep = (productId: string, clientId: string, environment: string, installedVersion: string, domain?: string, label?: string) =>
    createDeployment(ctx, { productId, clientId, environment, installedVersion, domain, label });
  await dep(crm, aksara, 'production', '2.0.3', 'crm.aksara.example.test'); // behind
  await dep(crm, aksara, 'staging', '2.1.0', 'staging-crm.aksara.example.test');
  await dep(pos, kopi, 'production', '1.4.2', 'kasir.kopisenja.example.test', 'Cabang Klaten');
  await dep(pos, kopi, 'production-solo', '1.4.2', 'kasir-solo.kopisenja.example.test', 'Cabang Solo');
  await dep(booking, klinik, 'production', '0.8.1', 'booking.kliniksehat.example.test'); // behind
  await dep(pos, maju, 'production', '1.3.0', 'kasir.majujaya.example.test'); // behind
  await dep(booking, bimbel, 'production', '0.9.0', 'jadwal.bimbelcerdas.example.test');
  await dep(crm, bimbel, 'production', '2.1.0', 'crm.bimbelcerdas.example.test');
  const depTini = await dep(pos, tini, 'production', '1.4.2');
  void depTini;
  await billingHistory(ctx, { aksara, kopi, klinik, maju, bimbel, tini }, { crmStarter, crmBisnis, posKedai, posToko, bookStudio, bookKlinik });
  console.log('Orbit Studio: 3 users, 3 products, 6 packages, 6 clients, 9 deployments (3 behind).');
}

/**
 * Five months of invented billing so the dashboard has something to show: subscriptions, invoices that were sent and
 * paid (some late), one part-paid invoice that is now overdue, one due today, and renewal drafts from the scheduler.
 * Dates are relative to today, so the picture is always current. All names and amounts are made up.
 */
async function billingHistory(
  base: ReturnType<typeof userCtx>,
  c: Record<'aksara' | 'kopi' | 'klinik' | 'maju' | 'bimbel' | 'tini', string>,
  pkg: Record<'crmStarter' | 'crmBisnis' | 'posKedai' | 'posToko' | 'bookStudio' | 'bookKlinik', string>,
) {
  const clock = fixedClock(new Date());
  const real = new Date();
  const today = todayIn('Asia/Jakarta', real);
  const at = (iso: string) => {
    clock.set(`${iso}T03:00:00Z`);
    return { ...base, clock };
  };
  const plans = [
    { client: c.aksara, pkg: pkg.crmBisnis, amount: 450_000, day: 3, late: 0 },
    { client: c.kopi, pkg: pkg.posKedai, amount: 99_000, day: 5, late: 2 },
    { client: c.klinik, pkg: pkg.bookKlinik, amount: 399_000, day: 8, late: 0 },
    { client: c.maju, pkg: pkg.posToko, amount: 249_000, day: 12, late: 5 },
    { client: c.bimbel, pkg: pkg.crmStarter, amount: 150_000, day: 15, late: 1 },
    { client: c.tini, pkg: pkg.posKedai, amount: 99_000, day: 20, late: 0 },
  ];
  // Subscriptions: two of them are due within a week, so the scheduler prepares renewal drafts for them.
  const dueIn = [28, 31, 25, 22, 3, 5];
  for (const [i, p] of plans.entries()) {
    await createSubscription(at(addDays(today, -150)), { clientId: p.client, packageId: p.pkg, amount: p.amount, startedOn: addDays(today, -150), nextDueDate: addDays(today, dueIn[i]) });
  }
  // Closed months: sent on the 1st, due ten days later, paid on or a little after the due date.
  for (let back = 5; back >= 1; back--) {
    const month = addMonths(`${today.slice(0, 7)}-01`, -back);
    for (const p of plans) {
      if (back === 5 && p.day > 12) continue; // newer customers start later, so earlier months are lighter
      const issue = addDays(month, 0);
      const due = addDays(month, 10);
      const draft = await createInvoiceDraft(at(issue), { clientId: p.client, dueDate: due, items: [{ description: `Langganan bulanan ${month.slice(0, 7)}`, quantity: 1, unitPrice: p.amount }] });
      await markInvoiceSent(at(issue), draft.id);
      const paidOn = addDays(due, p.late - 1);
      await recordPayment(at(paidOn), draft.id, { amount: p.amount, paidOn, method: 'transfer', reference: `TRX-${month.slice(2, 7).replace('-', '')}-${p.day}` });
    }
  }
  // This month: Aksara paid, Klinik paid only part and is now overdue, Maju is due today, Tini was just sent.
  const month = `${today.slice(0, 7)}-01`;
  const overdueDue = addDays(today, -12);
  const make = async (client: string, amount: number, due: string, label: string, issued: string) => {
    const d = await createInvoiceDraft(at(issued), { clientId: client, dueDate: due, items: [{ description: label, quantity: 1, unitPrice: amount }] });
    await markInvoiceSent(at(issued), d.id);
    return d.id;
  };
  const paid = await make(c.aksara, 450_000, addDays(today, -2), 'Langganan bulanan', month);
  await recordPayment(at(addDays(today, -3)), paid, { amount: 450_000, paidOn: addDays(today, -3), method: 'transfer' });
  const part = await make(c.klinik, 1_200_000, overdueDue, 'Paket Klinik + pelatihan staf', addDays(overdueDue, -10));
  await recordPayment(at(addDays(today, -9)), part, { amount: 500_000, paidOn: addDays(today, -9), method: 'transfer', note: 'Pembayaran pertama' });
  await make(c.maju, 249_000, today, 'Langganan bulanan', addDays(today, -9));
  await make(c.tini, 99_000, addDays(today, 6), 'Langganan bulanan', addDays(today, -1));
  const month0 = at(today);
  await createInvoiceDraft(month0, { clientId: c.kopi, dueDate: addDays(today, 14), items: [{ description: 'Pelatihan kasir cabang baru', quantity: 2, unitPrice: 350_000 }] });
  const drafts = await generateRenewalDrafts(base.orgId, clock.now());
  console.log(`Billing: ${plans.length} subscriptions, invoices for 5 months, ${drafts.created.length} renewal drafts.`);
}

async function kopiSenjaDigital() {
  const email = 'owner@kopi-senja-digital.test';
  if (await exists(email)) return console.log('Kopi Senja Digital already exists, skipped.');
  const owner = await registerOrganization({ organizationName: 'Kopi Senja Digital', name: 'Lukman Hakim', email, password: PASSWORD, locale: 'id' });
  const ctx = userCtx({ orgId: owner.orgId, userId: owner.userId, role: 'owner' });
  const product = (await createProduct(ctx, { name: 'Senja Menu', currentVersion: '1.0.0' })).id;
  await createPackage(ctx, product, { name: 'Dasar', monthlyPrice: 75_000 });
  const client = (await createClient(ctx, { name: 'Kedai Fajar', contactName: 'Fajar Nugroho' })).id;
  await createDeployment(ctx, { productId: product, clientId: client, environment: 'production', installedVersion: '1.0.0' });
  console.log('Kopi Senja Digital: 1 user, 1 product, 1 client (for isolation checks).');
}

await orbitStudio();
await kopiSenjaDigital();
console.log(`\nDemo logins (fake data). Password for all: ${PASSWORD}\n  owner@orbit-studio.test  admin@orbit-studio.test  staf@orbit-studio.test  owner@kopi-senja-digital.test`);
await pg.end();
