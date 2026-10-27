import type { PageSlug } from './site/types';

/**
 * What the product can honestly claim (BR-M16-02). Each entry points at a row of docs/PLAN.md section 1a;
 * tests/features-vs-plan.test.ts keeps the two in step: available = ✅, in_development = 🚧, planned = ⬜.
 */
export type FeatureStatus = 'available' | 'in_development' | 'planned';

export interface Feature {
  id: string;
  /** First cell of the matching row in docs/PLAN.md section 1a. */
  planRow: string;
  status: FeatureStatus;
  /** Product page that describes it, if any. */
  page?: PageSlug;
  name: { en: string; id: string };
  summary: { en: string; id: string };
}

export const features: Feature[] = [
  {
    id: 'accounts',
    planRow: 'M01 Registrasi dan login',
    status: 'available',
    name: { en: 'Your account and company data', id: 'Akun dan data perusahaan Anda' },
    summary: {
      en: 'Sign up, set up your company and sign in. Each company keeps its own data, never mixed with others.',
      id: 'Daftar, buat perusahaan, lalu masuk. Data tiap perusahaan terpisah dan tidak tercampur.',
    },
  },
  {
    id: 'audit',
    planRow: 'M15 Audit dan guardrail',
    status: 'in_development',
    page: 'security',
    name: { en: 'Change history and safety limits', id: 'Riwayat perubahan dan batas aman' },
    summary: {
      en: 'Every change is recorded: who made it and when. AI spending is capped too.',
      id: 'Setiap perubahan tercatat: siapa yang melakukannya dan kapan. Biaya AI juga dibatasi.',
    },
  },
  {
    id: 'billing',
    planRow: 'M03 Billing',
    status: 'planned',
    page: 'product/billing',
    name: { en: 'Billing, invoices and PDF', id: 'Tagihan, invoice, dan PDF' },
    summary: {
      en: 'Monthly bills are prepared as drafts automatically, ready to export as PDF.',
      id: 'Tagihan bulanan dibuat otomatis sebagai draf, lalu siap dicetak ke PDF.',
    },
  },
  {
    id: 'action-center',
    planRow: 'M08 Action Center',
    status: 'planned',
    page: 'product/action-center',
    name: { en: 'Action Center: AI suggests, you decide', id: 'Pusat Tindakan: AI menyarankan, Anda memutuskan' },
    summary: {
      en: 'The system flags what needs attention, AI prepares the next step, and you approve it.',
      id: 'Sistem menandai hal yang perlu perhatian, AI menyiapkan langkah berikutnya, dan Anda menyetujuinya.',
    },
  },
  {
    id: 'meetings',
    planRow: 'M09 Rapat',
    status: 'planned',
    page: 'product/meetings',
    name: { en: 'Meeting recordings to minutes', id: 'Rekaman rapat menjadi notulen' },
    summary: {
      en: 'Upload a meeting recording and get the full text, a summary and a task list.',
      id: 'Unggah rekaman rapat, dapatkan tulisan lengkap, ringkasan, dan daftar tugas.',
    },
  },
  {
    id: 'telegram',
    planRow: 'M11 Telegram',
    status: 'planned',
    page: 'product/telegram',
    name: { en: 'Assistant in Telegram', id: 'Asisten lewat Telegram' },
    summary: {
      en: 'See what needs attention and approve it with buttons in Telegram.',
      id: 'Lihat hal yang perlu diurus dan setujui lewat tombol di Telegram.',
    },
  },
  {
    id: 'marketing-studio',
    planRow: 'M10 Marketing Studio',
    status: 'planned',
    page: 'product/marketing-studio',
    name: { en: 'Marketing Studio (images and text)', id: 'Studio Pemasaran (gambar dan teks)' },
    summary: {
      en: 'Create promo images and text from your own product details.',
      id: 'Buat gambar dan teks promosi dari data produk Anda sendiri.',
    },
  },
];

export const statusLabel: Record<FeatureStatus, { en: string; id: string }> = {
  available: { en: 'Available now', id: 'Tersedia sekarang' },
  in_development: { en: 'In development', id: 'Sedang dikembangkan' },
  planned: { en: 'Planned', id: 'Direncanakan' },
};

export const featureById = (id: string) => features.find((f) => f.id === id);
