import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/auth/auth';
import { pg } from '../../src/db/client';
import { storageItems } from '../../src/content/data-practices';
import { registerOrganization } from '../../src/domain/org/service';

afterAll(async () => {
  await pg.end();
});

describe('cookies set by sign-in', () => {
  it('are all listed in the privacy registry (BR-M16-32)', async () => {
    const email = `cookie-${Date.now()}@example.test`;
    await registerOrganization({ organizationName: 'Cookie Org', name: 'Cookie Owner', email, password: 'correct horse battery' });
    const res = await auth.api.signInEmail({ body: { email, password: 'correct horse battery' }, asResponse: true });
    const names = res.headers.getSetCookie().map((c) => c.split('=')[0].replace(/^__(Secure|Host)-/, ''));
    expect(names.length).toBeGreaterThan(0);
    const listed = new Set(storageItems.filter((s) => s.kind === 'cookie').map((s) => s.name));
    expect(names.filter((n) => !listed.has(n)), 'cookies missing from the privacy registry').toEqual([]);
  });
});
