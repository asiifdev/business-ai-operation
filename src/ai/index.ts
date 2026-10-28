import { env } from '../lib/env';
import type { AiProvider } from './provider';
import { MetaProvider } from './meta/provider';

let current: AiProvider | undefined;

/**
 * The one provider the app uses (BR-M07-01). Built lazily from the environment so a missing key only fails the AI
 * features, not the whole server. Tests and previews swap it with `setAiProvider(new FakeProvider(...))`.
 */
export function getAiProvider(): AiProvider {
  current ??= MetaProvider.fromEnv({
    MODEL_API_KEY: env('MODEL_API_KEY'),
    MODEL_API_BASE_URL: env('MODEL_API_BASE_URL'),
    AI_DATA_MODE: env('AI_DATA_MODE'),
    AI_CHAT_MODEL: env('AI_CHAT_MODEL'),
  });
  return current;
}

export function setAiProvider(provider: AiProvider | undefined): void {
  current = provider;
}
