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
  // D-082: how much the assistant may do by itself.
  'org.ai_autonomy.update': OWNER,
  // Company profile (D-079): everyone reads it, Owner and Admin edit it.
  'org.profile.read': ALL,
  'org.profile.update': MANAGERS,
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
  'marketing.brand_kit': MANAGERS,
  'marketing.delete_any': MANAGERS,
  'dashboard.read_nonfinancial': ALL,
  'dashboard.read_financial': MANAGERS,
  'audit.read': MANAGERS,
  'audit.read_financial': OWNER,
  // AI assistant (M07): everyone may ask; usage, budgets and the full run log are for managers (BRD-M07 §2)
  'assistant.use': ALL,
  'ai.usage.read': MANAGERS,
  'ai.run.read_own': ALL,
  'ai.run.read_any': MANAGERS,
  // Connections and deployment operations (M17, D-054): the owner holds the secrets, managers run and approve
  'connection.read': ALL,
  'connection.write': OWNER,
  'setup.read': ALL,
  'setup.write': MANAGERS,
  'setup.run': MANAGERS,
  // Deploy flows (M17, D-061): managers draw and run them; only the Owner may save one with a free command node (BR-M17-18)
  'flow.read': ALL,
  'flow.write': MANAGERS,
  'flow.command': OWNER,
  // Telegram
  'telegram.link_self': ALL,
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;

export const can = (role: Role, action: Action): boolean => (PERMISSIONS[action] as readonly Role[]).includes(role);

export function assertCan(ctx: { role: Role }, action: Action): void {
  if (!can(ctx.role, action)) throw new DomainError('forbidden', `${ctx.role} may not ${action}`);
}
