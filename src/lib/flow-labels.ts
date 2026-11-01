import type { Locale } from './i18n';

/**
 * Plain-language names for the settings of every flow tool, so the editor never shows a parameter key such as
 * `require` or `from_example` (the project rule: business words under every control). The key is the parameter name; a
 * few names mean different things in different tools, so `tool.id:key` is tried first. `tests/flow-labels.test.ts`
 * fails when a tool gains a setting that has no words here.
 */
export interface FieldText {
  label: string;
  help: string;
}

type Table = Record<string, FieldText>;

const ID: Table = {
  repo: { label: 'Repositori GitHub', help: 'Nama repositori dalam bentuk pemilik/nama, misalnya asiifdev/orbit-crm.' },
  branch: { label: 'Cabang (branch)', help: 'Cabang kode yang dipakai, biasanya main.' },
  'ssh.check_tools:require': { label: 'Perangkat yang wajib ada', help: 'Daftar perangkat di server dipisah koma, misalnya php,composer,node,npm,pm2,git. Kosongkan bila hanya ingin melihat laporannya.' },
  'ssh.list_ports:from': { label: 'Port awal', help: 'Port paling kecil yang akan diperiksa apakah sudah terpakai di server.' },
  'ssh.list_ports:to': { label: 'Port akhir', help: 'Port paling besar yang akan diperiksa.' },
  'orbyte.allocate_port:from': { label: 'Port awal', help: 'Port pertama yang boleh diberikan ke klien ini.' },
  'orbyte.allocate_port:to': { label: 'Port akhir', help: 'Port terakhir yang boleh diberikan. Harus sama atau lebih besar dari port awal.' },
  used: { label: 'Port yang sudah terpakai', help: 'Biasanya diisi dari hasil langkah "Daftar port terpakai" lewat Sisipkan nilai, supaya port yang sama tidak diberikan dua kali.' },
  dir: { label: 'Folder aplikasi di server', help: 'Lokasi aplikasi di server, misalnya /www/wwwroot/klien-satu. Hanya folder aplikasi yang diizinkan.' },
  path: { label: 'Lokasi berkas di server', help: 'Alamat lengkap berkas yang akan ditulis. Hanya Pemilik yang boleh memakai langkah ini.' },
  content: { label: 'Isi berkas', help: 'Teks yang ditulis ke berkas. Boleh memuat nilai dari langkah sebelumnya lewat Sisipkan nilai.' },
  mode: { label: 'Hak akses berkas', help: 'Siapa yang boleh membuka berkas ini di server. Pilih yang paling ketat yang masih cukup.' },
  overwrite: { label: 'Timpa bila sudah ada', help: 'Bila mati, langkah gagal jika berkas itu sudah ada sehingga tidak ada isi lama yang hilang.' },
  'ssh.npm:script': { label: 'Yang dijalankan', help: 'Pasang paket dari kunci versi (ci) atau bangun aplikasi untuk produksi (build).' },
  'ssh.run_command:script': { label: 'Perintah', help: 'Perintah bebas yang dijalankan di server. Hanya Pemilik yang boleh memakai langkah ini.' },
  command: { label: 'Perintah Laravel', help: 'Salah satu perintah artisan yang sudah ditentukan. Perintah di luar daftar ini tidak bisa dijalankan.' },
  create: { label: 'Folder yang dibuat', help: 'Folder yang perlu dibuat bila belum ada, dipisah koma, relatif terhadap folder aplikasi.' },
  writable: { label: 'Folder yang bisa ditulis', help: 'Folder yang harus bisa ditulis aplikasi (misalnya storage), dipisah koma.' },
  action: { label: 'Tindakan pm2', help: 'Mulai proses baru, muat ulang tanpa terputus, atau simpan daftar proses agar hidup lagi setelah server restart.' },
  file: { label: 'Berkas konfigurasi pm2', help: 'Nama berkas konfigurasi proses di folder aplikasi. Biasanya tidak perlu diubah.' },
  entries: { label: 'Isi pengaturan .env', help: 'Satu pengaturan per baris dalam bentuk NAMA=nilai. Rahasia dari langkah sebelumnya boleh dipakai.' },
  from_example: { label: 'Mulai dari .env.example', help: 'Bila aktif, berkas .env dibuat dari contoh di repositori lalu pengaturan di atas diterapkan.' },
  'panel.create_database:name': { label: 'Nama database', help: 'Huruf kecil, angka, dan garis bawah.' },
  user: { label: 'Pengguna database', help: 'Kosongkan agar memakai nama database.' },
  password: { label: 'Kata sandi database', help: 'Minimal 12 karakter. Biasanya diisi dari rahasia yang dibuat di langkah sebelumnya.' },
  note: { label: 'Catatan di panel', help: 'Keterangan yang tampil di aaPanel untuk database ini.' },
  'panel.create_proxy:domain': { label: 'Domain', help: 'Alamat situs yang akan diteruskan ke aplikasi, misalnya klien.example.com.' },
  target: { label: 'Tujuan proxy', help: 'Alamat aplikasi di server, misalnya http://127.0.0.1:8080.' },
  remark: { label: 'Catatan di panel', help: 'Keterangan yang tampil di aaPanel untuk proxy ini.' },
  'panel.delete_database:from': { label: 'Database yang dihapus', help: 'Nama langkah pembuat database di flow ini. Hanya database yang dibuat flow ini yang bisa dihapus.' },
  'panel.delete_proxy:from': { label: 'Proxy yang dihapus', help: 'Nama langkah pembuat proxy di flow ini. Hanya proxy yang dibuat flow ini yang bisa dihapus.' },
  'orbyte.generate_secret:name': { label: 'Nama rahasia', help: 'Nama untuk memanggil rahasia ini di langkah berikutnya. Nilainya tidak ditampilkan dan dihapus setelah run selesai.' },
  length: { label: 'Panjang', help: 'Jumlah karakter rahasia, 16 sampai 128.' },
  alphabet: { label: 'Jenis karakter', help: 'Huruf dan angka, heksadesimal, atau huruf kecil saja.' },
  url: { label: 'Alamat yang dicek', help: 'Alamat situs yang diharapkan sudah menjawab, misalnya https://klien.example.com.' },
  expect: { label: 'Kode jawaban yang dianggap benar', help: 'Kode HTTP dipisah koma. 200 berarti halaman normal, 301 dan 302 berarti dialihkan.' },
  tries: { label: 'Jumlah percobaan', help: 'Berapa kali dicoba sebelum langkah dinyatakan gagal.' },
  delay_seconds: { label: 'Jeda antar percobaan (detik)', help: 'Waktu tunggu setelah satu percobaan gagal, memberi aplikasi waktu untuk menyala.' },
  client_id: { label: 'Klien', help: 'Klien pemilik deployment ini.' },
  product_id: { label: 'Produk', help: 'Produk yang dipasang.' },
  environment: { label: 'Lingkungan', help: 'Misalnya production atau staging.' },
  app_path: { label: 'Folder aplikasi di server', help: 'Lokasi aplikasi di server, dicatat di deployment.' },
  app_port: { label: 'Port aplikasi', help: 'Port yang dipakai aplikasi ini, dicatat di deployment.' },
  commit: { label: 'Versi kode terpasang', help: 'Commit yang terpasang. Biasanya diisi dari hasil langkah clone atau tarik kode.' },
  server_slot: { label: 'Server', help: 'Server tempat aplikasi ini dipasang, dicatat di deployment.' },
  'orbyte.record_deployment:domain': { label: 'Domain', help: 'Alamat situs deployment ini, dicatat agar bisa dipantau.' },
  'orbyte.record_deployment:repo': { label: 'Repositori GitHub', help: 'Repositori kode yang terpasang, dicatat agar bisa dibandingkan dengan versi terbaru.' },
  'orbyte.record_deployment:branch': { label: 'Cabang (branch)', help: 'Cabang yang terpasang, dicatat agar bisa dibandingkan dengan versi terbaru.' },
};

