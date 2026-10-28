import { askAssistant } from '../ai/assistant';
import { getAiProvider } from '../ai';
import { transcribeOnce } from '../ai/run';
import { toSpokenIndonesian } from '../ai/spoken';
import { getSpeechProvider } from '../integrations/speech';
import { AudioError, toWavSegments } from './audio';
import { db } from '../db/client';
import type { BotDeps } from '../domain/telegram/bot';
import { ChatHistory } from '../domain/telegram/history';
import { TelegramClient } from '../integrations/telegram/client';
import { env } from '../lib/env';
import { type Clock, systemClock } from '../lib/clock';
import { translate } from '../lib/i18n';

const globalForBot = globalThis as unknown as { __telegram?: TelegramClient; __botUsername?: Promise<string>; __chatHistory?: ChatHistory };

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
    speak: async (text, locale, ctx, person) => {
      const engine = getSpeechProvider();
      if (!engine) return null;
      // English goes to the English voice as written; Indonesian first gets its English words and names respelled for the ear.
      const words = locale === 'id' ? await toSpokenIndonesian({ db, ctx, text, organizationName: person.organizationName }) : text;
      return engine.synthesize(words, locale);
    },
    transcribe: async (ctx, audio, person) => {
      try {
        const [segment] = await toWavSegments(audio, { maxDurationMs: 4 * 60_000 });
        const out = await transcribeOnce({ db, ctx, provider: getAiProvider(), locale: person.locale, request: { wav: segment.wav, mode: 'PUSH_TO_TALK', languageBias: ['Indonesian', 'English'] }, inputSummary: 'Voice note Telegram (percakapan)' });
        return out.ok ? { ok: true, text: out.value.transcript } : { ok: false, message: out.message };
      } catch (err) {
        if (err instanceof AudioError) return { ok: false, message: translate(person.locale, err.kind === 'ffmpeg_missing' ? 'mtErrFfmpeg' : 'mtErrUnreadable') };
        throw err;
      }
    },
    ask: async (ctx, question, person, opts) => {
      globalForBot.__chatHistory ??= new ChatHistory(clock);
      const history = globalForBot.__chatHistory;
      const before = history.recent(person.userId);
      const reply = await askAssistant(db, ctx, { request: { messages: [...before, { role: 'user', content: question }] }, organizationName: person.organizationName, locale: person.locale, channel: opts?.spoken ? 'voice' : 'text' });
      if (reply.ok && reply.text) {
        history.remember(person.userId, question, reply.text);
        return reply.text;
      }
      return reply.message ?? translate(person.locale, 'tgAssistantFailed');
    },
  };
}
