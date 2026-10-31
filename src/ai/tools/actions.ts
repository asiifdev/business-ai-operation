import { z } from 'zod';
import { getFinding } from '../../domain/action-center/findings';
import type { FindingRule } from '../../domain/action-center/facts';
import { markInvoiceSent } from '../../domain/billing/invoices';
import { finalizeDocument } from '../../domain/documents/service';
import { startRun } from '../../domain/flows/service';
import { convertLeadToClient, moveLead, updateLead } from '../../domain/pipeline/leads';
import { createSubscription } from '../../domain/billing/subscriptions';
import { createClient, updateClient } from '../../domain/portfolio/clients';
import { createDeployment, updateDeployment } from '../../domain/portfolio/deployments';
import { createProduct, updateProduct } from '../../domain/portfolio/products';
import { setTaskStatus, updateTask } from '../../domain/tasks/service';
import { TASK_KINDS, TASK_PRIORITIES, TASK_STATUSES } from '../../domain/tasks/rules';
import { STAGES } from '../../domain/pipeline/stages';
import { formatRupiah } from '../../lib/format';
import { ToolRegistry, defineTool } from './registry';

const money = (n: number) => ({ teks: formatRupiah(n), angka: n });
const invoiceStatus = { draft: 'draf', sent: 'terkirim', paid: 'lunas', void: 'batal' } as const;
const taskKindLabel = { task: 'tugas', bug: 'bug', feature: 'fitur', maintenance: 'maintenance' } as const;
const taskStatusLabel = { open: 'terbuka', in_progress: 'dikerjakan', done: 'selesai' } as const;
const taskPriorityLabel = { low: 'rendah', medium: 'sedang', high: 'tinggi', urgent: 'mendesak' } as const;
const ruleLabel: Record<FindingRule, string> = {
  invoice_overdue: 'invoice lewat jatuh tempo',
  invoice_draft_ready: 'draf invoice siap ditinjau',
  renewal_upcoming: 'langganan mendekati jatuh tempo',
  task_late: 'tugas terlambat',
  lead_stagnant: 'lead stagnan',
  deployment_outdated: 'kode deployment tertinggal',
  deployment_down: 'domain deployment mati',
};

/**
 * BR-M06-03: finalizing a document is an `act` tool. In the assistant it becomes a pending approval; once approved
 * the document is numbered and frozen. Nothing is sent to the client.
 */
export const finalizeDocumentTool = defineTool({
  name: 'finalize_document',
  description: 'Proposes to FINALIZE a draft proposal, quotation or minutes: it gets its number and can never be edited again (a revision is a new version). It never runs by itself: a person must approve it first. Nothing is sent to the client.',
  tier: 'act',
  permission: 'document.finalize',
  args: z.object({ documentId: z.string().min(1).max(40) }),
  execute: async (ctx, args) => finalizeDocument(ctx, args.documentId),
  describe: () => 'Finalkan dokumen ini: dokumen mendapat nomor dan tidak dapat diubah lagi (revisi menjadi versi baru). Tidak ada pesan yang dikirim ke klien.',
});

/**
 * D-061: running a deploy flow is an `act` tool. The plan (the flow version, its parameters, its connections) was fixed and
 * hashed when it was proposed; approving it starts exactly that run, and the hash is worked out again before it starts.
 */
export const startFlowRunTool = defineTool({
  name: 'start_flow_run',
  description: 'Proposes to RUN a planned deploy flow on the organization\'s own servers. The plan (flow version, parameters, connections) is already fixed. It never runs by itself: a person must approve it first.',
  tier: 'act',
  permission: 'setup.run',
  args: z.object({ runId: z.string().min(1).max(40), planHash: z.string().regex(/^[0-9a-f]{64}$/) }),
  execute: async (ctx, args) => startRun(ctx, args.runId, args.planHash),
  describe: () => 'Jalankan flow deploy yang sudah direncanakan: persis sesuai rencana yang ditampilkan (versi flow, parameter, dan koneksi). Langkah yang mengubah server berjalan satu per satu dengan progres yang terlihat.',
});

