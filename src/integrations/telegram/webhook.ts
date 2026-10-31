import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Checks the `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET` in constant time. A missing
 * header or an unset secret both fail: an unconfigured server must reject everything (BRD-M11).
 */
export function verifyWebhookSecret(header: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const user = z.object({ id: z.number(), is_bot: z.boolean().optional(), first_name: z.string().optional(), language_code: z.string().optional(), username: z.string().optional() });
const chat = z.object({ id: z.number(), type: z.string() });

const message = z.object({
  message_id: z.number(),
  from: user.optional(),
  chat,
  date: z.number(),
  text: z.string().optional(),
  caption: z.string().optional(),
  media_group_id: z.string().optional(),
  voice: z.object({ file_id: z.string(), duration: z.number(), mime_type: z.string().optional(), file_size: z.number().optional() }).optional(),
  audio: z.object({ file_id: z.string(), duration: z.number(), mime_type: z.string().optional(), file_size: z.number().optional() }).optional(),
  photo: z.array(z.object({ file_id: z.string(), width: z.number(), height: z.number(), file_size: z.number().optional() })).optional(),
  document: z.object({ file_id: z.string(), file_name: z.string().optional(), mime_type: z.string().optional(), file_size: z.number().optional() }).optional(),
  video: z.object({ file_id: z.string(), duration: z.number().optional(), file_name: z.string().optional(), mime_type: z.string().optional(), file_size: z.number().optional() }).optional(),
  video_note: z.object({ file_id: z.string(), duration: z.number().optional(), file_size: z.number().optional() }).optional(),
});

const callbackQuery = z.object({
  id: z.string(),
  from: user,
  data: z.string().optional(),
  message: z.object({ message_id: z.number(), chat }).optional(),
});

const myChatMember = z.object({
  chat,
  from: user,
  date: z.number(),
  new_chat_member: z.object({ status: z.string() }),
});

/** Only the update kinds we subscribe to (`allowed_updates`). Everything else parses with all three fields absent. */
export const updateSchema = z.object({
  update_id: z.number(),
  message: message.optional(),
  callback_query: callbackQuery.optional(),
  my_chat_member: myChatMember.optional(),
});

export type TelegramUpdate = z.infer<typeof updateSchema>;
export type TelegramMessage = z.infer<typeof message>;

export const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'] as const;

/** The largest photo that the bot may download (20 MB limit), or null when none fits. */
export function pickPhoto(photo: TelegramMessage['photo']): { file_id: string; width: number; height: number; file_size?: number } | null {
  const fits = (photo ?? []).filter((p) => (p.file_size ?? 0) <= DOWNLOAD_LIMIT);
  return fits.length ? fits.reduce((best, p) => (p.width * p.height > best.width * best.height ? p : best)) : null;
}

export const DOWNLOAD_LIMIT = 20 * 1024 * 1024;
