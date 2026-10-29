import { and, desc, eq, gt, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { approvals, auditLog, users } from '../../db/schema';
import { getAiOverview } from '../../domain/ai/service';
import { listConnections } from '../../domain/connections/service';
import { createDocument, listDocuments } from '../../domain/documents/service';
import { getFlow, getRun, listFlows, listRuns, planRun } from '../../domain/flows/service';
import { createInvoiceDraft, getInvoice, listInvoices } from '../../domain/billing/invoices';
import { listSubscriptions } from '../../domain/billing/subscriptions';
import { getFinanceSummary } from '../../domain/billing/summary';
import { getClient360, listClients } from '../../domain/portfolio/clients';
import { listDeployments } from '../../domain/portfolio/deployments';
import { getProduct, listProducts } from '../../domain/portfolio/products';
import { TASK_KINDS, TASK_PRIORITIES, TASK_STATUSES } from '../../domain/tasks/rules';
import { createTask, findSimilarTasks, getTaskSummary, listTasks } from '../../domain/tasks/service';
import { formatRupiah } from '../../lib/format';
import { can } from '../../domain/permissions';
import { formatUsd } from '../../lib/usd';
import { finalizeDocumentTool } from './actions';
import { ToolRegistry, defineTool } from './registry';

export { formatUsd };

/** Entity types the audit trail keeps for the Owner only (PRD §3, `audit.read_financial`). */
const FINANCIAL_ENTITIES = ['invoice', 'payment', 'subscription'];

const documentKindLabel = { proposal: 'proposal', quotation: 'quotation', minutes: 'notulen' } as const;

const who = (actor: string) => (actor.startsWith('ai:') ? 'AI' : actor.startsWith('system:') ? 'sistem' : 'pengguna');

/**
 * Tools the assistant has today, each over a real table of the organization. Lead tools join this list with the rest of
 * M04; every tool takes the organization and the person from the session, never from
 * the model (BR-M01-01). The assistant may only answer from what these return.
 */
export function buildAssistantRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(
    defineTool({
      name: 'get_ai_usage',
      description: 'Shows today\'s AI spending, daily cap, remaining budget and number of runs for each AI feature of this organization.',
      tier: 'read',
      permission: 'ai.usage.read',
      args: z.object({}),
      run: async (ctx) => {
        const overview = await getAiOverview(db, ctx);
        const features = overview.features.map((f) => ({
          fitur: f.feature,
          batasHarian: formatUsd(f.limitMicroUsd),
          terpakai: formatUsd(f.spentMicroUsd),
          sisa: formatUsd(f.remainingMicroUsd),
          jumlahRun: f.runsToday,
          anggaranHabis: f.exhausted,
        }));
        return { tanggal: ctx.clock.now().toISOString().slice(0, 10), fitur: features, totalTerpakai: formatUsd(overview.features.reduce((a, f) => a + f.spentMicroUsd, 0)) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_team_members',
      description: 'Lists the people in this organization with their role and whether they are active, with a count per role.',
      tier: 'read',
      permission: 'user.read',
      args: z.object({ activeOnly: z.boolean().default(true) }),
      run: async (ctx, args) => {
        const rows = await db
          .select({ name: users.name, role: users.role, isActive: users.isActive })
          .from(users)
          .where(and(eq(users.orgId, ctx.orgId), args.activeOnly ? eq(users.isActive, true) : undefined))
          .orderBy(users.createdAt);
        const perPeran: Record<string, number> = {};
        for (const r of rows) perPeran[r.role] = (perPeran[r.role] ?? 0) + 1;
        return { jumlah: rows.length, perPeran, anggota: rows.map((r) => ({ nama: r.name, peran: r.role, aktif: r.isActive })) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_recent_activity',
      description: 'Lists the latest entries of the organization audit trail: when, who or what acted (user, AI or system), the action and the kind of record.',
      tier: 'read',
      permission: 'audit.read',
      args: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
      run: async (ctx, args) => {
        const hideFinancial = !can(ctx.role, 'audit.read_financial');
        const rows = await db
          .select({ at: auditLog.createdAt, actor: auditLog.actor, action: auditLog.action, entityType: auditLog.entityType })
          .from(auditLog)
          .where(and(eq(auditLog.orgId, ctx.orgId), hideFinancial ? notInArray(auditLog.entityType, FINANCIAL_ENTITIES) : undefined))
          .orderBy(desc(auditLog.createdAt))
          .limit(args.limit);
        return { jumlah: rows.length, aktivitas: rows.map((r) => ({ waktu: r.at.toISOString(), pelaku: who(r.actor), aksi: r.action, jenis: r.entityType })) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_pending_approvals',
      description: 'Lists risky actions proposed by the AI that are still waiting for a human decision, with the tool, the reason and when the request expires.',
      tier: 'read',
      permission: 'finding.read_nonfinancial',
      args: z.object({}),
      run: async (ctx) => {
        const own = !can(ctx.role, 'approval.finance.decide');
        const rows = await db
          .select({ tool: approvals.tool, rationale: approvals.rationale, expiresAt: approvals.expiresAt, forName: users.name })
          .from(approvals)
          .leftJoin(users, and(eq(users.orgId, approvals.orgId), eq(users.id, approvals.requestedFor)))
          .where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.status, 'pending'), gt(approvals.expiresAt, ctx.clock.now()), own ? eq(approvals.requestedFor, ctx.userId) : undefined))
          .orderBy(approvals.expiresAt)
          .limit(20);
        return { jumlah: rows.length, daftar: rows.map((r) => ({ alat: r.tool, alasan: r.rationale, diminta_untuk: r.forName, kedaluwarsa: r.expiresAt.toISOString() })) };
      },
    }),
  );

  // Portfolio (M02): every tool calls the same service the pages use, so the assistant sees exactly what the person may see.
  const LIMIT = 40;
  const stateLabel = { behind: 'tertinggal', current: 'terbaru', ahead: 'lebih baru dari produk', unknown: 'tidak bisa dibandingkan' } as const;

  registry.register(
    defineTool({
      name: 'list_clients',
      description: 'Lists the clients of this organization with contact, number of deployments and how many are behind the current product version. Can search by name, contact or email. Use it first to find a client id.',
      tier: 'read',
      permission: 'catalog.read',
      args: z.object({ search: z.string().trim().max(80).optional(), includeArchived: z.boolean().default(false) }),
      run: async (ctx, args) => {
        const rows = await listClients(ctx, { q: args.search, includeArchived: args.includeArchived });
        return {
          jumlah: rows.length,
          dipotong: rows.length > LIMIT,
          klien: rows.slice(0, LIMIT).map((c) => ({ id: c.id, nama: c.name, kontak: c.contactName, email: c.email, diarsipkan: c.archivedAt !== null, jumlahDeployment: c.deploymentCount, deploymentTertinggal: c.behindCount })),
        };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'get_client_overview',
      description: 'Shows one client in full: contact details and every deployment (product, environment, domain, installed version, product current version and whether it is behind). Needs the client id from list_clients.',
      tier: 'read',
      permission: 'catalog.read',
      args: z.object({ clientId: z.string().min(1).max(40) }),
      run: async (ctx, args) => {
        const view = await getClient360(ctx, args.clientId);
        const c = view.client;
        return {
          id: c.id,
          nama: c.name,
          kontak: c.contactName,
          email: c.email,
          telepon: c.phone,
          alamat: c.address,
          catatan: c.notes,
          diarsipkan: c.archivedAt !== null,
          deployment: view.deployments.map((d) => ({ produk: d.productName, lingkungan: d.environment, label: d.label, domain: d.domain, versiTerpasang: d.installedVersion, versiProdukSaatIni: d.productVersion, status: d.status, versi: stateLabel[d.versionState] })),
        };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_products',
      description: 'Lists the products with their current version, number of active packages, number of deployments and how many deployments are behind the current version.',
      tier: 'read',
      permission: 'catalog.read',
      args: z.object({}),
      run: async (ctx) => {
        const rows = await listProducts(ctx);
        return { jumlah: rows.length, produk: rows.map((p) => ({ id: p.id, nama: p.name, deskripsi: p.description, versiSaatIni: p.currentVersion, jumlahPaket: p.packageCount, jumlahDeployment: p.deploymentCount, deploymentTertinggal: p.behindCount })) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'get_product_packages',
      description: 'Shows the official packages and monthly prices of one product. These are the only valid prices: never state a price that is not in this result. Needs the product id from list_products.',
      tier: 'read',
      permission: 'catalog.price.read',
      args: z.object({ productId: z.string().min(1).max(40) }),
      run: async (ctx, args) => {
        const detail = await getProduct(ctx, args.productId);
        return {
          produk: detail.product.name,
          versiSaatIni: detail.product.currentVersion,
          paket: detail.packages.map((p) => ({ nama: p.name, hargaPerBulan: formatRupiah(p.monthlyPrice), hargaPerBulanAngka: p.monthlyPrice, fitur: p.features, diarsipkan: p.archivedAt !== null })),
        };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_deployments',
      description: 'Lists deployments (a product installed for a client) with installed version and whether it is behind the product current version. Can filter by client, by product, or only the ones that are behind.',
      tier: 'read',
      permission: 'catalog.read',
      args: z.object({ clientId: z.string().min(1).max(40).optional(), productId: z.string().min(1).max(40).optional(), behindOnly: z.boolean().default(false) }),
      run: async (ctx, args) => {
        const rows = await listDeployments(ctx, args);
        return {
          jumlah: rows.length,
          dipotong: rows.length > LIMIT,
          deployment: rows.slice(0, LIMIT).map((d) => ({ klien: d.clientName, produk: d.productName, lingkungan: d.environment, label: d.label, domain: d.domain, versiTerpasang: d.installedVersion, versiProdukSaatIni: d.productVersion, status: d.status, versi: stateLabel[d.versionState] })),
        };
      },
    }),
  );

  // Billing (M03): the same services the pages use, read-only, plus one draft tool. The assistant never records a payment or
  // changes a status, amount or due date (BR-M03-10): those names are refused at registration (forbidden.ts).
  const money = (n: number) => ({ teks: formatRupiah(n), angka: n });
  const invoiceStatus = { draft: 'draf', sent: 'terkirim', paid: 'lunas', void: 'batal' } as const;

  registry.register(
    defineTool({
      name: 'get_billing_summary',
      description: 'Shows the money figures of this month: received, monthly recurring revenue, unpaid and overdue totals (with the most overdue invoices), invoices due today, renewals in the next 7 days and auto-prepared drafts waiting for review.',
      tier: 'read',
      permission: 'billing.read',
      args: z.object({}),
      run: async (ctx) => {
        const f = await getFinanceSummary(ctx);
        return {
          tanggal: f.today,
          bulan: f.month,
          diterimaBulanIni: money(f.receivedThisMonth),
          pendapatanBerulangPerBulan: money(f.mrr),
          langgananAktif: f.activeSubscriptions,
          belumDibayar: { jumlahInvoice: f.outstanding.count, total: money(f.outstanding.amount) },
          lewatJatuhTempo: { jumlahInvoice: f.overdue.count, total: money(f.overdue.amount), terlama: f.overdue.items.map((i) => ({ id: i.id, nomor: i.number, klien: i.clientName, sisa: money(i.balance), terlambatHari: i.daysOverdue })) },
          jatuhTempoHariIni: f.dueToday.map((i) => ({ id: i.id, nomor: i.number, klien: i.clientName, sisa: money(i.balance) })),
          perpanjangan7Hari: f.renewalsSoon.map((r) => ({ klien: r.clientName, produk: r.productName, jatuhTempo: r.nextDueDate, nominal: money(r.amount) })),
          drafDiTinjau: f.draftsToReview,
        };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_invoices',
      description: 'Lists invoices with number, client, due date, total, remaining balance, status and how many days overdue. Can filter by status (draft, sent, paid, void), only overdue ones, or one client. Overdue is derived from the due date, never stored.',
      tier: 'read',
      permission: 'billing.read',
      args: z.object({ status: z.enum(['draft', 'sent', 'paid', 'void']).optional(), overdueOnly: z.boolean().default(false), clientId: z.string().min(1).max(40).optional() }),
      run: async (ctx, args) => {
        const rows = await listInvoices(ctx, { status: args.status, overdue: args.overdueOnly, clientId: args.clientId });
        return {
          jumlah: rows.length,
          dipotong: rows.length > LIMIT,
          invoice: rows.slice(0, LIMIT).map((i) => ({ id: i.id, nomor: i.number, klien: i.clientName, jatuhTempo: i.dueDate, total: money(i.total), sisa: money(i.balance), status: invoiceStatus[i.status], lewatJatuhTempo: i.overdue, terlambatHari: i.daysOverdue, drafOtomatis: i.isAiDraft })),
        };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'get_invoice',
      description: 'Shows one invoice in full: client, dates, every item, subtotal, tax, total, every payment and the remaining balance. Needs the invoice id from list_invoices.',
      tier: 'read',
      permission: 'billing.read',
      args: z.object({ invoiceId: z.string().min(1).max(40) }),
      run: async (ctx, args) => {
        const d = await getInvoice(ctx, args.invoiceId);
        return {
          id: d.invoice.id,
          nomor: d.invoice.number,
          klien: d.client.name,
          status: invoiceStatus[d.invoice.status],
          tanggalTerbit: d.invoice.issueDate,
          jatuhTempo: d.invoice.dueDate,
          rincian: d.items.map((i) => ({ deskripsi: i.description, jumlah: i.quantity, hargaSatuan: money(i.unitPrice), total: money(i.lineTotal) })),
          subtotal: money(d.invoice.subtotal),
          pajak: money(d.invoice.taxAmount),
          total: money(d.invoice.total),
          pembayaran: d.payments.map((p) => ({ jenis: p.kind === 'payment' ? 'pembayaran' : 'koreksi', tanggal: p.paidOn, metode: p.method, jumlah: money(p.amount) })),
          sudahDibayar: money(d.derived.paid),
          sisa: money(d.derived.balance),
          lewatJatuhTempo: d.derived.overdue,
          terlambatHari: d.derived.daysOverdue,
          catatan: d.invoice.notes,
        };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_subscriptions',
      description: 'Lists subscriptions: client, product and package, amount per period, interval in months, next due date and status. Can filter by status or one client.',
      tier: 'read',
      permission: 'billing.read',
      args: z.object({ status: z.enum(['active', 'stopped']).optional(), clientId: z.string().min(1).max(40).optional() }),
      run: async (ctx, args) => {
        const rows = await listSubscriptions(ctx, args);
        return {
          jumlah: rows.length,
          dipotong: rows.length > LIMIT,
          langganan: rows.slice(0, LIMIT).map((s) => ({ id: s.id, klien: s.clientName, produk: s.productName, paket: s.packageName, nominal: money(s.amount), intervalBulan: s.intervalMonths, jatuhTempoBerikutnya: s.nextDueDate, status: s.status === 'active' ? 'aktif' : 'berhenti' })),
        };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'draft_invoice',
      description: 'Prepares a DRAFT invoice for a client from the items given. It stays a draft: a person must review it, mark it sent and only then does it get a number. It never sends anything and never records a payment. Needs the client id from list_clients. Use only prices that came from a tool result.',
      tier: 'draft',
      permission: 'billing.write',
      args: z.object({
        clientId: z.string().min(1).max(40),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: z.string().trim().max(500).optional(),
        items: z.array(z.object({ description: z.string().trim().min(1).max(300), quantity: z.number().int().min(1).max(1000), unitPrice: z.number().int().min(0) })).min(1).max(20),
      }),
      run: async (ctx, args) => {
        const created = await createInvoiceDraft(ctx, args);
        const d = await getInvoice(ctx, created.id);
        return { id: created.id, status: 'draf', total: money(d.invoice.total), catatan: 'Draf dibuat. Belum dikirim dan belum bernomor; harus ditinjau dan ditandai terkirim oleh orang.' };
      },
    }),
  );

  // Tasks (M05): reading is open to everyone; the assistant can only DRAFT a task, which a person accepts or discards.
  const taskKind = { task: 'tugas', bug: 'bug', feature: 'fitur', maintenance: 'maintenance' } as const;
  const taskStatus = { open: 'terbuka', in_progress: 'dikerjakan', done: 'selesai' } as const;
  const taskPriority = { low: 'rendah', medium: 'sedang', high: 'tinggi', urgent: 'mendesak' } as const;

  registry.register(
    defineTool({
      name: 'list_tasks',
      description: 'Lists tasks (work items, bugs, features, maintenance) with status, priority, due date, days late, assignee and the client they are for, plus the counts of open, late, in-progress and draft tasks. Can filter by status, kind, client id, late only, or only tasks assigned to the person asking. Done tasks are left out unless status is "done".',
      tier: 'read',
      permission: 'task.read',
      args: z.object({
        status: z.enum(TASK_STATUSES).optional(),
        kind: z.enum(TASK_KINDS).optional(),
        clientId: z.string().min(1).max(40).optional(),
        lateOnly: z.boolean().default(false),
        mine: z.boolean().default(false),
      }),
      run: async (ctx, args) => {
        const [rows, summary] = await Promise.all([
          listTasks(ctx, { status: args.status, kind: args.kind, clientId: args.clientId, late: args.lateOnly || undefined, assignee: args.mine ? 'me' : undefined }),
          getTaskSummary(ctx),
        ]);
        return {
          ringkasan: { terbuka: summary.open, dikerjakan: summary.inProgress, terlambat: summary.late, milikSaya: summary.mine, drafAI: summary.drafts },
          jumlah: rows.length,
          dipotong: rows.length > LIMIT,
          tugas: rows.slice(0, LIMIT).map((t) => ({
            id: t.id,
            judul: t.title,
            jenis: taskKind[t.kind],
            status: taskStatus[t.status],
            prioritas: taskPriority[t.priority],
            tenggat: t.dueDate,
            terlambat: t.late,
            terlambatHari: t.daysLate,
            penanggungJawab: t.assigneeName ?? 'belum ditetapkan',
            klien: t.clientName,
            produk: t.productName,
            drafAI: t.isDraft,
          })),
        };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'find_similar_tasks',
      description: 'Finds existing tasks whose wording is similar to a title and description, by word overlap. Use it before draft_task to avoid a duplicate, or to suggest which tasks may be related. It only suggests: linking is done by a person.',
      tier: 'read',
      permission: 'task.read',
      args: z.object({ title: z.string().trim().min(2).max(200), description: z.string().trim().max(2000).optional() }),
      run: async (ctx, args) => {
        const similar = await findSimilarTasks(ctx, { title: args.title, description: args.description });
        return { jumlah: similar.length, kandidat: similar.map((s) => ({ id: s.id, judul: s.title, jenis: taskKind[s.kind], status: taskStatus[s.status], klien: s.clientName, kemiripanPersen: Math.round(s.score * 100) })) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'draft_task',
      description: 'Prepares a DRAFT task (a bug, feature, maintenance job or other work) from what the person asked. It stays a draft: it is not counted as open work until a person accepts it on the Tasks page. Bug and maintenance drafts without a due date get one from their priority. Client id from list_clients when the task is for a client.',
      tier: 'draft',
      permission: 'task.create',
      args: z.object({
        title: z.string().trim().min(2).max(200),
        description: z.string().trim().max(2000).optional(),
        kind: z.enum(TASK_KINDS).default('task'),
        priority: z.enum(TASK_PRIORITIES).default('medium'),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        clientId: z.string().min(1).max(40).optional(),
      }),
      run: async (ctx, args) => {
        const created = await createTask(ctx, { ...args, dueDate: args.dueDate ?? null, clientId: args.clientId ?? null }, { source: 'assistant' });
        return { id: created.id, status: 'draf', tenggat: created.dueDate, catatan: 'Draf tugas dibuat. Belum dihitung sebagai tugas terbuka sampai diterima orang di halaman Tugas.' };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_documents',
      description: 'Lists proposals, quotations and meeting minutes (latest version of each), with status, number, client or lead, and total. Filter by kind or status.',
      tier: 'read',
      permission: 'document.read',
      args: z.object({ kind: z.enum(['proposal', 'quotation', 'minutes']).optional(), status: z.enum(['draft', 'final']).optional(), clientId: z.string().min(1).max(40).optional() }),
      run: async (ctx, args) => {
        const rows = await listDocuments(ctx, args);
        return {
          jumlah: rows.length,
          dokumen: rows.slice(0, 30).map((d) => ({ id: d.id, jenis: documentKindLabel[d.kind], status: d.status === 'final' ? 'final' : 'draf', nomor: d.number ?? 'belum bernomor', versi: d.version, judul: d.title, untuk: d.clientName ?? d.leadName, total: d.kind === 'minutes' ? null : money(d.total), berlakuSampai: d.validUntil, drafAI: d.isAiDraft })),
        };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'draft_proposal',
      description: 'Prepares a DRAFT proposal or quotation for a client or lead from official packages (ids from get_product_packages) and quantities. Prices come from the packages, never from you: do not state a price. It stays a draft until a person reviews and finalizes it.',
      tier: 'draft',
      permission: 'document.write',
      args: z
        .object({
          kind: z.enum(['proposal', 'quotation']).default('proposal'),
          title: z.string().trim().min(2).max(200),
          clientId: z.string().min(1).max(40).optional(),
          leadId: z.string().min(1).max(40).optional(),
          items: z.array(z.object({ packageId: z.string().min(1).max(40), quantity: z.number().int().min(1).max(10_000).default(1) })).min(1).max(20),
        })
        .refine((a) => a.clientId || a.leadId, { message: 'clientId or leadId' }),
      run: async (ctx, args) => {
        const created = await createDocument(ctx, args);
        return { id: created.id, status: 'draf', total: money(created.total), catatan: 'Draf dibuat dengan harga dari paket resmi. Narasi dan finalisasi dilakukan orang di halaman Dokumen.' };
      },
    }),
  );

  registry.register(finalizeDocumentTool);

  registry.register(
    defineTool({
      name: 'list_connections',
      description: 'Lists the organization\'s connections (GitHub, SSH servers, aaPanel) with their kind, name and whether the last test passed. Never any secret. Use the ids to bind the slots of a flow.',
      tier: 'read',
      permission: 'connection.read',
      args: z.object({ kind: z.enum(['github', 'ssh', 'aapanel']).optional() }),
      run: async (ctx, args) => {
        const rows = await listConnections(ctx, args);
        return { jumlah: rows.length, koneksi: rows.map((c) => ({ id: c.id, jenis: c.kind, nama: c.name, tesTerakhir: c.testStatus === 'ok' ? 'berhasil' : c.testStatus === 'failed' ? 'gagal' : 'belum dites', sidikJariDikunci: c.kind === 'ssh' ? Boolean(c.hostKeyFingerprint) : undefined })) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_flows',
      description: 'Lists the deploy flows of the organization (setup of a new client, code update), with their kind and number of steps.',
      tier: 'read',
      permission: 'flow.read',
      args: z.object({}),
      run: async (ctx) => {
        const rows = await listFlows(ctx);
        return { jumlah: rows.length, flow: rows.map((f) => ({ id: f.id, nama: f.name, jenis: f.kind === 'setup' ? 'setup klien baru' : 'pembaruan kode', jumlahLangkah: f.nodeCount, versi: f.currentVersion, adaPerintahBebas: f.hasCommandNode })) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'get_flow',
      description: 'Shows one deploy flow: the connection slots it needs, the parameters to fill in (name, pattern, default) and its steps in order. Use it to know what to ask the person before planning a run.',
      tier: 'read',
      permission: 'flow.read',
      args: z.object({ flowId: z.string().min(1).max(40) }),
      run: async (ctx, args) => {
        const f = await getFlow(ctx, args.flowId);
        return { nama: f.flow.name, jenis: f.flow.kind, versi: f.version, slotKoneksi: f.definition.slots.map((s) => ({ nama: s.name, jenis: s.kind })), parameter: f.definition.params.map((p) => ({ nama: p.name, label: p.label ?? p.name, tipe: p.type, wajib: p.required, bawaan: p.default ?? null, pola: p.pattern })), langkah: f.definition.nodes.map((n) => ({ id: n.id, alat: n.tool, label: n.label ?? n.id })) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'plan_flow_run',
      description: 'Plans a run of a deploy flow for a product and asks for approval. It changes NOTHING on any server: it only creates the plan and a pending approval that a person must approve. Ask the person for every parameter and which connection fills each slot; never invent a value. Product id from list_products.',
      tier: 'draft',
      permission: 'setup.run',
      args: z.object({
        flowId: z.string().min(1).max(40),
        productId: z.string().min(1).max(40),
        params: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])).default({}),
        bindings: z.record(z.string(), z.string().min(1).max(40)).default({}),
      }),
      run: async (ctx, args) => {
        const plan = await planRun(ctx, args);
        return { runId: plan.runId, persetujuanId: plan.approvalId, langkahYangMengubah: plan.changes.map((c) => c.label ?? c.tool), catatan: 'Rencana dibuat dan menunggu persetujuan manusia di Action Center atau halaman run. Belum ada yang dijalankan.' };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_setup_runs',
      description: 'Lists recent runs of deploy flows with their status (waiting for approval, running, paused on an error, done, cancelled).',
      tier: 'read',
      permission: 'setup.read',
      args: z.object({ flowId: z.string().min(1).max(40).optional() }),
      run: async (ctx, args) => {
        const rows = await listRuns(ctx, args);
        const label = { planned: 'direncanakan', awaiting_approval: 'menunggu persetujuan', running: 'berjalan', paused: 'berhenti karena galat', done: 'selesai', failed: 'gagal', cancelled: 'dibatalkan' } as const;
        return { jumlah: rows.length, run: rows.slice(0, 20).map((r) => ({ id: r.id, status: label[r.status], untuk: r.domain || null, galat: r.error })) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'get_setup_run',
      description: 'Shows one run of a deploy flow: its status and, step by step, what is pending, running, done or failed (with the reason). Use it to answer "how far is it".',
      tier: 'read',
      permission: 'setup.read',
      args: z.object({ runId: z.string().min(1).max(40) }),
      run: async (ctx, args) => {
        const r = await getRun(ctx, args.runId);
        return { status: r.status, galat: r.error, langkah: r.steps.map((s) => ({ langkah: s.node, alat: s.tool, status: s.status, galat: s.error })) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'describe_capabilities',
      description: 'Describes what this assistant can do: the tools available to the current user and what each one reads. Use it for questions about the assistant itself.',
      tier: 'read',
      permission: 'assistant.use',
      args: z.object({}),
      run: async (ctx) => ({
        alat: registry
          .list()
          .filter((t) => can(ctx.role, t.permission) && t.name !== 'report_out_of_scope')
          .map((t) => ({ nama: t.name, jenis: t.tier, fungsi: t.description })),
        catatan: 'Asisten hanya menjawab dari hasil alat di atas. Data lead tersedia setelah alatnya dibangun.',
      }),
    }),
  );

  registry.register(
    defineTool({
      name: 'report_out_of_scope',
      description: 'Call this when the question is not about this organization business at all (general knowledge, politics, entertainment, homework, anything unrelated). Greetings, thanks, questions about what you can do, and business discussion or advice are NOT out of scope. Never answer an out-of-scope question yourself.',
      tier: 'read',
      permission: 'assistant.use',
      args: z.object({ reason: z.string().trim().min(1).max(200) }),
      run: async () => ({ outOfScope: true }),
    }),
  );

  return registry;
}
