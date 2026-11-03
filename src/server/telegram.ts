import { askAssistant } from '../ai/assistant';
import { addAndReadAttachment, attachmentsForChat, bindAttachments } from '../domain/assistant/attachments';
import { getAiProvider } from '../ai';
import { transcribeOnce } from '../ai/run';
import { toSpokenIndonesian } from '../ai/spoken';
import { getSpeechProvider } from '../integrations/speech';
import { AudioError, toWavSegments } from './audio';
import { db } from '../db/client';
import { appendTurns, telegramConversation } from '../domain/assistant/sessions';
import type { BotDeps } from '../domain/telegram/bot';
import { decidePhotoUse } from '../domain/telegram/photo-intent';
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

/**
 * The bot's @username for deep links. `TELEGRAM_BOT_USERNAME` answers at once with no network call; without it the name is
 * asked once from `getMe` and remembered. That lookup gets ONE quick try (8 seconds): the person is waiting at a button, so
 * "Telegram cannot be reached" must show up in seconds, not after the long retries the sending client uses.
 */
export function botUsername(): Promise<string> {
  const fixed = env('TELEGRAM_BOT_USERNAME')?.trim().replace(/^@/, '');
  if (fixed) return Promise.resolve(fixed);
  globalForBot.__botUsername ??= new TelegramClient({ token: env('TELEGRAM_BOT_TOKEN') ?? '', maxAttempts: 1, timeoutMs: 8_000 })
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
    attach: (ctx, file) => addAndReadAttachment(ctx, { file }, { toWav: toWavSegments }),
    photoUse: (ctx, words, files, person) => decidePhotoUse(ctx, words, files, person.locale),
    ask: async (ctx, question, person, opts) => {
      // The conversation is stored like the web's (D-092), so a restart of the server does not lose it.
      const { sessionId, history } = await telegramConversation(ctx);
      const attachments = sessionId || opts?.attachmentIds?.length ? await attachmentsForChat(ctx, sessionId, opts?.attachmentIds ?? []) : [];
      const reply = await askAssistant(db, ctx, { attachments, request: { messages: [...history, { role: 'user', content: question }] }, organizationName: person.organizationName, locale: person.locale, channel: opts?.spoken ? 'voice' : 'text' });
      const added = attachments.filter((a) => a.isNew).map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
      const stored = await appendTurns(ctx, sessionId, [{ kind: 'user', body: { text: question, ...(added.length ? { attachments: added } : {}) } }, { kind: 'assistant', body: reply }], question, 'telegram');
      await bindAttachments(ctx, added.map((a) => a.id), stored);
      // Pictures made while answering go out as photos after the text (D-080).
      for (const draft of reply.drafts) if (draft.tool === 'make_picture') opts?.onPicture?.(draft.id);
      for (const done of reply.autoRan) if (done.executed) opts?.onAutoRan?.({ id: done.id, summary: done.summary, undoable: done.undoable });
      if (reply.ok && reply.text) return reply.text;
      return reply.message ?? translate(person.locale, 'tgAssistantFailed');
    },
  };
}