/**
 * BR-M04 / BRD-M07: turning a won lead into a client is an `act` tool. In the assistant it becomes a pending approval; once
 * approved it runs `convertLeadToClient`, the service behind the button on the lead page (new client, or linked to an
 * existing one, plus the onboarding checklist). The service itself refuses a lead that is not won or already converted.
 */
export const convertLeadToClientTool = defineTool({
  name: 'convert_lead_to_client',
  description: 'Proposes to turn a WON lead into a client: a new client from the lead\'s details, or linked to an existing client when clientId is given, plus the onboarding checklist as tasks. Only for leads in the Won stage. The system decides whether it runs at once or waits for a person\'s approval. Nothing is sent to anyone.',
  tier: 'act',
  permission: 'lead.convert',
  args: z.object({ leadId: z.string().min(1).max(40), clientId: z.string().min(1).max(40).optional() }),
  execute: async (ctx, args) => convertLeadToClient(ctx, args.leadId, args.clientId ? { mode: 'link', clientId: args.clientId } : { mode: 'create' }),
  describe: (args) =>
    args.clientId
      ? 'Jadikan lead yang menang ini klien dengan menautkannya ke klien yang sudah ada, lalu buat checklist onboarding sebagai tugas. Tidak ada pesan yang dikirim.'
      : 'Jadikan lead yang menang ini klien baru dari data lead, lalu buat checklist onboarding sebagai tugas. Tidak ada pesan yang dikirim.',
});

const stageName = { new: 'Baru', exploring: 'Penjajakan', proposal: 'Proposal', negotiation: 'Negosiasi', won: 'Menang', lost: 'Kalah' } as const;
const id = z.string().trim().min(1).max(40);
const text = (max: number) => z.string().trim().max(max);

/**
 * The data tools (BRD-M07 Appendix A): every record the assistant may add or change after a person approved it. Each one runs
 * the same service as the form behind it, as the approver, so permissions, validation and audit are the service's own.
 * Money, status of payment, due dates, prices, roles, settings and deletions have no tool here (BR-M07-04).
 */
export const createClientTool = defineTool({
  name: 'create_client',
  description: 'Proposes to ADD a new client (name, and optionally contact person, email, phone, address, notes) from what the person asked. Check list_clients first: do not propose a client that already exists. The system decides whether it runs at once or waits for a person\'s approval. Nothing is sent to anyone.',
  tier: 'act',
  permission: 'client.write',
  args: z.object({ name: text(120).min(2), contactName: text(120).optional(), email: text(254).email().optional(), phone: text(40).optional(), address: text(500).optional(), notes: text(2000).optional() }),
  execute: async (ctx, args) => createClient(ctx, args),
  describe: (args) => `Tambahkan klien baru "${args.name}"${args.contactName ? ` (kontak: ${args.contactName})` : ''}. Tidak ada pesan yang dikirim.`,
});

export const updateClientTool = defineTool({
  name: 'update_client',
  description: 'Proposes to CHANGE details of an existing client (name, contact person, email, phone, address, notes). Give only the fields that change; clientId from list_clients. The system decides whether it runs at once or waits for a person\'s approval.',
  tier: 'act',
  permission: 'client.write',
  args: z.object({ clientId: id, name: text(120).min(2).optional(), contactName: text(120).optional(), email: text(254).email().optional(), phone: text(40).optional(), address: text(500).optional(), notes: text(2000).optional() }),
  execute: async (ctx, { clientId, ...patch }) => updateClient(ctx, clientId, patch),
  describe: () => 'Ubah data klien sesuai isian di bawah. Tidak ada pesan yang dikirim.',
});

