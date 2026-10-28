/**
 * Demo data (ERD section 8, BR-M01-10). Everything here is FAKE: invented companies, `.test` addresses, a shared demo
 * password. It refuses to run in production, and it is safe to run twice (it stops if the demo owner already exists).
 *
 *   pnpm db:seed
 */
import { eq, sql } from 'drizzle-orm';
import { db, pg } from '../src/db/client';
import { users } from '../src/db/schema';
import { userCtx } from '../src/domain/ctx';
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

async function orbitStudio() {
  const email = 'owner@orbit-studio.test';
  if (await exists(email)) return console.log('Orbit Studio already exists, skipped.');
  const owner = await registerOrganization({ organizationName: 'Orbit Studio', name: 'Rina Wijaya', email, password: PASSWORD, locale: 'id' });
  const ctx = userCtx({ orgId: owner.orgId, userId: owner.userId, role: 'owner' });
  await createUser(ctx, { name: 'Dimas Pratama', email: 'admin@orbit-studio.test', role: 'admin', password: PASSWORD, locale: 'id' });
  await createUser(ctx, { name: 'Sari Lestari', email: 'staf@orbit-studio.test', role: 'staff', password: PASSWORD, locale: 'id' });

  const crm = (await createProduct(ctx, { name: 'Orbit CRM', description: 'CRM ringan untuk agensi dan bisnis jasa.', currentVersion: '2.1.0' })).id;
  const pos = (await createProduct(ctx, { name: 'Orbit POS', description: 'Kasir dan stok untuk kedai dan toko.', currentVersion: '1.4.2' })).id;
  const booking = (await createProduct(ctx, { name: 'Orbit Booking', description: 'Reservasi dan jadwal untuk klinik dan studio.', currentVersion: '0.9.0' })).id;
  await createPackage(ctx, crm, { name: 'Starter', monthlyPrice: 150_000, features: 'Satu pengguna, 500 kontak' });
  await createPackage(ctx, crm, { name: 'Bisnis', monthlyPrice: 450_000, features: 'Sepuluh pengguna, kontak tanpa batas, laporan' });
  await createPackage(ctx, pos, { name: 'Kedai', monthlyPrice: 99_000, features: 'Satu kasir, stok dasar' });
  await createPackage(ctx, pos, { name: 'Toko', monthlyPrice: 249_000, features: 'Tiga kasir, multi gudang' });
  await createPackage(ctx, booking, { name: 'Studio', monthlyPrice: 199_000, features: 'Satu lokasi, pengingat WhatsApp' });
  await createPackage(ctx, booking, { name: 'Klinik', monthlyPrice: 399_000, features: 'Tiga lokasi, rekam kunjungan' });

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
  await dep(pos, tini, 'production', '1.4.2');
  console.log('Orbit Studio: 3 users, 3 products, 6 packages, 6 clients, 9 deployments (3 behind).');
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
