import { z } from 'zod';
import { cancelInvoice, deleteInvoiceDraft } from '../../domain/billing/invoices';
import { stopSubscription, updateSubscription } from '../../domain/billing/subscriptions';
import { deleteDraft, reviseDocument, updateDraft } from '../../domain/documents/service';
import { archiveFlow } from '../../domain/flows/service';
import { acceptLeadDraft, reopenLead, setLeadArchived } from '../../domain/pipeline/leads';
import { deleteClient, setClientArchived } from '../../domain/portfolio/clients';
import { deleteDeployment } from '../../domain/portfolio/deployments';
import { archiveProduct, deleteProduct, setPackageArchived, unarchiveProduct } from '../../domain/portfolio/products';
import { acceptTaskDraft, discardTaskDraft } from '../../domain/tasks/service';
import { defineTool } from './registry';

const id = z.string().trim().min(1).max(40);
const text = (max: number) => z.string().trim().max(max);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const WAIT = ' The system decides whether it runs at once or waits for a person\'s approval.';
const NOTHING_SENT = ' Nothing is sent to anyone.';

/**
 * D-091: the management tools. Everything a person can edit, archive or delete in the app has a tool here, so the assistant
 * finishes the work instead of sending the person to a page. Each one runs the same service as the button, as the approver, so
 * permissions, validation, history checks (a client with history cannot be deleted) and audit are the service's own.
 * Risk is decided in `ACT_RISK`: archiving can be taken back by its twin; deleting, money and cancelling always wait for a click.
 * Still no tool for payments, prices, invoice amounts or due dates, roles, settings, the AI budget or sending messages (BR-M07-04).
 */

// ---- Tasks and leads: review what the assistant drafted -------------------------------------------------------------
export const acceptTaskDraftTool = defineTool({
  name: 'accept_task_draft',
  description: 'Proposes to ACCEPT a draft task (one made by the assistant or from a meeting) so it counts as real open work. taskId from list_tasks (drafts are marked).' + WAIT,
  tier: 'act',
  permission: 'task.update_own',
  args: z.object({ taskId: id }),
  execute: async (ctx, args) => acceptTaskDraft(ctx, args.taskId),
  describe: () => 'Terima draf tugas ini: tugas dihitung sebagai pekerjaan terbuka.',
});

export const discardTaskDraftTool = defineTool({
  name: 'discard_task_draft',
  description: 'Proposes to DISCARD a draft task that is not wanted (only a draft; accepted tasks are closed with update_task, never removed). taskId from list_tasks.' + WAIT,
  tier: 'act',
  permission: 'task.update_own',
  args: z.object({ taskId: id }),
  execute: async (ctx, args) => discardTaskDraft(ctx, args.taskId),
  describe: () => 'Buang draf tugas ini. Hanya draf yang bisa dibuang; tugas yang sudah diterima ditutup, bukan dihapus.',
});

export const acceptLeadDraftTool = defineTool({
  name: 'accept_lead_draft',
  description: 'Proposes to ACCEPT a draft lead so it enters the pipeline. leadId from list_leads (drafts are marked).' + WAIT,
  tier: 'act',
  permission: 'lead.write',
  args: z.object({ leadId: id }),
  execute: async (ctx, args) => acceptLeadDraft(ctx, args.leadId),
  describe: () => 'Terima draf lead ini sehingga masuk ke pipeline.',
});

export const reopenLeadTool = defineTool({
  name: 'reopen_lead',
  description: 'Proposes to REOPEN a closed (won or lost) lead that did not become a client yet, with a note why, back to a stage (default new). leadId from list_leads.' + WAIT,
  tier: 'act',
  permission: 'lead.write',
  args: z.object({ leadId: id, note: text(500).min(3), to: z.enum(['new', 'exploring', 'proposal', 'negotiation']).optional() }),
  execute: async (ctx, args) => reopenLead(ctx, args.leadId, { note: args.note, to: args.to }),
  describe: (args) => `Buka kembali lead yang sudah ditutup (alasan: ${args.note}).`,
});

export const archiveLeadTool = defineTool({
  name: 'archive_lead',
  description: 'Proposes to ARCHIVE a lead (hide it from the board, keep its history) or, with archived=false, bring it back. leadId from list_leads.' + WAIT,
  tier: 'act',
  permission: 'lead.write',
  args: z.object({ leadId: id, archived: z.boolean().default(true) }),
  execute: async (ctx, args) => setLeadArchived(ctx, args.leadId, args.archived),
  describe: (args) => (args.archived ? 'Arsipkan lead ini: hilang dari papan, riwayatnya tetap ada.' : 'Kembalikan lead ini dari arsip ke papan.'),
});