export const createProductTool = defineTool({
  name: 'create_product',
  description: 'Proposes to ADD a new product to the catalogue (name, description, current version). Packages and prices are set by a person on the product page, never by you. Check list_products first. The system decides whether it runs at once or waits for a person\'s approval.',
  tier: 'act',
  permission: 'catalog.write',
  args: z.object({ name: text(120).min(2), description: text(2000).optional(), currentVersion: text(40).optional() }),
  execute: async (ctx, args) => createProduct(ctx, args),
  describe: (args) => `Tambahkan produk baru "${args.name}" ke katalog. Paket dan harga diisi orang di halaman produk.`,
});

export const updateProductTool = defineTool({
  name: 'update_product',
  description: 'Proposes to CHANGE a product (name, description, current version). Give only what changes; productId from list_products. Prices are not touched. The system decides whether it runs at once or waits for a person\'s approval.',
  tier: 'act',
  permission: 'catalog.write',
  args: z.object({ productId: id, name: text(120).min(2).optional(), description: text(2000).optional(), currentVersion: text(40).optional() }),
  execute: async (ctx, { productId, ...patch }) => updateProduct(ctx, productId, patch),
  describe: () => 'Ubah data produk sesuai isian di bawah. Harga paket tidak disentuh.',
});

export const createDeploymentTool = defineTool({
  name: 'create_deployment',
  description: 'Proposes to RECORD a deployment: a product installed for a client (ids from list_products and list_clients), with environment (default production), optional label, domain (host name only, no https:// and no login) and installed version. The system decides whether it runs at once or waits for a person\'s approval. It does not install anything on a server.',
  tier: 'act',
  permission: 'deployment.write',
  args: z.object({ productId: id, clientId: id, environment: text(30).min(2).optional(), label: text(120).optional(), domain: text(253).optional(), installedVersion: text(40).optional() }),
  execute: async (ctx, args) => createDeployment(ctx, args),
  describe: (args) => `Catat deployment baru (${args.environment ?? 'production'}${args.domain ? `, ${args.domain}` : ''}). Tidak ada yang dipasang di server.`,
});

export const updateDeploymentTool = defineTool({
  name: 'update_deployment',
  description: 'Proposes to CHANGE a recorded deployment (environment, label, domain, installed version, active or inactive). deploymentId from list_deployments. The system decides whether it runs at once or waits for a person\'s approval. It does not touch any server.',
  tier: 'act',
  permission: 'deployment.write',
  args: z.object({ deploymentId: id, environment: text(30).min(2).optional(), label: text(120).optional(), domain: text(253).optional(), installedVersion: text(40).optional(), status: z.enum(['active', 'inactive']).optional() }),
  execute: async (ctx, { deploymentId, ...patch }) => updateDeployment(ctx, deploymentId, patch),
  describe: () => 'Ubah catatan deployment sesuai isian di bawah. Server tidak disentuh.',
});

export const updateLeadTool = defineTool({
  name: 'update_lead',
  description: 'Proposes to CHANGE a lead (name, contact person, email, phone, source, needs, estimated value in Rupiah, assignedTo = a user id from list_team_members). Give only what changes; leadId from list_leads. The system decides whether it runs at once or waits for a person\'s approval.',
  tier: 'act',
  permission: 'lead.update_assigned',
  args: z.object({ leadId: id, name: text(120).min(2).optional(), contactName: text(120).optional(), email: text(254).email().optional(), phone: text(40).optional(), source: text(80).optional(), needsSummary: text(4000).optional(), estimatedValue: z.number().int().min(0).optional(), assignedTo: id.nullable().optional() }),
  execute: async (ctx, { leadId, ...patch }) => updateLead(ctx, leadId, patch),
  describe: () => 'Ubah data lead sesuai isian di bawah.',
});

