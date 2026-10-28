/**
 * Registers the production webhook and the command menu (PRD section 6, skill telegram-bot-integration section 3).
 * Run once per deploy on the server: `pnpm bot:webhook`. Needs APP_URL (https), TELEGRAM_BOT_TOKEN and
 * TELEGRAM_WEBHOOK_SECRET. It never prints the token.
 */
import { ALLOWED_UPDATES } from '../src/integrations/telegram/webhook';
import { requireEnv } from '../src/lib/env';
import { telegramClient } from '../src/server/telegram';

const url = `${requireEnv('APP_URL').replace(/\/$/, '')}/api/telegram/webhook`;
const client = telegramClient();
await client.setWebhook({ url, secretToken: requireEnv('TELEGRAM_WEBHOOK_SECRET'), allowedUpdates: ALLOWED_UPDATES, maxConnections: 10 });
await client.setMyCommands([
  { command: 'status', description: 'Ringkasan hari ini / today in short' },
  { command: 'overdue', description: 'Invoice lewat jatuh tempo / invoices past due' },
  { command: 'tugas', description: 'Tugas saya / my tasks' },
  { command: 'bantuan', description: 'Bantuan / help' },
  { command: 'putus', description: 'Putuskan tautan / unlink' },
]);
const info = await client.getWebhookInfo();
console.log(`Webhook set to ${info.url}. Pending updates: ${info.pending_update_count}.${info.last_error_message ? ` Last error: ${info.last_error_message}` : ''}`);
