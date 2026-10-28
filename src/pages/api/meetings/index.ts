import type { APIRoute } from 'astro';
import { audioProblem, createMeeting, listMeetings } from '../../../domain/meetings/service';
import { MAX_UPLOAD_BYTES } from '../../../domain/meetings/rules';
import { handle, json, ok, rateLimit, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok({ meetings: await listMeetings(requireCtx(context)) }));

const invalid = (fields: string[]) => json({ ok: false, error: { code: 'validation', message: 'Invalid input', fields } }, 400);

/**
 * `POST /api/meetings` (multipart: `title`, `consent`, `file`). The file is checked by its bytes before anything is
 * stored; a bad one answers 400 with the field `file:empty|size|format` so the page can say exactly why (BRD-M09 §10).
 */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'meeting-upload', 10, 60 * 60_000);
    if (limited) return limited;
    const length = Number(context.request.headers.get('content-length') ?? 0);
    if (length > MAX_UPLOAD_BYTES + 1024 * 1024) return invalid(['file:size']);
    let form: FormData;
    try {
      form = await context.request.formData();
    } catch {
      return invalid(['file:empty']);
    }
    const file = form.get('file');
    if (!(file instanceof File)) return invalid(['file:empty']);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const problem = audioProblem(bytes);
    if (problem) return invalid([`file:${problem}`]);
    const created = await createMeeting(ctx, { title: String(form.get('title') ?? ''), consent: (form.get('consent') === 'true') as true }, { bytes, name: file.name }); // the schema refuses anything but true
    return ok(created, 201);
  });
