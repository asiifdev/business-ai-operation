import { z } from 'zod';
import { optionalText } from '../portfolio/shared';

/** The social networks the profile can hold, in the order they are shown. */
export const SOCIAL_KEYS = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'x'] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

/** An https address, or empty (which clears the field). Plain http and other schemes are refused: they are never a public profile link. */
const httpsUrl = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .refine((v) => {
      if (v === null) return true;
      try {
        const u = new URL(v);
        return u.protocol === 'https:' && u.hostname.includes('.');
      } catch {
        return false;
      }
    })
    .nullable()
    .optional();

const socialsSchema = z
  .object(Object.fromEntries(SOCIAL_KEYS.map((k) => [k, httpsUrl(300)])) as Record<SocialKey, ReturnType<typeof httpsUrl>>)
  .strict()
  .partial();

export const profileSchema = z.object({
  tagline: optionalText(160),
  namePronunciation: optionalText(120),
  description: optionalText(2000),
  industry: optionalText(120),
  website: httpsUrl(300),
  contactEmail: z.string().trim().max(254).transform((v) => (v === '' ? null : v)).pipe(z.string().email().nullable()).optional(),
  contactPhone: optionalText(40),
  address: optionalText(500),
  socials: socialsSchema.optional(),
  targetAudience: optionalText(1000),
  valueProps: optionalText(1000),
});
export type ProfileInput = z.input<typeof profileSchema>;

export const serviceSchema = z.object({
  name: z.string().transform((v) => v.replace(/\s+/g, ' ').trim()).pipe(z.string().min(2).max(120)),
  description: optionalText(600),
});
export type ServiceInput = z.input<typeof serviceSchema>;

export interface ProfileFacts {
  name: string;
  tagline?: string | null;
  description?: string | null;
  industry?: string | null;
  website?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  socials?: Record<string, string>;
  targetAudience?: string | null;
  valueProps?: string | null;
  services?: Array<{ name: string; description: string | null }>;
  /** Names and descriptions of the active products in Portfolio. Never prices. */
  products?: Array<{ name: string; description: string | null }>;
}

const line = (label: string, value: string | null | undefined) => (value && value.trim() ? `${label}: ${value.trim()}` : null);

/**
 * The company profile as plain lines for a model (D-079). Facts only: no instructions, no money. The caller wraps it as
 * untrusted data, because a person typed every word of it. Empty fields are left out so the model never sees "unknown".
 */
export function profileText(f: ProfileFacts): string {
  const socials = Object.entries(f.socials ?? {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join('; ');
  const list = (items: Array<{ name: string; description: string | null }> | undefined) =>
    items?.length ? items.map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ''}`).join('\n') : null;
  const services = list(f.services);
  const products = list(f.products);
  return [
    line('Company', f.name),
    line('Tagline', f.tagline),
    line('About', f.description),
    line('Industry', f.industry),
    line('Target customers', f.targetAudience),
    line('What sets it apart', f.valueProps),
    line('Website', f.website),
    line('Contact email', f.contactEmail),
    line('Contact phone', f.contactPhone),
    line('Address', f.address),
    line('Social media', socials),
    services ? `Services:\n${services}` : null,
    products ? `Products:\n${products}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
