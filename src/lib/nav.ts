import type { Role } from '../domain/permissions';
import type { MessageKey } from './i18n';

export type NavId = 'dashboard' | 'actions' | 'briefing' | 'clients' | 'pipeline' | 'tasks' | 'meetings' | 'documents' | 'marketing' | 'audit' | 'users' | 'orgsettings' | 'connections' | 'flows' | 'runs' | 'products' | 'assistant' | 'invoices' | 'subscriptions' | 'ai' | 'telegram';
export type IconName = 'home' | 'clients' | 'pipeline' | 'products' | 'assistant' | 'usage' | 'more' | 'signout' | 'close' | 'search' | 'plus' | 'arrow' | 'alert' | 'pulse' | 'check' | 'invoice' | 'repeat' | 'bell' | 'chevron' | 'sun' | 'moon' | 'language' | 'briefing' | 'tasks' | 'send' | 'mic' | 'history' | 'copy' | 'edit' | 'trash';

/** The sidebar is split into labelled groups so a long list stays scannable as modules arrive. */
/**
 * The invoice and subscription pages exist (M03), so the dashboard, the bell and the calendar link to them. The flag stays
 * so a place can fall back to plain text if a billing page is ever taken out again.
 */
export const BILLING_PAGES_READY = true;

export type NavGroup = 'workspace' | 'billing' | 'intelligence';

export interface NavItem {
  id: NavId;
  group: NavGroup;
  href: string;
  label: MessageKey;
  icon: IconName;
  /** Which attention count (from `getAttentionCounts`) shows as a pill beside the item. */
  badge?: 'behind' | 'findings';
  /** Roles that see the item. Leave out to show it to everyone. */
  roles?: readonly Role[];
}

/**
 * Every destination of the signed-in app. The sidebar shows them by group, in this order within each group; the first
 * four overall form the phone tab bar (dashboard, Action Center, clients, assistant) and the rest go behind "More".
 */
export const NAV: readonly NavItem[] = [
  { id: 'dashboard', group: 'workspace', href: '/app', label: 'navDashboard', icon: 'home' },
  { id: 'actions', group: 'workspace', href: '/app/action-center', label: 'navActionCenter', icon: 'pulse', badge: 'findings' },
  { id: 'clients', group: 'workspace', href: '/app/klien', label: 'navClients', icon: 'clients' },
  { id: 'assistant', group: 'intelligence', href: '/app/asisten', label: 'navAssistant', icon: 'assistant' },
  { id: 'products', group: 'workspace', href: '/app/produk', label: 'navProducts', icon: 'products', badge: 'behind' },
  { id: 'pipeline', group: 'workspace', href: '/app/pipeline', label: 'navPipeline', icon: 'pipeline' },
  { id: 'tasks', group: 'workspace', href: '/app/task', label: 'navTasks', icon: 'tasks' },
  { id: 'meetings', group: 'workspace', href: '/app/rapat', label: 'navMeetings', icon: 'mic' },
  { id: 'documents', group: 'workspace', href: '/app/dokumen', label: 'navDocuments', icon: 'briefing' },
  { id: 'marketing', group: 'workspace', href: '/app/marketing', label: 'navMarketing', icon: 'sun' },
  { id: 'briefing', group: 'intelligence', href: '/app/briefing', label: 'navBriefing', icon: 'briefing', roles: ['owner', 'admin'] },
  { id: 'invoices', group: 'billing', href: '/app/invoice', label: 'navInvoices', icon: 'invoice', roles: ['owner', 'admin'] },
  { id: 'subscriptions', group: 'billing', href: '/app/langganan', label: 'navSubscriptions', icon: 'repeat', roles: ['owner', 'admin'] },
  { id: 'ai', group: 'intelligence', href: '/app/ai', label: 'navAi', icon: 'usage' },
  { id: 'telegram', group: 'intelligence', href: '/app/settings/telegram', label: 'navTelegram', icon: 'send' },
  { id: 'audit', group: 'intelligence', href: '/app/audit', label: 'navAudit', icon: 'check', roles: ['owner', 'admin'] },
  { id: 'users', group: 'intelligence', href: '/app/settings/pengguna', label: 'navUsers', icon: 'clients', roles: ['owner', 'admin'] },
  { id: 'orgsettings', group: 'intelligence', href: '/app/settings/organisasi', label: 'navOrgSettings', icon: 'home', roles: ['owner'] },
  { id: 'connections', group: 'intelligence', href: '/app/koneksi', label: 'navConnections', icon: 'pulse' },
  { id: 'flows', group: 'intelligence', href: '/app/flow', label: 'navFlows', icon: 'pipeline' },
  { id: 'runs', group: 'intelligence', href: '/app/setup', label: 'navRuns', icon: 'repeat' },
];

export const itemsFor = (role: Role): NavItem[] => NAV.filter((item) => !item.roles || item.roles.includes(role));

/** Phone tab bar: at most four destinations plus the More button, so tabs stay big enough to tap. */
export const TAB_LIMIT = 4;

export const GROUP_LABEL = { workspace: 'navGroupWorkspace', billing: 'navGroupBilling', intelligence: 'navGroupIntelligence' } as const satisfies Record<NavGroup, MessageKey>;

/** Items of one role split by group, in sidebar order. Empty groups are dropped. */
export const groupedFor = (role: Role): { group: NavGroup; items: NavItem[] }[] =>
  (['workspace', 'billing', 'intelligence'] as const).map((group) => ({ group, items: itemsFor(role).filter((i) => i.group === group) })).filter((g) => g.items.length > 0);
