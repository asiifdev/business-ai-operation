import { env } from './env';

/** The public address of this installation, without a trailing slash. Links in emails and Telegram are built from it. */
export const appUrl = (): string | undefined => env('APP_URL')?.replace(/\/$/, '');
