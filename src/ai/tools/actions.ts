import { z } from 'zod';
import { getFinding } from '../../domain/action-center/findings';
import type { FindingRule } from '../../domain/action-center/facts';
import { markInvoiceSent } from '../../domain/billing/invoices';
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
};

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

  return registry;
}

/** Tools whose effect is on money: only people who may decide finance approvals can approve them (BR-M08-07). */
export const FINANCIAL_ACT_TOOLS: ReadonlySet<string> = new Set(['mark_invoice_sent']);
