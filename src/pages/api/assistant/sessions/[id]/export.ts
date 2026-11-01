import type { APIRoute } from 'astro';
import { exportSession, type ExportFormat } from '../../../../../domain/assistant/export';
import { DomainError } from '../../../../../domain/errors';
import { handle, param, requireCtx } from '../../../../../lib/api';

export const prerender = false;

const FORMATS: readonly ExportFormat[] = ['md', 'txt', 'json'];

/** `GET ?format=md|txt|json`: one of the person's own conversations as a download. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const format = (new URL(context.request.url).searchParams.get('format') ?? 'md') as ExportFormat;
    if (!FORMATS.includes(format)) throw new DomainError('validation', 'format');
    const file = await exportSession(requireCtx(context), param(context, 'id'), format, context.locals.user?.locale === 'en' ? 'en' : 'id');
    return new Response(file.content, { headers: { 'content-type': file.mime, 'content-disposition': `attachment; filename="${file.filename}"`, 'cache-control': 'no-store' } });
  });