const EN: Table = {
  repo: { label: 'GitHub repository', help: 'Owner/name form, for example asiifdev/orbit-crm.' },
  branch: { label: 'Branch', help: 'The code branch to use, usually main.' },
  'ssh.check_tools:require': { label: 'Tools that must be present', help: 'Comma-separated tools on the server, for example php,composer,node,npm,pm2,git. Leave empty to only see the report.' },
  'ssh.list_ports:from': { label: 'First port', help: 'The lowest port to check for use on the server.' },
  'ssh.list_ports:to': { label: 'Last port', help: 'The highest port to check.' },
  'orbyte.allocate_port:from': { label: 'First port', help: 'The first port that may be given to this client.' },
  'orbyte.allocate_port:to': { label: 'Last port', help: 'The last port that may be given. Must be equal to or above the first port.' },
  used: { label: 'Ports already in use', help: 'Usually filled from the "List used ports" step with Insert value, so the same port is never given twice.' },
  dir: { label: 'App folder on the server', help: 'Where the app lives on the server, for example /www/wwwroot/client-one. Only app folders are allowed.' },
  path: { label: 'File location on the server', help: 'Full path of the file to write. Only the Owner may use this step.' },
  content: { label: 'File content', help: 'The text written to the file. May hold values from earlier steps through Insert value.' },
  mode: { label: 'File permissions', help: 'Who may open this file on the server. Pick the strictest that still works.' },
  overwrite: { label: 'Replace if it exists', help: 'When off, the step fails if the file already exists so no old content is lost.' },
  'ssh.npm:script': { label: 'What to run', help: 'Install packages from the lock file (ci) or build the app for production (build).' },
  'ssh.run_command:script': { label: 'Command', help: 'A free command run on the server. Only the Owner may use this step.' },
  command: { label: 'Laravel command', help: 'One of the fixed artisan commands. Commands outside this list cannot be run.' },
  create: { label: 'Folders to create', help: 'Folders to create when missing, comma-separated, relative to the app folder.' },
  writable: { label: 'Folders the app can write', help: 'Folders the app must be able to write (such as storage), comma-separated.' },
  action: { label: 'pm2 action', help: 'Start a new process, reload without downtime, or save the process list so it returns after a server restart.' },
  file: { label: 'pm2 configuration file', help: 'Name of the process configuration file in the app folder. Usually no need to change it.' },
  entries: { label: '.env settings', help: 'One setting per line as NAME=value. Secrets from earlier steps may be used.' },
  from_example: { label: 'Start from .env.example', help: 'When on, the .env file is made from the example in the repository and the settings above are applied.' },
  'panel.create_database:name': { label: 'Database name', help: 'Lowercase letters, digits and underscores.' },
  user: { label: 'Database user', help: 'Leave empty to use the database name.' },
  password: { label: 'Database password', help: 'At least 12 characters. Usually filled from a secret made in an earlier step.' },
  note: { label: 'Note in the panel', help: 'The description shown in aaPanel for this database.' },
  'panel.create_proxy:domain': { label: 'Domain', help: 'The site address to forward to the app, for example client.example.com.' },
  target: { label: 'Proxy target', help: 'The app address on the server, for example http://127.0.0.1:8080.' },
  remark: { label: 'Note in the panel', help: 'The description shown in aaPanel for this proxy.' },
  'panel.delete_database:from': { label: 'Database to delete', help: 'The name of the step that created the database in this flow. Only a database this flow made can be deleted.' },
  'panel.delete_proxy:from': { label: 'Proxy to delete', help: 'The name of the step that created the proxy in this flow. Only a proxy this flow made can be deleted.' },
  'orbyte.generate_secret:name': { label: 'Secret name', help: 'The name to call this secret by in later steps. The value is never shown and is erased when the run ends.' },
  length: { label: 'Length', help: 'Number of characters in the secret, 16 to 128.' },
  alphabet: { label: 'Characters', help: 'Letters and digits, hexadecimal, or lowercase letters only.' },
  url: { label: 'Address to check', help: 'The site address expected to answer, for example https://client.example.com.' },
  expect: { label: 'Answer codes that count as good', help: 'Comma-separated HTTP codes. 200 is a normal page, 301 and 302 are redirects.' },
  tries: { label: 'Number of tries', help: 'How many attempts before the step is declared failed.' },
  delay_seconds: { label: 'Wait between tries (seconds)', help: 'The wait after a failed try, giving the app time to start.' },
  client_id: { label: 'Client', help: 'The client that owns this deployment.' },
  product_id: { label: 'Product', help: 'The product that is installed.' },
  environment: { label: 'Environment', help: 'For example production or staging.' },
  app_path: { label: 'App folder on the server', help: 'Where the app lives on the server, recorded on the deployment.' },
  app_port: { label: 'App port', help: 'The port this app uses, recorded on the deployment.' },
  commit: { label: 'Installed code version', help: 'The commit that is installed. Usually filled from the clone or pull step.' },
  server_slot: { label: 'Server', help: 'The server this app is installed on, recorded on the deployment.' },
  'orbyte.record_deployment:domain': { label: 'Domain', help: 'The site address of this deployment, recorded so it can be monitored.' },
  'orbyte.record_deployment:repo': { label: 'GitHub repository', help: 'The code repository that is installed, recorded so it can be compared with the latest version.' },
  'orbyte.record_deployment:branch': { label: 'Branch', help: 'The installed branch, recorded so it can be compared with the latest version.' },
};

