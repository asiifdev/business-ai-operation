import { DomainError } from './errors';

export type Role = 'owner' | 'admin' | 'staff';
const ALL: Role[] = ['owner', 'admin', 'staff'];
const MANAGERS: Role[] = ['owner', 'admin'];
const OWNER: Role[] = ['owner'];

/**
 * Permission matrix (PRD section 3, BR-M01-04). Enforced in services, never only by hiding buttons.
 * "Partially allowed" cells in the PRD are expressed as separate, narrower actions.
 */
export const PERMISSIONS = {
  // Organization and users
  'org.settings.update': OWNER,
  'ai.budget.update': OWNER,
  'user.read': MANAGERS,
  'user.create': MANAGERS,
  'user.update_role': MANAGERS,
  'user.deactivate': MANAGERS,
  // Catalogue (products, packages, clients, deployments)
  'catalog.read': ALL,
  'catalog.price.read': ALL,
  'catalog.write': MANAGERS,
  'catalog.archive': MANAGERS,
  'client.write': ALL,
  'deployment.write': ALL,
  // Billing
  'billing.read': MANAGERS,
  'billing.write': MANAGERS,
  'approval.finance.decide': MANAGERS,
  // Pipeline, tasks, documents
  'lead.read': ALL,
  'lead.update_assigned': ALL,
  'lead.write': MANAGERS,
  'lead.convert': MANAGERS,
  'task.read': ALL,
  'task.create': ALL,
  'task.update_own': ALL,
  'task.update_any': MANAGERS,
  'document.read': ALL,
  'document.write': MANAGERS,
  'document.finalize': MANAGERS,
  // Action Center, meetings, marketing, dashboard, audit
  'finding.read_nonfinancial': ALL,
  'finding.read_financial': MANAGERS,
  'meeting.upload': ALL,
  'meeting.read_own': ALL,
  'meeting.read_any': MANAGERS,
  'marketing.use': ALL,
  'dashboard.read_nonfinancial': ALL,
  'dashboard.read_financial': MANAGERS,
  'audit.read': MANAGERS,
  'audit.read_financial': OWNER,
  // AI assistant (M07): everyone may ask; usage, budgets and the full run log are for managers (BRD-M07 §2)
  'assistant.use': ALL,
  'ai.usage.read': MANAGERS,
  'ai.run.read_own': ALL,
  'ai.run.read_any': MANAGERS,
  // Telegram
  'telegram.link_self': ALL,
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;

export const can = (role: Role, action: Action): boolean => (PERMISSIONS[action] as readonly Role[]).includes(role);

export function assertCan(ctx: { role: Role }, action: Action): void {
  if (!can(ctx.role, action)) throw new DomainError('forbidden', `${ctx.role} may not ${action}`);
}
