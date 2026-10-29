import { and, eq } from 'drizzle-orm';
import { getAiProvider } from '../../ai';
import type { AiProvider } from '../../ai/provider';
import { chatOnce } from '../../ai/run';
import { wrapUntrusted } from '../../ai/untrusted';
import { db } from '../../db/client';
import { clients, documents, leads, organizations } from '../../db/schema';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { who } from '../portfolio/shared';
import { getDocument } from './service';
import { foreignFigures, narrativeInstructions } from './rules';

export type NarrativeResult = { ok: true; narrative: string; runId: string } | { ok: false; message: string; label: string };

/**
 * The AI writes the words of a draft proposal or quotation (BR-M06 section 4). It is given the structured facts and no
 * tools, and it may not write prices or dates: the narrative is dropped, not patched, if it contains a figure that is not
 * in those facts (BR-M06-01, -11). Prices and totals stay in the item table, computed by code. The draft stays
 * "AI-assisted" until a person saves it (BR-M06-05).
 */
export async function draftNarrative(ctx: Ctx, id: string, provider: AiProvider = getAiProvider()): Promise<NarrativeResult> {
  assertCan(ctx, 'document.write');
  const doc = await getDocument(ctx, id);
  if (doc.status !== 'draft') throw new DomainError('invalid_state', 'only a draft can be edited');
  if (doc.kind === 'minutes') throw new DomainError('validation', 'minutes are written from the meeting');

  const [[org], [client], [lead]] = await Promise.all([
    db.select({ name: organizations.name, locale: organizations.locale }).from(organizations).where(eq(organizations.id, ctx.orgId)),
    doc.clientId ? db.select({ name: clients.name, contact: clients.contactName }).from(clients).where(and(eq(clients.orgId, ctx.orgId), eq(clients.id, doc.clientId))) : Promise.resolve([]),
    doc.leadId ? db.select({ name: leads.name, contact: leads.contactName, needs: leads.needsSummary }).from(leads).where(and(eq(leads.orgId, ctx.orgId), eq(leads.id, doc.leadId))) : Promise.resolve([]),
  ]);

  // Quantities and titles are facts the model may repeat; money and dates are left out of what it sees.
  const facts = [
    `Organisasi: ${org?.name ?? ''}`,
    `Judul dokumen: ${doc.title}`,
    `Penerima: ${client?.name ?? lead?.name ?? ''}${(client?.contact ?? lead?.contact) ? ` (${client?.contact ?? lead?.contact})` : ''}`,
    'Item yang ditawarkan:',
    ...doc.items.map((i) => `- ${i.description}`),
  ].join('\n');
  const untrusted = lead?.needs ? `\n\n${wrapUntrusted('kebutuhan lead', lead.needs.slice(0, 4000))}` : '';

  const out = await chatOnce({
    db,
    ctx,
    provider,
    locale: org?.locale ?? 'id',
    feature: 'agent',
    inputSummary: `Narasi ${doc.kind} (${doc.items.length} item)`,
    entityType: 'document',
    entityId: id,
    request: {
      messages: [
        { role: 'developer', content: narrativeInstructions(doc.kind, org?.locale ?? 'id') },
        { role: 'user', content: facts + untrusted },
      ],
      effort: 'low',
      maxTokens: 1200,
    },
  });
  if (!out.ok) return { ok: false, message: out.message, label: out.label };

  const text = (out.value.text ?? '').trim();
  const stray = foreignFigures(text, facts + untrusted);
  if (!text || stray.length > 0) {
    return { ok: false, message: org?.locale === 'en' ? 'The draft contained figures that are not in your data, so it was discarded. Try again or write it yourself.' : 'Draf berisi angka yang tidak ada di data Anda, jadi dibuang. Coba lagi atau tulis sendiri.', label: '' };
  }

  await db.transaction(async (tx) => {
    const res = await tx.update(documents).set({ narrative: text, isAiDraft: true }).where(and(eq(documents.orgId, ctx.orgId), eq(documents.id, id), eq(documents.status, 'draft'))).returning({ id: documents.id });
    if (res.length === 0) throw new DomainError('invalid_state', 'only a draft can be edited');
    await recordAudit(tx, { ...who(ctx), aiRunId: out.runId }, { action: 'document.narrative_drafted', entityType: 'document', entityId: id, summary: { runId: out.runId, characters: text.length } });
  });
  return { ok: true, narrative: text, runId: out.runId };
}