/** Words for the fixed choices of a setting (`key:value`); a value with no entry is shown as it is. */
const OPTIONS: Record<Locale, Record<string, string>> = {
  id: {
    'mode:600': 'Hanya pemilik berkas (600)',
    'mode:640': 'Pemilik menulis, grup membaca (640)',
    'mode:644': 'Semua boleh membaca (644)',
    'script:ci': 'Pasang paket (npm ci)',
    'script:build': 'Bangun aplikasi (npm run build)',
    'command:key_generate': 'Buat kunci aplikasi (key:generate)',
    'command:storage_link': 'Hubungkan folder storage (storage:link)',
    'command:migrate': 'Jalankan migrasi database (migrate)',
    'command:seed': 'Isi data awal (db:seed)',
    'command:config_cache': 'Simpan cache konfigurasi (config:cache)',
    'command:route_cache': 'Simpan cache rute (route:cache)',
    'command:view_cache': 'Simpan cache tampilan (view:cache)',
    'command:event_cache': 'Simpan cache event (event:cache)',
    'command:optimize_clear': 'Hapus semua cache (optimize:clear)',
    'command:down': 'Aktifkan mode pemeliharaan (down)',
    'command:up': 'Matikan mode pemeliharaan (up)',
    'action:start': 'Mulai proses (start)',
    'action:reload': 'Muat ulang tanpa terputus (reload)',
    'action:save': 'Simpan daftar proses (save)',
    'alphabet:alnum': 'Huruf dan angka',
    'alphabet:hex': 'Heksadesimal (0-9, a-f)',
    'alphabet:lower': 'Huruf kecil saja',
  },
  en: {
    'mode:600': 'File owner only (600)',
    'mode:640': 'Owner writes, group reads (640)',
    'mode:644': 'Everyone may read (644)',
    'script:ci': 'Install packages (npm ci)',
    'script:build': 'Build the app (npm run build)',
    'command:key_generate': 'Make the app key (key:generate)',
    'command:storage_link': 'Link the storage folder (storage:link)',
    'command:migrate': 'Run database migrations (migrate)',
    'command:seed': 'Fill starting data (db:seed)',
    'command:config_cache': 'Cache configuration (config:cache)',
    'command:route_cache': 'Cache routes (route:cache)',
    'command:view_cache': 'Cache views (view:cache)',
    'command:event_cache': 'Cache events (event:cache)',
    'command:optimize_clear': 'Clear every cache (optimize:clear)',
    'command:down': 'Turn maintenance mode on (down)',
    'command:up': 'Turn maintenance mode off (up)',
    'action:start': 'Start the process (start)',
    'action:reload': 'Reload without downtime (reload)',
    'action:save': 'Save the process list (save)',
    'alphabet:alnum': 'Letters and digits',
    'alphabet:hex': 'Hexadecimal (0-9, a-f)',
    'alphabet:lower': 'Lowercase letters only',
  },
};

export const FIELD_TEXT: Record<Locale, Table> = { id: ID, en: EN };

/** The label and help of one setting of one tool; null when nobody has written words for it (the editor then shows the key). */
export function fieldText(locale: Locale, toolId: string, key: string): FieldText | null {
  const table = FIELD_TEXT[locale];
  return table[`${toolId}:${key}`] ?? table[key] ?? null;
}

export function optionLabel(locale: Locale, key: string, value: string): string {
  return OPTIONS[locale][`${key}:${value}`] ?? value;
}
