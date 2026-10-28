import type { APIRoute } from 'astro';
import { DomainError } from '../../../domain/errors';
import { createPairingCode, getTelegramStatus, unlinkTelegram } from '../../../domain/telegram/links';
import { handle, ok, rateLimit, requireCtx } from '../../../lib/api';
import { botUsername, telegramEnabled } from '../../../server/telegram';

export const prerender = false;

/** `GET /api/telegram/link`: whether this person's Telegram is linked, and whether the bot is set up on this server. */
export const GET: APIRoute = (context) => handle(async () => ok({ enabled: telegramEnabled(), ...(await getTelegramStatus(requireCtx(context))) }));

/** `POST`: a fresh one-time code and deep link, valid 10 minutes. A few per person per ten minutes. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'telegram-code', 5, 10 * 60_000);
    if (limited) return limited;
    if (!telegramEnabled()) throw new DomainError('invalid_state', 'telegram is not configured');
    return ok(await createPairingCode(ctx, await botUsername()), 201);
  });

/** `DELETE`: ends the link from the web. */
export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await unlinkTelegram(requireCtx(context));
    return ok({ linked: false });
  });
