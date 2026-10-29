import type { APIRoute } from 'astro';
import { createDocument, listDocuments } from '../../../domain/documents/service';
import { DOCUMENT_KINDS, type DocumentKind } from '../../../domain/documents/rules';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) =>
  handle(async () => {
    const q = context.url.searchParams;
    const kind = q.get('kind');
    const status = q.get('status');
    return ok({
      documents: await listDocuments(requireCtx(context), {
        kind: DOCUMENT_KINDS.includes(kind as DocumentKind) ? (kind as DocumentKind) : undefined,
        status: status === 'draft' || status === 'final' ? status : undefined,
        clientId: q.get('clientId') ?? undefined,
        leadId: q.get('leadId') ?? undefined,
        allVersions: q.get('allVersions') === '1',
      }),
    });
  });

export const POST: APIRoute = (context) => handle(async () => ok(await createDocument(requireCtx(context), (await readJson(context.request)) as never), 201));