export const moveLeadTool = defineTool({
  name: 'move_lead',
  description: 'Proposes to MOVE a lead one step to another pipeline stage (exploring, proposal, negotiation, won, lost). A lost lead needs lostReason. The system refuses an invalid move. leadId from list_leads. The system decides whether it runs at once or waits for a person\'s approval.',
  tier: 'act',
  permission: 'lead.update_assigned',
  args: z.object({ leadId: id, to: z.enum(STAGES), lostReason: text(500).optional() }),
  execute: async (ctx, args) => moveLead(ctx, args.leadId, args.to, args.lostReason ? { lostReason: args.lostReason } : {}),
  describe: (args) => `Pindahkan lead ke tahap "${stageName[args.to]}"${args.lostReason ? ` (alasan: ${args.lostReason})` : ''}.`,
});

export const updateTaskTool = defineTool({
  name: 'update_task',
  description: 'Proposes to CHANGE an accepted task: status (open, in_progress, done), priority, due date (YYYY-MM-DD), assignee (user id from list_team_members), title or description. taskId from list_tasks. The system decides whether it runs at once or waits for a person\'s approval.',
  tier: 'act',
  permission: 'task.update_own',
  args: z.object({
    taskId: id,
    status: z.enum(TASK_STATUSES).optional(),
    title: text(200).min(2).optional(),
    description: text(4000).optional(),
    kind: z.enum(TASK_KINDS).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    assigneeId: id.nullable().optional(),
  }),
  execute: async (ctx, { taskId, status, ...patch }) => {
    if (Object.keys(patch).length) await updateTask(ctx, taskId, patch);
    if (status) await setTaskStatus(ctx, taskId, status);
  },
  describe: () => 'Ubah tugas sesuai isian di bawah.',
});

