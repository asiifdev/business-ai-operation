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
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    signOut: 'Sign out',
    createAccount: 'Create account',
    creatingAccount: 'Creating account…',
    signInTitle: 'Sign in to your organization',
    registerTitle: 'Create your organization',
    registerIntro: 'You become the Owner and can add your team afterwards.',
    noAccount: 'No account yet?',
    haveAccount: 'Already have an account?',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    passwordHelp: 'At least 10 characters.',
    nameLabel: 'Your name',
    organizationLabel: 'Organization name',
    organizationHelp: 'Your agency or company, as it should appear on invoices.',
    loginFailed: 'The email or password is not correct.',
    emailTaken: 'This email is already registered. Sign in instead.',
    passwordTooShort: 'Use at least 10 characters.',
    fieldInvalid: 'Please check this field.',
    rateLimited: 'Too many attempts. Please wait a few minutes and try again.',
    genericError: 'Something went wrong. Please try again.',
    welcome: 'Welcome, {name}',
    dashboardTitle: 'Dashboard',
    dashboardSoon: 'Business numbers, the Action Center and the other modules will appear here as they are built.',
    roleOwner: 'Owner',
    roleAdmin: 'Admin',
    roleStaff: 'Staff',
    signedInAs: 'Signed in as',
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
    signIn: 'Masuk',
    signingIn: 'Sedang masuk…',
    signOut: 'Keluar',
    createAccount: 'Buat akun',
    creatingAccount: 'Membuat akun…',
    signInTitle: 'Masuk ke organisasi Anda',
    registerTitle: 'Buat organisasi Anda',
    registerIntro: 'Anda menjadi Pemilik dan dapat menambahkan tim setelahnya.',
    noAccount: 'Belum punya akun?',
    haveAccount: 'Sudah punya akun?',
    emailLabel: 'Email',
    passwordLabel: 'Kata sandi',
    passwordHelp: 'Minimal 10 karakter.',
    nameLabel: 'Nama Anda',
    organizationLabel: 'Nama organisasi',
    organizationHelp: 'Agensi atau perusahaan Anda, sebagaimana tampil di invoice.',
    loginFailed: 'Email atau kata sandi tidak sesuai.',
    emailTaken: 'Email ini sudah terdaftar. Silakan masuk.',
    passwordTooShort: 'Gunakan minimal 10 karakter.',
    fieldInvalid: 'Mohon periksa isian ini.',
    rateLimited: 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.',
    genericError: 'Terjadi kesalahan. Silakan coba lagi.',
    welcome: 'Selamat datang, {name}',
    dashboardTitle: 'Dasbor',
    dashboardSoon: 'Angka bisnis, Action Center, dan modul lainnya akan tampil di sini seiring dibangun.',
    roleOwner: 'Pemilik',
    roleAdmin: 'Admin',
    roleStaff: 'Staf',
    signedInAs: 'Masuk sebagai',
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
