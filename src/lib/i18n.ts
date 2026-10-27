/** UI dictionary for Indonesian and English (BR-M14-09, D-013). */

const dict = {
  en: {
    required: 'required',
    optional: 'optional',
    clear: 'Clear',
    showHelp: 'Show explanation',
    search: 'Search…',
    noResults: 'No results',
    all: 'All',
    choose: 'Choose…',
    dropOrClick: 'Drop a file here or click to choose',
    dropOrClickMany: 'Drop files here or click to choose',
    remove: 'Remove',
    wrongType: '{name} is not an accepted file type.',
    tooBig: '{name} is larger than {max}.',
    tooMany: 'Only {count} file(s) allowed.',
    uploading: 'Uploading',
    moneyInvalid: 'Enter an amount in whole Rupiah, for example 1.500.000 or 1,5jt.',
    moneyFraction: 'Only whole Rupiah are allowed.',
    moneyMin: 'The amount must be at least {min}.',
    moneyMax: 'The amount must be at most {max}.',
    dateInvalid: 'Enter a real date as DD/MM/YYYY.',
    dateMin: 'The date must be on or after {min}.',
    dateMax: 'The date must be on or before {max}.',
    openCalendar: 'Open calendar',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    numberMin: 'The value must be at least {min}.',
    numberMax: 'The value must be at most {max}.',
    characters: 'characters',
    themeLight: 'Switch to light theme',
    themeDark: 'Switch to dark theme',
    language: 'Language',
  },
  id: {
    required: 'wajib',
    optional: 'opsional',
    clear: 'Hapus',
    showHelp: 'Tampilkan penjelasan',
    search: 'Cari…',
    noResults: 'Tidak ada hasil',
    all: 'Semua',
    choose: 'Pilih…',
    dropOrClick: 'Tarik berkas ke sini atau klik untuk memilih',
    dropOrClickMany: 'Tarik berkas ke sini atau klik untuk memilih',
    remove: 'Hapus',
    wrongType: '{name} bukan jenis berkas yang diterima.',
    tooBig: '{name} lebih besar dari {max}.',
    tooMany: 'Hanya {count} berkas yang diizinkan.',
    uploading: 'Mengunggah',
    moneyInvalid: 'Isi nominal dalam Rupiah utuh, misalnya 1.500.000 atau 1,5jt.',
    moneyFraction: 'Hanya Rupiah utuh yang diizinkan.',
    moneyMin: 'Nominal minimal {min}.',
    moneyMax: 'Nominal maksimal {max}.',
    dateInvalid: 'Isi tanggal yang benar dengan format DD/MM/YYYY.',
    dateMin: 'Tanggal harus pada atau setelah {min}.',
    dateMax: 'Tanggal harus pada atau sebelum {max}.',
    openCalendar: 'Buka kalender',
    previousMonth: 'Bulan sebelumnya',
    nextMonth: 'Bulan berikutnya',
    numberMin: 'Nilai minimal {min}.',
    numberMax: 'Nilai maksimal {max}.',
    characters: 'karakter',
    themeLight: 'Ganti ke tema terang',
    themeDark: 'Ganti ke tema gelap',
    language: 'Bahasa',
  },
} as const;

export { dict as messages };
export type Locale = keyof typeof dict;
export type MessageKey = keyof (typeof dict)['en'];

const DEFAULT_LOCALE: Locale = 'id';
const STORAGE_KEY = 'locale';

let locale: Locale = DEFAULT_LOCALE;
let resolved = false;
const listeners = new Set<() => void>();

const isLocale = (v: unknown): v is Locale => v === 'id' || v === 'en';

/** Saved choice first, then the browser language, then Indonesian. Runs once, in the browser only. */
function resolveInBrowser() {
  if (resolved || typeof window === 'undefined') return;
  resolved = true;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) locale = saved;
    else if (navigator.language?.toLowerCase().startsWith('en')) locale = 'en';
  } catch {
    /* Storage can be blocked; fall back to the default. */
  }
}

export function getLocale(): Locale {
  resolveInBrowser();
  return locale;
}

export function setLocale(next: Locale) {
  locale = next;
  resolved = true;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* The choice then lasts for this page view only. */
  }
  listeners.forEach((fn) => fn());
}

export function subscribeLocale(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** What the server renders: the module default, never the visitor's choice. */
export const getServerLocale = (): Locale => locale;

/** Pure lookup for a given language. Components get this bound to the active language through `useT`. */
export function translate(lang: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  let text: string = dict[lang][key];
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v));
  return text;
}

/** Non-reactive shortcut for code outside React (tests, scripts). Components should use `useT`. */
export const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(getLocale(), key, vars);
