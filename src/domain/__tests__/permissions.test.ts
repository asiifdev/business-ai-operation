import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { assertCan, can, PERMISSIONS, type Action } from '../permissions';

describe('permission matrix (PRD section 3)', () => {
  const allow = (role: 'owner' | 'admin' | 'staff', action: Action) => can(role, action);

  it('lets only the Owner change organization settings and AI budgets', () => {
    expect(allow('owner', 'org.settings.update')).toBe(true);
    expect(allow('admin', 'org.settings.update')).toBe(false);
    expect(allow('staff', 'ai.budget.update')).toBe(false);
  });

  it('keeps financial approval away from Staff (BRD-M01)', () => {
    expect(allow('owner', 'approval.finance.decide')).toBe(true);
    expect(allow('admin', 'approval.finance.decide')).toBe(true);
    expect(allow('staff', 'approval.finance.decide')).toBe(false);
    expect(allow('staff', 'billing.read')).toBe(false);
    expect(allow('staff', 'finding.read_financial')).toBe(false);
    expect(allow('staff', 'dashboard.read_financial')).toBe(false);
  });

  it('shows Staff the package prices (owner decision) but not the audit trail', () => {
    expect(allow('staff', 'catalog.price.read')).toBe(true);
    expect(allow('staff', 'audit.read')).toBe(false);
    expect(allow('admin', 'audit.read')).toBe(true);
    expect(allow('admin', 'audit.read_financial')).toBe(false);
    expect(allow('owner', 'audit.read_financial')).toBe(true);
  });

  it('lets Staff work on their own tasks and recordings only', () => {
    expect(allow('staff', 'task.create')).toBe(true);
    expect(allow('staff', 'task.update_own')).toBe(true);
    expect(allow('staff', 'task.update_any')).toBe(false);
    expect(allow('staff', 'meeting.read_own')).toBe(true);
    expect(allow('staff', 'meeting.read_any')).toBe(false);
  });

  it('never grants an action to a role that is not listed, and every action has at least one role', () => {
    for (const [action, roles] of Object.entries(PERMISSIONS)) {
      expect(roles.length, action).toBeGreaterThan(0);
      expect(roles.includes('owner'), `${action} should always include owner`).toBe(true);
    }
  });

  it('assertCan throws a forbidden DomainError', () => {
    expect(() => assertCan({ role: 'staff' }, 'user.create')).toThrow(DomainError);
    expect(() => assertCan({ role: 'admin' }, 'user.create')).not.toThrow();
  });
});
