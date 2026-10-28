import { askAssistant } from '../ai/assistant';
import { db } from '../db/client';
import type { BotDeps } from '../domain/telegram/bot';
import { TelegramClient } from '../integrations/telegram/client';
import { env } from '../lib/env';
import { type Clock, systemClock } from '../lib/clock';
import { translate } from '../lib/i18n';

const globalForBot = globalThis as unknown as { __telegram?: TelegramClient; __botUsername?: Promise<string> };

/** Whether the bot is configured on this server. Without a token every Telegram feature stays off, quietly. */
export const telegramEnabled = (): boolean => Boolean(env('TELEGRAM_BOT_TOKEN'));

/** One client per process. The token is read here only and never logged (skill section 2). */
export function telegramClient(): TelegramClient {
  globalForBot.__telegram ??= new TelegramClient({ token: env('TELEGRAM_BOT_TOKEN') ?? '' });
  return globalForBot.__telegram;
}

/** The bot's @username for deep links, asked once from `getMe` and remembered. */
export function botUsername(): Promise<string> {
  globalForBot.__botUsername ??= telegramClient()
    .getMe()
    .then((me) => {
      if (!me.username) throw new Error('the bot has no username');
      return me.username;
    })
    .catch((err) => {
      globalForBot.__botUsername = undefined; // ask again next time
      throw err;
    });
  return globalForBot.__botUsername;
}

export const appUrl = (): string | undefined => env('APP_URL')?.replace(/\/$/, '');

/**
 * Everything the bot handler needs, wired to the real services. Free text goes to the same grounded assistant as the
 * web (`/app/asisten`): answers only from the organization's data, refusals and budget limits included (D-038).
 */
export function botDeps(clock: Clock = systemClock): BotDeps {
  return {
    client: telegramClient(),
    clock,
    appUrl: appUrl(),
    ask: async (ctx, question, person) => {
      const reply = await askAssistant(db, ctx, { request: { messages: [{ role: 'user', content: question }] }, organizationName: person.organizationName, locale: person.locale });
      if (reply.ok && reply.text) return reply.text;
      return reply.message ?? translate(person.locale, 'tgAssistantFailed');
    },
  };
}