export const createSubscriptionTool = defineTool({
  name: 'create_subscription',
  description: 'Proposes to START a subscription for a client on an official package (ids from list_clients and get_product_packages), billed every intervalMonths (default 1). The amount is copied from the package by the system; you cannot set a price. It never runs by itself: a person with finance rights must approve it first. Nothing is sent to the client.',
  tier: 'act',
  permission: 'billing.write',
  args: z.object({ clientId: id, packageId: id, deploymentId: id.optional(), intervalMonths: z.number().int().min(1).max(60).optional(), startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  execute: async (ctx, args) => createSubscription(ctx, args),
  describe: (args) => `Mulai langganan untuk klien ini dengan paket resmi, tagihan tiap ${args.intervalMonths ?? 1} bulan. Nominal diambil dari paket oleh sistem; tidak ada pesan yang dikirim.`,
});

/** The `act` tools on records. Registered in the assistant catalogue and in the registry the approval decision looks tools up in. */
export const DATA_ACT_TOOLS = [createClientTool, updateClientTool, createProductTool, updateProductTool, createDeploymentTool, updateDeploymentTool, updateLeadTool, moveLeadTool, updateTaskTool, createSubscriptionTool] as const;

export interface ActionFinding {
  id: string;
  rule: FindingRule;
  /** The invoice behind the finding, when there is one: the only invoice an `act` tool proposed for it may touch. */
  invoiceId?: string;
}

/**
 * Tools of the Action Center (BRD-M08 section 4). Built for one finding when the agent explains it: one `read` tool that
 * returns the finding's facts from the same service as the card, and, only for a draft that is ready, the `act` tool
 * `mark_invoice_sent` locked to that invoice. Built without a finding it is the catalogue the approval decision looks
 * tools up in. An `act` tool never runs here: the agent turns it into a pending approval (BR-M08-04).
 */
export function buildActionRegistry(finding?: ActionFinding): ToolRegistry {
  const registry = new ToolRegistry();

  if (finding) {
    registry.register(
      defineTool({
        name: 'get_finding_facts',
        description: 'Returns the facts of the finding being explained, read live from the source record: kind, client, invoice, subscription or task, amounts, dates and days late. Call it first; every number you write must come from it.',
        tier: 'read',
        permission: 'finding.read_nonfinancial',
        args: z.object({}),
        run: async (ctx) => {
          const card = await getFinding(ctx, finding.id);
          const f = card.facts;
          const base = { jenisTemuan: ruleLabel[card.rule], prioritas: card.priority.level };
          if (f.kind === 'invoice') {
            return {
              ...base,
              invoiceId: f.invoiceId,
              nomor: f.number ?? 'belum bernomor (draf)',
              klien: f.clientName,
              status: invoiceStatus[f.status],
              jatuhTempo: f.dueDate,
              total: money(f.total),
              sisaTagihan: money(f.balance),
              lewatJatuhTempo: f.overdue,
              terlambatHari: f.daysOverdue,
              drafOtomatis: f.isAiDraft,
            };
          }
          if (f.kind === 'task') {
            return {
              ...base,
              tugas: f.title,
              jenis: taskKindLabel[f.taskKind],
              status: taskStatusLabel[f.status],
              prioritasTugas: taskPriorityLabel[f.priority],
              tenggat: f.dueDate,
              terlambatHari: f.daysLate,
              penanggungJawab: f.assigneeName ?? 'belum ditetapkan',
              klien: f.clientName ?? 'tidak terkait klien',
            };
          }
          if (f.kind === 'deployment') {
            return {
              ...base,
              klien: f.clientName,
              produk: f.productName,
              lingkungan: f.environment,
              domain: f.domain ?? 'belum diisi',
              repo: f.repo,
              branch: f.branch,
              tertinggalCommit: f.behindBy,
              statusSitus: f.uptimeState === 'down' ? 'tidak dapat dijangkau' : f.uptimeState === 'up' ? 'dapat dijangkau' : 'belum dicek',
              berubahSejak: f.uptimeChangedAt,
            };
          }
          if (f.kind === 'lead') {
            return {
              ...base,
              lead: f.name,
              tahap: f.stage,
              hariDiTahapIni: f.daysInStage,
              batasStagnanHari: f.stagnantDays,
              nilaiEstimasi: f.estimatedValue != null ? money(f.estimatedValue) : 'belum diisi',
              penanggungJawab: f.assigneeName ?? 'belum ditetapkan',
            };
          }
          if (f.kind === 'subscription') {
            return { ...base, klien: f.clientName, produk: f.productName, paket: f.packageName, nominal: money(f.amount), jatuhTempoBerikutnya: f.nextDueDate, hariMenujuJatuhTempo: f.daysUntilDue };
          }
          return { ...base, catatan: 'Data sumber tidak ditemukan.' };
        },
      }),
    );
  }

  if (!finding || (finding.rule === 'invoice_draft_ready' && finding.invoiceId)) {
    registry.register(
      defineTool({
        name: 'mark_invoice_sent',
        description: 'Proposes to mark a DRAFT invoice as sent: it gets its number and its content is locked. This does not send anything to the client. It never runs by itself: a person must approve it first.',
        tier: 'act',
        permission: 'billing.write',
        args: z.object({ invoiceId: finding?.invoiceId ? z.literal(finding.invoiceId) : z.string().min(1).max(40) }),
        execute: async (ctx, args) => markInvoiceSent(ctx, args.invoiceId),
        describe: () => 'Tandai draf invoice ini terkirim: invoice mendapat nomor dan isinya dikunci. Tidak ada pesan yang dikirim ke klien.',
      }),
    );
  }

  // The catalogue the approval decision looks tools up in; a finding's own card never proposes it.
  if (!finding) {
    registry.register(finalizeDocumentTool);
    registry.register(startFlowRunTool);
    registry.register(convertLeadToClientTool);
    for (const tool of DATA_ACT_TOOLS) registry.register(tool);
  }

  return registry;
}

/** Tools whose effect is on money: only people who may decide finance approvals can approve them (BR-M08-07). */
export const FINANCIAL_ACT_TOOLS: ReadonlySet<string> = new Set(['mark_invoice_sent', 'create_subscription']);
