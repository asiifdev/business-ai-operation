import { defineConfig } from 'vitest/config';
import { TEST_APP_URL, TEST_AUTH_SECRET, TEST_CONNECTIONS_KEY, TEST_URL } from './tests/test-env.ts';

export default defineConfig({
  test: {
    globalSetup: ['./tests/global-setup.ts'],
    // Application code reads these; tests always talk to the throwaway database, never the dev one.
    env: {
      DATABASE_URL: TEST_URL,
      DATABASE_URL_TEST: TEST_URL,
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      BETTER_AUTH_URL: 'http://localhost:4321',
      CONNECTIONS_KEY: TEST_CONNECTIONS_KEY,
      ...(TEST_APP_URL ? { APP_URL: TEST_APP_URL } : {}),
    },
  },
});
