/**
 * Registry of the data practices the privacy page is generated from (BR-M16-32).
 * tests/data-practices.test.ts checks it against the code: every localStorage key, every cookie the app sets,
 * and every external host used by fetch or scripts must be listed here. Keep it truthful: say what is NOT available yet.
 */
type Bi = { en: string; id: string };

export interface StorageItem {
  name: string;
  kind: 'localStorage' | 'cookie';
  essential: boolean;
  /** Only exists after the visitor accepts analytics. */
  consentOnly?: boolean;
  purpose: Bi;
  whenSet: Bi;
}

export const storageItems: StorageItem[] = [
  {
    name: 'better-auth.session_token',
    kind: 'cookie',
    essential: true,
    purpose: { en: 'Keeps you signed in. First-party, expires after 7 days.', id: 'Menjaga Anda tetap masuk. Milik sendiri, kedaluwarsa setelah 7 hari.' },
    whenSet: { en: 'When you sign in or create an account', id: 'Saat Anda masuk atau membuat akun' },
  },
  {
    name: 'theme',
    kind: 'localStorage',
    essential: true,
    purpose: { en: 'Remembers light or dark mode on your device.', id: 'Mengingat mode terang atau gelap di perangkat Anda.' },
    whenSet: { en: 'When you switch the theme', id: 'Saat Anda mengganti tema' },
  },
  {
    name: 'locale',
    kind: 'cookie',
    essential: true,
    purpose: { en: 'Remembers your language in the app so pages load in it straight away. First-party, kept for a year.', id: 'Mengingat bahasa Anda di aplikasi agar halaman langsung tampil dalam bahasa itu. Milik sendiri, disimpan setahun.' },
    whenSet: { en: 'When you switch the language in the app', id: 'Saat Anda mengganti bahasa di aplikasi' },
  },
  {
    name: 'orbyte_consent',
    kind: 'localStorage',
    essential: true,
    purpose: { en: 'Remembers your analytics choice so we do not ask again.', id: 'Mengingat pilihan analitik Anda agar kami tidak bertanya lagi.' },
    whenSet: { en: 'When you accept or decline analytics', id: 'Saat Anda menyetujui atau menolak analitik' },
  },
  {
    name: '_ga, _ga_*',
    kind: 'cookie',
    essential: false,
    consentOnly: true,
    purpose: { en: 'Google Analytics 4 measurement of visits to the public pages.', id: 'Pengukuran kunjungan ke halaman publik oleh Google Analytics 4.' },
    whenSet: { en: 'Only after you accept analytics', id: 'Hanya setelah Anda menyetujui analitik' },
  },
];

export interface Processor {
  name: string;
  /** Hosts the code or the browser talks to. */
  hosts: string[];
  consentOnly?: boolean;
  /** True while the feature that uses it is still being built. */
  inDevelopment?: boolean;
  purpose: Bi;
  data: Bi;
}

export const processors: Processor[] = [
  {
    name: 'Meta Platforms (Meta Model API)',
    hosts: ['api.meta.ai'],
    purpose: { en: 'Runs the language, speech and image models behind the AI features.', id: 'Menjalankan model bahasa, suara, dan gambar di balik fitur AI.' },
    data: {
      en: 'Text and audio you send to AI features. During early access the models run on free credits, and Meta states that content may then be used to improve its products. Do not enter real client data into AI features.',
      id: 'Teks dan audio yang Anda kirim ke fitur AI. Selama akses awal model berjalan dengan kredit gratis, dan Meta menyatakan konten dapat dipakai untuk meningkatkan produknya. Jangan memasukkan data klien sebenarnya ke fitur AI.',
    },
    inDevelopment: true,
  },
  {
    name: 'Cloudflare',
    hosts: ['challenges.cloudflare.com', 'r2.cloudflarestorage.com'],
    purpose: { en: 'Delivers the site (DNS, proxy), stores files in R2 object storage and, once enabled, checks sign-ups with Turnstile.', id: 'Menyajikan situs (DNS, proxy), menyimpan berkas di penyimpanan objek R2, dan setelah diaktifkan memeriksa pendaftaran dengan Turnstile.' },
    data: { en: 'Requests to the site (IP address, headers); uploaded files such as meeting recordings.', id: 'Permintaan ke situs (alamat IP, header); berkas yang diunggah seperti rekaman rapat.' },
  },
  {
    name: 'Google (Analytics 4)',
    hosts: ['www.googletagmanager.com', 'www.google-analytics.com', 'region1.google-analytics.com'],
    consentOnly: true,
    purpose: { en: 'Measures visits to the public pages.', id: 'Mengukur kunjungan ke halaman publik.' },
    data: { en: 'Page views and clicks on calls to action on the public pages, only after you accept. Never inside the signed-in app.', id: 'Tampilan halaman dan klik ajakan bertindak di halaman publik, hanya setelah Anda setuju. Tidak pernah di dalam aplikasi setelah masuk.' },
  },
  {
    name: 'GitHub',
    hosts: ['api.github.com'],
    inDevelopment: true,
    purpose: { en: 'Reads the repositories you connect, to see which branch tip each deployment should run.', id: 'Membaca repositori yang Anda hubungkan, untuk melihat ujung branch yang seharusnya dijalankan tiap deployment.' },
    data: { en: 'Repository names, branch names and commit ids of the repositories you choose to share through the GitHub App. No code is stored by Orbyte.', id: 'Nama repositori, nama branch, dan id commit dari repositori yang Anda bagikan lewat GitHub App. Orbyte tidak menyimpan kode.' },
  },
  {
    name: 'Telegram',
    // t.me only appears in the link the user opens to pair their account; the server never calls it.
    hosts: ['api.telegram.org', 't.me'],
    inDevelopment: true,
    purpose: { en: 'Delivers findings and approval buttons to the Telegram chat you link.', id: 'Mengirim temuan dan tombol persetujuan ke chat Telegram yang Anda tautkan.' },
    data: { en: 'Your Telegram chat id and the messages the assistant sends and receives.', id: 'ID chat Telegram Anda dan pesan yang dikirim dan diterima asisten.' },
  },
];

