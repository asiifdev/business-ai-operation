import { env } from '../../lib/env';
import { DEFAULT_DAILY_IMAGE_QUOTA } from './rules';

/** The server-wide daily image limit: `MARKETING_DAILY_IMAGE_QUOTA`, else the built-in default. An organization's own setting wins (D-088). */
export function serverDailyImageQuota(): number {
  const n = Number(env('MARKETING_DAILY_IMAGE_QUOTA'));
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_IMAGE_QUOTA;
}

/** The limit that applies to one organization: its own value, or the server default when it never set one. */
export function effectiveDailyImageQuota(own: number | null | undefined): number {
  return own ?? serverDailyImageQuota();
}
