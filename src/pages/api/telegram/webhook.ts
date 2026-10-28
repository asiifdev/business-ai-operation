import type { APIRoute } from 'astro';
import { handleUpdate } from '../../../domain/telegram/bot';
import { SECRET_HEADER, updateSchema, verifyWebhookSecret } from '../../../integrations/telegram/webhook';
import { json } from '../../../lib/api';
import { env } from '../../../lib/env';
import { botDeps, telegramEnabled } from '../../../server/telegram';

export const prerender = false;

/**
 * `POST /api/telegram/webhook` (PRD section 6). Without the right secret header: 401 and nothing is read. With it, the
 * update is accepted at once with 200 and handled after the response, so a slow model call never makes Telegram resend;
 * a resend is harmless anyway, because each `update_id` is handled once. An update we cannot read is acknowledged and
 * dropped, so Telegram does not retry it forever.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!verifyWebhookSecret(request.headers.get(SECRET_HEADER), env('TELEGRAM_WEBHOOK_SECRET'))) return json({ ok: false }, 401);
  if (!telegramEnabled()) return json({ ok: false }, 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: true });
  }
  const update = updateSchema.safeParse(body);
  if (!update.success) return json({ ok: true });
  void handleUpdate(update.data, botDeps()).catch((err) => console.error('telegram: update failed', err instanceof Error ? err.message : err));
  return json({ ok: true });
};
