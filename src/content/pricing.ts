/**
 * Planned plans (D-033) and the market research behind them (BRD-M16 Appendix A).
 * Plans are PLANNED: platform billing is not live, so no Offer markup and no checkout (BR-M16-26).
 */
export const pricingAsOf = '2026-10-28';

export interface Plan {
  id: 'starter' | 'team' | 'business' | 'enterprise';
  name: string;
  usdAnnual: number | null;
  usdMonthly: number | null;
  idrAnnual: number | null;
  minUsers: number | null;
  audience: { en: string; id: string };
  limits: { en: string[]; id: string[] };
}

export const plans: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    usdAnnual: 0,
    usdMonthly: 0,
    idrAnnual: 0,
    minUsers: null,
    audience: { en: 'Small teams trying it out', id: 'Tim kecil yang mencoba' },
    limits: {
      en: ['Up to 3 users', 'Up to 5 active clients', 'Small daily AI budget', 'No Marketing Studio'],
      id: ['Hingga 3 pengguna', 'Hingga 5 klien aktif', 'Anggaran AI harian kecil', 'Tanpa Marketing Studio'],
    },
  },
  {
    id: 'team',
    name: 'Team',
    usdAnnual: 15,
    usdMonthly: 19,
    idrAnnual: 149000,
    minUsers: 3,
    audience: { en: 'Agencies of about 3 to 15 people', id: 'Agensi sekitar 3 sampai 15 orang' },
    limits: {
      en: ['Minimum 3 users', 'Unlimited clients', 'Invoices, subscriptions, Action Center, Telegram', 'Meeting transcription with a monthly hour quota'],
      id: ['Minimal 3 pengguna', 'Klien tidak terbatas', 'Invoice, langganan, Action Center, Telegram', 'Transkripsi rapat dengan kuota jam bulanan'],
    },
  },
  {
    id: 'business',
    name: 'Business',
    usdAnnual: 29,
    usdMonthly: 35,
    idrAnnual: 289000,
    minUsers: 5,
    audience: { en: 'Agencies of about 10 to 50 people', id: 'Agensi sekitar 10 sampai 50 orang' },
    limits: {
      en: ['Minimum 5 users', 'Larger AI budget and transcription quota', 'Marketing Studio', 'Priority support'],
      id: ['Minimal 5 pengguna', 'Anggaran AI dan kuota transkripsi lebih besar', 'Marketing Studio', 'Dukungan prioritas'],
    },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    usdAnnual: null,
    usdMonthly: null,
    idrAnnual: null,
    minUsers: null,
    audience: { en: 'Custom needs', id: 'Kebutuhan khusus' },
    limits: { en: ['Terms agreed individually'], id: ['Syarat disepakati secara khusus'] },
  },
];

/** Public price pages read on 2026-10-28. Third-party blog roundups were rejected: they contradicted each other. */
export interface Competitor {
  vendor: string;
  source: string;
  summary: { en: string; id: string };
  note?: { en: string; id: string };
}

export const competitors: Competitor[] = [
  {
    vendor: 'Teamwork',
    source: 'https://www.teamwork.com/pricing/',
    summary: {
      en: 'Free for up to 5 users; Basics $9.99 per user per month (minimum 3); Accelerate $24.99 (minimum 5, invoices from logged time). Annual billing prices.',
      id: 'Gratis hingga 5 pengguna; Basics $9,99 per pengguna per bulan (minimal 3); Accelerate $24,99 (minimal 5, invoice dari waktu tercatat). Harga tagihan tahunan.',
    },
  },
  {
    vendor: 'Productive',
    source: 'https://productive.io/pricing/',
    summary: {
      en: 'Essential about $10, Professional $25 billed annually or $29 monthly per user per month; Ultimate on request.',
      id: 'Essential sekitar $10, Professional $25 (tahunan) atau $29 (bulanan) per pengguna per bulan; Ultimate atas permintaan.',
    },
    note: {
      en: 'The vendor page shows inconsistent figures for some plans; values here follow the comparison table.',
      id: 'Halaman vendor menampilkan angka yang tidak konsisten untuk beberapa paket; nilai di sini mengikuti tabel perbandingan.',
    },
  },
  {
    vendor: 'Bonsai',
    source: 'https://www.hellobonsai.com/pricing',
    summary: {
      en: 'Basic $9, Essentials $19 (invoices, proposals, client portal), Premium $29, Elite $49 per user per month billed annually; $15 to $59 billed monthly.',
      id: 'Basic $9, Essentials $19 (invoice, proposal, portal klien), Premium $29, Elite $49 per pengguna per bulan tagihan tahunan; $15 sampai $59 bila bulanan.',
    },
  },
  {
    vendor: 'Scoro',
    source: 'https://www.scoro.com/pricing/',
    summary: {
      en: 'Time-billing about $17, Quote to Cash about $29, End-to-end about $57 per user per month; minimum 5 users; annual billing gives a 13 to 17 percent discount.',
      id: 'Time-billing sekitar $17, Quote to Cash sekitar $29, End-to-end sekitar $57 per pengguna per bulan; minimal 5 pengguna; tagihan tahunan diskon 13 sampai 17 persen.',
    },
  },
];

export const formatUsd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
export const formatIdr = (n: number) => `Rp ${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
