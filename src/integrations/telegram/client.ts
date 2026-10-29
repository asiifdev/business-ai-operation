import { TelegramError, type TelegramErrorKind } from './errors';
import { MAX_CAPTION, MAX_MESSAGE } from './text';
import { DOWNLOAD_LIMIT } from './webhook';

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
  style?: 'primary' | 'success' | 'danger';
}
export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}

export interface TelegramClientOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
  /** Longest wait for a flood-control retry. Longer waits are handed back to the caller. */
  maxWaitMs?: number;
  timeoutMs?: number;
}

interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
}

/**
 * Thin client for the Bot API methods the bot needs. The token sits in the URL, so it is never put into an error
 * message or log line. 429 waits for `retry_after`; 5xx and network failures back off; 400, 401 and 403 do not retry.
 */
export class TelegramClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private readonly maxWaitMs: number;
  private readonly timeoutMs: number;
  private readonly token: string;

  constructor(options: TelegramClientOptions) {
    if (!options.token) throw new TelegramError('config', 'TELEGRAM_BOT_TOKEN is not set');
    this.token = options.token;
    this.base = (options.baseUrl ?? 'https://api.telegram.org').replace(/\/$/, '');
    this.doFetch = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.maxAttempts = options.maxAttempts ?? 4;
    this.maxWaitMs = options.maxWaitMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  getMe() {
    return this.call<{ id: number; username?: string; can_read_all_group_messages?: boolean }>('getMe');
  }

  async sendMessage(input: { chatId: number; text: string; parseMode?: 'HTML'; replyMarkup?: InlineKeyboard; silent?: boolean; disablePreview?: boolean }) {
    assertText(input.text, MAX_MESSAGE + 96);
    if (input.replyMarkup) assertKeyboard(input.replyMarkup);
    return this.call<{ message_id: number }>('sendMessage', {
      chat_id: input.chatId,
      text: input.text,
      parse_mode: input.parseMode,
      reply_markup: input.replyMarkup,
      disable_notification: input.silent,
      link_preview_options: input.disablePreview ? { is_disabled: true } : undefined,
    });
  }

  /** Replaces a card in place (for example swaps the buttons for the result). */
  async editMessageText(input: { chatId: number; messageId: number; text: string; parseMode?: 'HTML'; replyMarkup?: InlineKeyboard }) {
    assertText(input.text, MAX_MESSAGE + 96);
    if (input.replyMarkup) assertKeyboard(input.replyMarkup);
    return this.call<unknown>('editMessageText', {
      chat_id: input.chatId,
      message_id: input.messageId,
      text: input.text,
      parse_mode: input.parseMode,
      reply_markup: input.replyMarkup ?? { inline_keyboard: [] },
    });
  }

  /** Every callback query must be answered, even with no text, or the client keeps showing a spinner. */
  async answerCallbackQuery(input: { id: string; text?: string; showAlert?: boolean }) {
    if (input.text && input.text.length > 200) throw new TelegramError('bad_request', 'Callback answer text is limited to 200 characters');
    return this.call<true>('answerCallbackQuery', { callback_query_id: input.id, text: input.text, show_alert: input.showAlert });
  }

  sendChatAction(chatId: number, action: 'typing' | 'upload_photo' | 'upload_document' | 'record_voice') {
    return this.call<true>('sendChatAction', { chat_id: chatId, action });
  }

  async sendDocument(input: { chatId: number; bytes: Uint8Array; filename: string; mime: string; caption?: string }) {
    if (input.caption && input.caption.length > MAX_CAPTION + 24) throw new TelegramError('bad_request', 'Caption is limited to 1024 characters');
    const form = new FormData();
    form.append('chat_id', String(input.chatId));
    if (input.caption) form.append('caption', input.caption);
    form.append('document', new Blob([input.bytes as BlobPart], { type: input.mime }), input.filename);
    return this.call<{ message_id: number }>('sendDocument', undefined, form);
  }

  /** A picture shown inline. Telegram takes JPEG or PNG here, so callers send a JPEG. */
  async sendPhoto(input: { chatId: number; bytes: Uint8Array; filename: string; caption?: string; parseMode?: 'HTML' }) {
    if (input.caption && input.caption.length > MAX_CAPTION + 24) throw new TelegramError('bad_request', 'Caption is limited to 1024 characters');
    const form = new FormData();
    form.append('chat_id', String(input.chatId));
    if (input.caption) form.append('caption', input.caption);
    if (input.parseMode) form.append('parse_mode', input.parseMode);
    form.append('photo', new Blob([input.bytes as BlobPart], { type: 'image/jpeg' }), input.filename);
    return this.call<{ message_id: number }>('sendPhoto', undefined, form);
  }

  /** A voice note: OGG/Opus bytes, shown with a play button. */
  async sendVoice(input: { chatId: number; bytes: Uint8Array; durationSeconds?: number }) {
    const form = new FormData();
    form.append('chat_id', String(input.chatId));
    if (input.durationSeconds) form.append('duration', String(Math.max(1, Math.round(input.durationSeconds))));
    form.append('voice', new Blob([input.bytes as BlobPart], { type: 'audio/ogg' }), 'reply.ogg');
    return this.call<{ message_id: number }>('sendVoice', undefined, form);
  }

  getFile(fileId: string) {
    return this.call<TelegramFile>('getFile', { file_id: fileId });
  }

  /**
   * Downloads a file the user sent. Bots may fetch up to 20 MB, so a larger file is refused before any bytes move, and
   * the size is checked again on what arrived. The download URL contains the token and is never exposed.
   */
  async downloadFile(fileId: string, maxBytes = DOWNLOAD_LIMIT): Promise<Uint8Array> {
    const file = await this.getFile(fileId);
    if (!file.file_path) throw new TelegramError('not_found', 'Telegram returned no path for this file');
    if ((file.file_size ?? 0) > maxBytes) throw new TelegramError('too_large', 'File is larger than the download limit');
    const response = await this.fetchWithTimeout(`${this.base}/file/bot${this.token}/${file.file_path}`, { method: 'GET' });
    if (!response.ok) throw new TelegramError(response.status === 404 ? 'not_found' : 'unavailable', `File download failed (${response.status})`, { status: response.status });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new TelegramError('too_large', 'File is larger than the download limit');
    return bytes;
  }

  async setWebhook(input: { url: string; secretToken: string; allowedUpdates: readonly string[]; maxConnections?: number; dropPendingUpdates?: boolean }) {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(input.secretToken)) throw new TelegramError('config', 'Webhook secret must be 1 to 256 characters of A-Z a-z 0-9 _ -');
    if (!input.url.startsWith('https://')) throw new TelegramError('config', 'Webhook url must start with https://');
    return this.call<true>('setWebhook', {
      url: input.url,
      secret_token: input.secretToken,
      allowed_updates: input.allowedUpdates,
      max_connections: input.maxConnections,
      drop_pending_updates: input.dropPendingUpdates,
    });
  }

  deleteWebhook(dropPendingUpdates = false) {
    return this.call<true>('deleteWebhook', { drop_pending_updates: dropPendingUpdates });
  }

  getWebhookInfo() {
    return this.call<WebhookInfo>('getWebhookInfo');
  }

  /** Long polling for local development. Only one process may poll, and it only works while no webhook is set. */
  getUpdates(input: { offset?: number; timeout?: number; allowedUpdates?: readonly string[] }) {
    return this.call<unknown[]>('getUpdates', { offset: input.offset, timeout: input.timeout ?? 30, allowed_updates: input.allowedUpdates });
  }

  async setMyCommands(commands: Array<{ command: string; description: string }>) {
    for (const c of commands) {
      if (!/^[a-z0-9_]{1,32}$/.test(c.command)) throw new TelegramError('config', `Command "${c.command}" must be 1 to 32 lowercase letters, digits or underscores`);
      if (c.description.length < 1 || c.description.length > 256) throw new TelegramError('config', `Command "${c.command}" needs a description of 1 to 256 characters`);
    }
    return this.call<true>('setMyCommands', { commands });
  }

  private async call<T>(method: string, params?: Record<string, unknown>, form?: FormData): Promise<T> {
    const url = `${this.base}/bot${this.token}/${method}`;
    let last: TelegramError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchWithTimeout(url, form ? { method: 'POST', body: form } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stripUndefined(params ?? {})) });
      } catch (cause) {
        if (cause instanceof TelegramError) throw cause;
        last = new TelegramError('unavailable', `Could not reach Telegram (${method})`);
        if (attempt === this.maxAttempts) throw last;
        await this.sleep(this.backoff(attempt, 0));
        continue;
      }

      let body: ApiResponse<T> | undefined;
      try {
        body = (await response.json()) as ApiResponse<T>;
      } catch {
        body = undefined;
      }
      if (response.ok && body?.ok && body.result !== undefined) return body.result;

      const status = body?.error_code ?? response.status;
      const retryAfterMs = body?.parameters?.retry_after ? body.parameters.retry_after * 1000 : undefined;
      last = new TelegramError(kindFor(status), `Telegram ${method} failed (${status}): ${body?.description ?? 'no description'}`.slice(0, 300), { status, retryAfterMs });
      const retryable = status === 429 || status >= 500;
      if (!retryable || attempt === this.maxAttempts) throw last;
      if ((retryAfterMs ?? 0) > this.maxWaitMs) throw last;
      await this.sleep(this.backoff(attempt, retryAfterMs ?? 0));
    }
    throw last ?? new TelegramError('unavailable', `Telegram ${method} failed`);
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.doFetch(url, { ...init, signal: controller.signal });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') throw new TelegramError('unavailable', 'Telegram did not answer in time');
      throw cause;
    } finally {
      clearTimeout(timer);
    }
  }

  private backoff(attempt: number, retryAfterMs: number): number {
    return Math.max(retryAfterMs, 500 * 2 ** (attempt - 1) + this.random() * 500);
  }
}

function kindFor(status: number): TelegramErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'blocked';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'bad_request';
}

function stripUndefined(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
}

function assertText(text: string, max: number): void {
  if (text.length === 0) throw new TelegramError('bad_request', 'Message text is empty');
  if (text.length > max) throw new TelegramError('bad_request', 'Message is longer than 4096 characters: split it with chunkText first');
}

function assertKeyboard(markup: InlineKeyboard): void {
  for (const row of markup.inline_keyboard) {
    for (const button of row) {
      const kinds = [button.callback_data, button.url].filter((v) => v !== undefined).length;
      if (kinds !== 1) throw new TelegramError('bad_request', `Button "${button.text}" needs exactly one of callback_data or url`);
      if (button.callback_data !== undefined && (Buffer.byteLength(button.callback_data) < 1 || Buffer.byteLength(button.callback_data) > 64)) {
        throw new TelegramError('bad_request', 'callback_data must be 1 to 64 bytes');
      }
    }
  }
}
