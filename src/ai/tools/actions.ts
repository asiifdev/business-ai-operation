import { z } from 'zod';
import { getFinding } from '../../domain/action-center/findings';
import type { FindingRule } from '../../domain/action-center/facts';
import { markInvoiceSent } from '../../domain/billing/invoices';
import { finalizeDocument } from '../../domain/documents/service';
import { startRun } from '../../domain/flows/service';
import { convertLeadToClient } from '../../domain/pipeline/leads';
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
  description: 'Proposes to turn a WON lead into a client: a new client from the lead\'s details, or linked to an existing client when clientId is given, plus the onboarding checklist as tasks. Only for leads in the Won stage. It never runs by itself: a person must approve it first. Nothing is sent to anyone.',
  tier: 'act',
  permission: 'lead.convert',
  args: z.object({ leadId: z.string().min(1).max(40), clientId: z.string().min(1).max(40).optional() }),
  execute: async (ctx, args) => convertLeadToClient(ctx, args.leadId, args.clientId ? { mode: 'link', clientId: args.clientId } : { mode: 'create' }),
  describe: (args) =>
    args.clientId
      ? 'Jadikan lead yang menang ini klien dengan menautkannya ke klien yang sudah ada, lalu buat checklist onboarding sebagai tugas. Tidak ada pesan yang dikirim.'
      : 'Jadikan lead yang menang ini klien baru dari data lead, lalu buat checklist onboarding sebagai tugas. Tidak ada pesan yang dikirim.',
});

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
  }

  return registry;
}

/** Tools whose effect is on money: only people who may decide finance approvals can approve them (BR-M08-07). */
export const FINANCIAL_ACT_TOOLS: ReadonlySet<string> = new Set(['mark_invoice_sent']);
