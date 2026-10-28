import type { Role } from '../domain/permissions';
import type { MessageKey } from './i18n';

export type NavId = 'dashboard' | 'clients' | 'products' | 'assistant' | 'ai';
export type IconName = 'home' | 'clients' | 'products' | 'assistant' | 'usage' | 'more' | 'signout' | 'close';

export interface NavItem {
  id: NavId;
  href: string;
  label: MessageKey;
  icon: IconName;
  /** Roles that see the item. Leave out to show it to everyone. */
  roles?: readonly Role[];
}

/**
 * Every destination of the signed-in app, in sidebar order. A new module adds one line here and appears in the sidebar
 * and, among the first four, in the phone tab bar. The rest go behind "More" on a phone.
 */
export const NAV: readonly NavItem[] = [
  { id: 'dashboard', href: '/app', label: 'navDashboard', icon: 'home' },
  { id: 'clients', href: '/app/klien', label: 'navClients', icon: 'clients' },
  { id: 'products', href: '/app/produk', label: 'navProducts', icon: 'products' },
  { id: 'assistant', href: '/app/asisten', label: 'navAssistant', icon: 'assistant' },
  { id: 'ai', href: '/app/ai', label: 'navAi', icon: 'usage' },
];

export const itemsFor = (role: Role): NavItem[] => NAV.filter((item) => !item.roles || item.roles.includes(role));

/** Phone tab bar: at most four destinations plus the More button, so tabs stay big enough to tap. */
export const TAB_LIMIT = 4;