// ---- Clients, products, deployments ----------------------------------------------------------------------------------
export const archiveClientTool = defineTool({
  name: 'archive_client',
  description: 'Proposes to ARCHIVE a client (hide it from lists, keep all history) or, with archived=false, bring it back. clientId from list_clients.' + WAIT + NOTHING_SENT,
  tier: 'act',
  permission: 'catalog.archive',
  args: z.object({ clientId: id, archived: z.boolean().default(true) }),
  execute: async (ctx, args) => setClientArchived(ctx, args.clientId, args.archived),
  describe: (args) => (args.archived ? 'Arsipkan klien ini: hilang dari daftar, seluruh riwayatnya tetap ada.' : 'Kembalikan klien ini dari arsip.'),
});

export const deleteClientTool = defineTool({
  name: 'delete_client',
  description: 'Proposes to DELETE a client for good. Only a client with NO history (no deployments, invoices, tasks, documents) can be deleted; the system refuses otherwise and then archive_client is the answer. Always waits for a person\'s approval. clientId from list_clients.',
  tier: 'act',
  permission: 'catalog.archive',
  args: z.object({ clientId: id }),
  execute: async (ctx, args) => deleteClient(ctx, args.clientId),
  describe: () => 'HAPUS klien ini selamanya. Hanya klien tanpa riwayat yang bisa dihapus; sistem menolak bila ada riwayat.',
});

export const archiveProductTool = defineTool({
  name: 'archive_product',
  description: 'Proposes to ARCHIVE a product (hide it from the catalogue, keep history) or, with archived=false, bring it back. productId from list_products.' + WAIT,
  tier: 'act',
  permission: 'catalog.archive',
  args: z.object({ productId: id, archived: z.boolean().default(true) }),
  execute: async (ctx, args) => (args.archived ? archiveProduct(ctx, args.productId) : unarchiveProduct(ctx, args.productId)),
  describe: (args) => (args.archived ? 'Arsipkan produk ini: hilang dari katalog, riwayatnya tetap ada.' : 'Kembalikan produk ini dari arsip.'),
});

export const deleteProductTool = defineTool({
  name: 'delete_product',
  description: 'Proposes to DELETE a product and its packages for good. Only a product with NO history (no deployments, subscriptions, documents) can be deleted; the system refuses otherwise and then archive_product is the answer. Always waits for a person\'s approval.',
  tier: 'act',
  permission: 'catalog.archive',
  args: z.object({ productId: id }),
  execute: async (ctx, args) => deleteProduct(ctx, args.productId),
  describe: () => 'HAPUS produk ini beserta paketnya selamanya. Hanya produk tanpa riwayat yang bisa dihapus.',
});

export const archivePackageTool = defineTool({
  name: 'archive_package',
  description: 'Proposes to ARCHIVE a package of a product (it can no longer be chosen for new subscriptions) or, with archived=false, bring it back. packageId from get_product_packages. Prices are never touched.' + WAIT,
  tier: 'act',
  permission: 'catalog.archive',
  args: z.object({ packageId: id, archived: z.boolean().default(true) }),
  execute: async (ctx, args) => setPackageArchived(ctx, args.packageId, args.archived),
  describe: (args) => (args.archived ? 'Arsipkan paket ini: tidak bisa dipilih untuk langganan baru. Harga tidak disentuh.' : 'Kembalikan paket ini dari arsip.'),
});

export const deleteDeploymentTool = defineTool({
  name: 'delete_deployment',
  description: 'Proposes to DELETE a recorded deployment (the record only, nothing on any server). The system refuses when a subscription or task still uses it; then set it inactive with update_deployment. Always waits for a person\'s approval. deploymentId from list_deployments.',
  tier: 'act',
  permission: 'catalog.archive',
  args: z.object({ deploymentId: id }),
  execute: async (ctx, args) => deleteDeployment(ctx, args.deploymentId),
  describe: () => 'HAPUS catatan deployment ini. Server tidak disentuh; sistem menolak bila masih dipakai langganan atau tugas.',
});

// ---- Billing: stop, terms, cancel (money: always a click) ------------------------------------------------------------
export const stopSubscriptionTool = defineTool({
  name: 'stop_subscription',
  description: 'Proposes to STOP an active subscription: no new invoices are made, the ones already made stay. subscriptionId from list_subscriptions. It never runs by itself: a person with finance rights must approve it.',
  tier: 'act',
  permission: 'billing.write',
  args: z.object({ subscriptionId: id }),
  execute: async (ctx, args) => stopSubscription(ctx, args.subscriptionId),
  describe: () => 'Hentikan langganan ini: tidak ada invoice baru, invoice yang sudah dibuat tetap ada.',
});

export const updateSubscriptionTermsTool = defineTool({
  name: 'update_subscription_terms',
  description: 'Proposes to CHANGE how often an active subscription bills (intervalMonths) or its grace days before it counts as late (graceDays, null = follow the organization). The AMOUNT cannot be changed by you. subscriptionId from list_subscriptions. It never runs by itself: a person with finance rights must approve it.',
  tier: 'act',
  permission: 'billing.write',
  args: z.object({ subscriptionId: id, intervalMonths: z.number().int().min(1).max(60).optional(), graceDays: z.number().int().min(0).max(365).nullable().optional() }),
  execute: async (ctx, { subscriptionId, ...patch }) => updateSubscription(ctx, subscriptionId, patch),
  describe: () => 'Ubah jadwal tagihan atau hari tenggang langganan ini. Nominal tidak disentuh.',
});

