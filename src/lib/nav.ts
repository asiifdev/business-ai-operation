import type { Role } from '../domain/permissions';
import type { MessageKey } from './i18n';

export type NavId = 'dashboard' | 'clients' | 'products' | 'assistant' | 'ai';
export type IconName = 'home' | 'clients' | 'products' | 'assistant' | 'usage' | 'more' | 'signout' | 'close' | 'search' | 'plus' | 'arrow' | 'alert' | 'pulse' | 'check' | 'bell' | 'chevron' | 'sun' | 'moon' | 'language';

/** The sidebar is split into labelled groups so a long list stays scannable as modules arrive. */
/**
 * The invoice, subscription and calendar pages ship with the billing screens (M03). Until then, places that would link to
 * them show plain text, so nobody lands on a missing page. Flip this when `/app/invoice` and `/app/langganan` exist.
 */
export const BILLING_PAGES_READY = false;

export type NavGroup = 'workspace' | 'intelligence';

export interface NavItem {
  id: NavId;
  group: NavGroup;
  href: string;
  label: MessageKey;
  icon: IconName;
  /** Which attention count (from `getAttentionCounts`) shows as a pill beside the item. */
  badge?: 'behind';
  /** Roles that see the item. Leave out to show it to everyone. */
  roles?: readonly Role[];
}

/**
 * Every destination of the signed-in app, in sidebar order. A new module adds one line here and appears in the sidebar
 * and, among the first four, in the phone tab bar. The rest go behind "More" on a phone.
 */
export const NAV: readonly NavItem[] = [
  { id: 'dashboard', group: 'workspace', href: '/app', label: 'navDashboard', icon: 'home' },
  { id: 'clients', group: 'workspace', href: '/app/klien', label: 'navClients', icon: 'clients' },
  { id: 'products', group: 'workspace', href: '/app/produk', label: 'navProducts', icon: 'products', badge: 'behind' },
  { id: 'assistant', group: 'intelligence', href: '/app/asisten', label: 'navAssistant', icon: 'assistant' },
  { id: 'ai', group: 'intelligence', href: '/app/ai', label: 'navAi', icon: 'usage' },
];

export const itemsFor = (role: Role): NavItem[] => NAV.filter((item) => !item.roles || item.roles.includes(role));

/** Phone tab bar: at most four destinations plus the More button, so tabs stay big enough to tap. */
export const TAB_LIMIT = 4;

export const GROUP_LABEL = { workspace: 'navGroupWorkspace', intelligence: 'navGroupIntelligence' } as const satisfies Record<NavGroup, MessageKey>;

/** Items of one role split by group, in sidebar order. Empty groups are dropped. */
export const groupedFor = (role: Role): { group: NavGroup; items: NavItem[] }[] =>
  (['workspace', 'intelligence'] as const).map((group) => ({ group, items: itemsFor(role).filter((i) => i.group === group) })).filter((g) => g.items.length > 0);
