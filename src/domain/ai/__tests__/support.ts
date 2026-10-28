import { randomUUID } from 'node:crypto';
import { fixedClock } from '../../../lib/clock';
import { registerOrganization } from '../../org/service';
import { userCtx, type Ctx } from '../../ctx';
import { createUser } from '../../users/service';

// Test files run in parallel workers, so a clock plus a per-process counter can collide. A random id cannot.
const unique = () => randomUUID().slice(0, 12);

/** A fresh organization with its Owner, plus an Admin and a Staff user, and a clock the test can move. */
export async function makeOrg(startAt = '2026-10-28T03:00:00Z') {
  const n = unique();
  const owner = await registerOrganization({ organizationName: `AI Org ${n}`, name: 'Owner Satu', email: `owner-${n}@example.test`, password: 'correct horse battery', locale: 'id' });
  const clock = fixedClock(startAt);
  const ownerCtx: Ctx = userCtx({ orgId: owner.orgId, userId: owner.userId, role: 'owner' }, clock);
  const staff = await createUser(ownerCtx, { name: 'Staf Satu', email: `staff-${n}@example.test`, role: 'staff', password: 'correct horse battery' });
  const admin = await createUser(ownerCtx, { name: 'Admin Satu', email: `admin-${n}@example.test`, role: 'admin', password: 'correct horse battery' });
  return {
    orgId: owner.orgId,
    clock,
    ownerCtx,
    staffCtx: userCtx({ orgId: owner.orgId, userId: staff.id, role: 'staff' }, clock),
    adminCtx: userCtx({ orgId: owner.orgId, userId: admin.id, role: 'admin' }, clock),
  };
}
