import type { APIRoute } from 'astro';
import { renderDocumentPdf } from '../../../../domain/documents/document-pdf';
import { handle, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** `GET /api/documents/:id/pdf`: the document as a PDF, built from the stored data. Needs `document.read`. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const { buffer, filename } = await renderDocumentPdf(requireCtx(context), param(context, 'id'));
    return new Response(new Uint8Array(buffer), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'private, no-store' },
    });
  });
