/**
 * Local development without a public HTTPS address: long polling (skill telegram-bot-integration section 3).
 * `pnpm bot:dev`. WARNING: it removes the webhook, so the live server stops receiving updates until `pnpm bot:webhook`
 * runs there again. Only one process may poll at a time. Ctrl+C to stop.
 */
import { handleUpdate } from '../src/domain/telegram/bot';
import { ALLOWED_UPDATES, updateSchema } from '../src/integrations/telegram/webhook';
import { botDeps, telegramClient } from '../src/server/telegram';

if (process.env.NODE_ENV === 'production') {
  console.error('bot:dev refuses to run with NODE_ENV=production: production uses the webhook.');
  process.exit(1);
}

const client = telegramClient();
await client.deleteWebhook();
console.log('Webhook removed; polling for updates. Ctrl+C to stop.');
let offset: number | undefined;
for (;;) {
  try {
    const updates = await client.getUpdates({ offset, timeout: 30, allowedUpdates: ALLOWED_UPDATES });
    for (const raw of updates) {
      const parsed = updateSchema.safeParse(raw);
      const id = (raw as { update_id?: number }).update_id;
      if (typeof id === 'number') offset = id + 1;
      if (!parsed.success) continue;
      await handleUpdate(parsed.data, botDeps()).catch((err) => console.error('update failed', err instanceof Error ? err.message : err));
    }
  } catch (err) {
    console.error('polling failed, retrying in 5 s', err instanceof Error ? err.message : err);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