export interface DataItem {
  id: string;
  title: Bi;
  body: Bi;
}

export const dataItems: DataItem[] = [
  {
    id: 'account',
    title: { en: 'Account', id: 'Akun' },
    body: {
      en: 'Your name, email address, role, language preference and a hash of your password (never the password itself).',
      id: 'Nama, alamat email, peran, preferensi bahasa, dan hash kata sandi Anda (bukan kata sandi itu sendiri).',
    },
  },
  {
    id: 'sessions',
    title: { en: 'Sign-in sessions', id: 'Sesi masuk' },
    body: {
      en: 'A session record with an expiry time, and the IP address and browser description of the device that signed in. Sessions are deleted when you sign out or an administrator deactivates you.',
      id: 'Catatan sesi dengan waktu kedaluwarsa, serta alamat IP dan deskripsi browser perangkat yang masuk. Sesi dihapus saat Anda keluar atau administrator menonaktifkan Anda.',
    },
  },
  {
    id: 'organization',
    title: { en: 'Organization data', id: 'Data organisasi' },
    body: {
      en: 'What you and your team enter: organization settings, and as modules are released, clients, products, invoices, leads, tasks and documents. Each organization sees only its own data.',
      id: 'Yang Anda dan tim masukkan: pengaturan organisasi, dan seiring modul dirilis, klien, produk, invoice, lead, task, dan dokumen. Setiap organisasi hanya melihat datanya sendiri.',
    },
  },
  {
    id: 'audit',
    title: { en: 'Audit records', id: 'Catatan audit' },
    body: {
      en: 'An append-only record of changes: who or which AI run changed what and when. It cannot be edited or deleted, and is kept as long as the organization exists.',
      id: 'Catatan perubahan yang hanya bisa ditambah: siapa atau proses AI mana yang mengubah apa, dan kapan. Tidak bisa diubah atau dihapus, dan disimpan selama organisasi ada.',
    },
  },
  {
    id: 'ai',
    title: { en: 'AI processing', id: 'Pemrosesan AI' },
    body: {
      en: 'AI features send the text, audio or images you choose to the model provider. We record a short summary, the model, token use and cost of each call, not the full content of your documents.',
      id: 'Fitur AI mengirim teks, audio, atau gambar yang Anda pilih ke penyedia model. Kami mencatat ringkasan singkat, model, pemakaian token, dan biaya tiap panggilan, bukan isi lengkap dokumen Anda.',
    },
  },
];

export const notYetAvailable: Bi[] = [
  { en: 'Self-service account deletion and data export. Write to the contact address and we handle it by hand.', id: 'Penghapusan akun dan ekspor data mandiri. Tulis ke alamat kontak dan kami menanganinya secara manual.' },
  { en: 'Automatic deletion of audit records and AI run history.', id: 'Penghapusan otomatis catatan audit dan riwayat proses AI.' },
  { en: 'Email verification and multi-factor sign-in.', id: 'Verifikasi email dan masuk dengan beberapa faktor.' },
];
