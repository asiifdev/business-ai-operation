/**
 * `pnpm connections:rotate`: re-seals every connection secret under the current `CONNECTIONS_KEY` (see the notes in
 * `src/domain/connections/vault.ts`). Run it after setting the new key and keeping each old one as `CONNECTIONS_KEY_V<n>`.
 */
import { rotateConnectionSecrets } from '../src/domain/connections/service';
import { pg } from '../src/db/client';

try {
  const { rotated, skipped } = await rotateConnectionSecrets();
  console.log(`Re-sealed ${rotated} secret(s); ${skipped} already on the current key or without a secret.`);
} finally {
  await pg.end();
}