export const cancelInvoiceTool = defineTool({
  name: 'cancel_invoice',
  description: 'Proposes to CANCEL (void) a draft or sent invoice that has no payments, with a reason. invoiceId from list_invoices. It never runs by itself: a person with finance rights must approve it. Nothing is sent to the client.',
  tier: 'act',
  permission: 'billing.write',
  args: z.object({ invoiceId: id, reason: text(500).min(3) }),
  execute: async (ctx, args) => cancelInvoice(ctx, args.invoiceId, { reason: args.reason }),
  describe: (args) => `Batalkan invoice ini (alasan: ${args.reason}). Invoice yang sudah ada pembayarannya ditolak sistem. Tidak ada pesan yang dikirim.`,
});

export const deleteInvoiceDraftTool = defineTool({
  name: 'delete_invoice_draft',
  description: 'Proposes to DELETE a draft invoice that was never sent (any other invoice is cancelled instead). invoiceId from list_invoices. It never runs by itself: a person with finance rights must approve it.',
  tier: 'act',
  permission: 'billing.write',
  args: z.object({ invoiceId: id }),
  execute: async (ctx, args) => deleteInvoiceDraft(ctx, args.invoiceId),
  describe: () => 'HAPUS draf invoice yang belum pernah terkirim. Invoice lain dibatalkan, bukan dihapus.',
});

// ---- Documents and flows ---------------------------------------------------------------------------------------------
export const updateDocumentDraftTool = defineTool({
  name: 'update_document_draft',
  description: 'Proposes to EDIT a DRAFT document: title, narrative text, or valid-until date (YYYY-MM-DD). Line items and prices are not editable by you. A final document is never edited: use revise_document. documentId from list_documents.' + WAIT,
  tier: 'act',
  permission: 'document.write',
  args: z.object({ documentId: id, title: text(200).min(2).optional(), narrative: text(8000).optional(), validUntil: DATE.nullable().optional() }),
  execute: async (ctx, { documentId, ...patch }) => updateDraft(ctx, documentId, patch),
  describe: () => 'Ubah draf dokumen sesuai isian di bawah. Baris dan harga tidak disentuh.',
});

export const reviseDocumentTool = defineTool({
  name: 'revise_document',
  description: 'Proposes to start a REVISION of a final document: a new draft version is made from it, the final one stays untouched. documentId from list_documents.' + WAIT,
  tier: 'act',
  permission: 'document.write',
  args: z.object({ documentId: id }),
  execute: async (ctx, args) => reviseDocument(ctx, args.documentId),
  describe: () => 'Mulai revisi dokumen final ini: dibuat draf versi baru, dokumen final tidak berubah.',
});

export const deleteDocumentDraftTool = defineTool({
  name: 'delete_document_draft',
  description: 'Proposes to DELETE a draft proposal or quotation that was never finalized (final documents and minutes are kept). documentId from list_documents. Always waits for a person\'s approval.',
  tier: 'act',
  permission: 'document.write',
  args: z.object({ documentId: id }),
  execute: async (ctx, args) => deleteDraft(ctx, args.documentId),
  describe: () => 'HAPUS draf dokumen yang belum pernah difinalkan. Dokumen final dan notulen tidak bisa dihapus.',
});

export const archiveFlowTool = defineTool({
  name: 'archive_flow',
  description: 'Proposes to ARCHIVE a flow (it is no longer offered for new runs; history stays). A flow with a free command is for the Owner only. flowId from list_flows.' + WAIT,
  tier: 'act',
  permission: 'flow.write',
  args: z.object({ flowId: id }),
  execute: async (ctx, args) => archiveFlow(ctx, args.flowId),
  describe: () => 'Arsipkan flow ini: tidak ditawarkan lagi untuk jalan baru, riwayatnya tetap ada.',
});

export const MANAGE_ACT_TOOLS = [
  acceptTaskDraftTool, discardTaskDraftTool, acceptLeadDraftTool, reopenLeadTool, archiveLeadTool,
  archiveClientTool, deleteClientTool, archiveProductTool, deleteProductTool, archivePackageTool, deleteDeploymentTool,
  stopSubscriptionTool, updateSubscriptionTermsTool, cancelInvoiceTool, deleteInvoiceDraftTool,
  updateDocumentDraftTool, reviseDocumentTool, deleteDocumentDraftTool, archiveFlowTool,
] as const;

/** Money tools among them: only people who may decide finance approvals can approve these (BR-M08-07). */
export const MANAGE_FINANCIAL_TOOLS = ['stop_subscription', 'update_subscription_terms', 'cancel_invoice', 'delete_invoice_draft'] as const;
