/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    /** The signed-in user, or null. Set by src/middleware.ts from the Better Auth session. */
    user: {
      id: string;
      name: string;
      email: string;
      role: import('./domain/permissions').Role;
      orgId: string;
      locale: 'id' | 'en';
      mustChangePassword: boolean;
    } | null;
    /** Service context for this request (org, actor, role). Null when signed out. */
    ctx: import('./domain/ctx').Ctx | null;
    /** The language this request is rendered in (cookie, profile, browser). */
    locale: 'id' | 'en';
    /** Name of the signed-in user's organization (for the app header). */
    organizationName: string | null;
    /** The organization's IANA time zone, for dates shown to the person. */
    timezone: string;
  }
}
