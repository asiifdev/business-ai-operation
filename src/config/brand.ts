/** Single source for the product identity (D-029, BR-M16-34). Never hardcode the name elsewhere. */
export const brand = {
  name: 'Orbyte',
  tagline: { en: 'AI Business Operating System', id: 'Sistem Operasi Bisnis Berbasis AI' },
  /** Provisional mark until the official logo export is added under public/brand/. */
  logoMark: '/brand/orbyte-mark.svg',
  logoMarkLight: '/brand/orbyte-mark-light.svg',
  themeColor: '#020817',
  /** Public contact address chosen by the owner (D-034). Overridable with SITE_CONTACT_EMAIL. */
  contactEmail: 'orbyte@asiifdev.com',
  /** Who builds the product (facts from the publisher's own website, 2026-10-28). */
  publisher: {
    legalName: 'PT Asiifdev Digital Agency',
    brand: 'ASIIFDEV',
    url: 'https://asiifdev.com',
    founded: '2021',
    locality: 'Boyolali',
    region: 'Central Java',
    country: 'ID',
  },
  repository: 'https://github.com/asiifdev/business-ai-operation',
} as const;
