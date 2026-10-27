import type { Locale } from '../../config/site';

export type { Locale };

export interface Section {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface Faq {
  q: string;
  a: string;
}

/** Content of one public page in one language. Facts that change are rendered as text (BR-M16-20). */
export interface PageContent {
  title: string;
  description: string;
  h1: string;
  /** Direct answer to the page's main question, 40-60 words (BR-M16-19). */
  answer: string;
  sections?: Section[];
  faq?: Faq[];
  /** ISO date of the last real content change (shown on the page, used as sitemap lastmod). */
  updated: string;
  home?: {
    /** Part of the h1 shown with the brand gradient. Must be a substring of h1. */
    h1Accent: string;
    howHeading: string;
    howIntro: string;
    stages: { title: string; body: string }[];
    ctaPrimary: string;
    ctaSecondary: string;
    closing: string;
    /** Honest one-line note under the call to action. */
    note: string;
    controlsHeading: string;
    controls: { title: string; body: string; status: 'available' | 'in_development' }[];
  };
}

/** Every public page, in navigation order. `parent` drives breadcrumbs. */
export const PAGE_SLUGS = [
  '',
  'product',
  'product/action-center',
  'product/billing',
  'product/meetings',
  'product/telegram',
  'product/marketing-studio',
  'how-it-works',
  'security',
  'pricing',
  'compare',
  'faq',
  'about',
  'contact',
  'changelog',
  'privacy',
  'terms',
] as const;
export type PageSlug = (typeof PAGE_SLUGS)[number];

export const parentOf = (slug: string): string | null => (slug.startsWith('product/') ? 'product' : slug === '' ? null : '');
