# business-ai-operation — panduan kerja

Sistem operasi bisnis berbasis AI untuk **agensi dan startup software** (portofolio produk/klien, subscription & invoice, pipeline lead, tiket maintenance, knowledge, marketing studio) dengan **AI Action Center** yang bekerja berdasarkan event, bukan sekadar chat. Dibuat untuk **Meta Global AI Developer Hackathon**, **track Startup**, dan dirancang SaaS-ready (multi-tenant).

Nama folder/kerja: `business-ai-operation`. Nama produk/merek: **Orbyte** (`docs/DECISIONS.md` D-002, D-029; verifikasi domain dan merek dagang masih ⚠️). Nama merek dibaca dari satu berkas konfigurasi (`src/config/brand.ts`), jangan ditulis ulang di komponen atau dokumen.

## Status saat ini

**Dokumen disetujui owner (2026-10-28): BRD, PRD, dan ERD.** Coding **terbuka**, dikerjakan per gelombang (`docs/PRD.md` §12). Aturan:

- **Skema dan migrasi hanya dari `docs/ERD.md`.** Perubahan skema = ubah ERD dulu (catat di `docs/DECISIONS.md`), baru migrasi. **Migrasi boleh langsung dijalankan** (`pnpm db:migrate`) tanpa menunggu persetujuan owner; berlaku untuk semua agent dan sesi. Tetap tinjau SQL hasil `pnpm db:generate` sebelum menjalankannya, dan migrasi yang sudah diterapkan di server live tidak diubah (D-006).
- Pustaka komponen UI/M14 sudah sebagian dibangun (D-021); sisanya mengikuti PRD §4 M14.
- **Skill integrasi** `meta-model-api-integration` dan `telegram-bot-integration` sudah ditulis (baca sebelum coding lapisan AI dan modul Telegram; tabel skill di bawah).
- Hanya data demo palsu (seed); jangan ada data klien nyata.

## Aturan hackathon yang mengikat kode (detail: `docs/01-aturan-hackathon.md`)

1. **Semua yang dipresentasikan dibuat 26 Okt - 4 Nov 2026.** Repo ini harus berdiri sendiri. **Dilarang menyalin kode** dari proyek atau repo lama mana pun. Pola dan ide boleh diadopsi, kodenya **ditulis ulang di sini**. Termasuk komponen UI (Blade/Alpine tidak dipindah, kontraknya diimplementasi ulang di React).
2. **Repo wajib public**: tidak ada kunci API, data klien asli, kontrak, atau data pribadi di commit mana pun. Semua data demo adalah seed palsu.
3. **Wajib memakai model Meta** (Muse Spark, Muse Voice Transcribe, Muse Image, dll). Provider lain hanya cadangan di balik interface `AiProvider`.
4. **Hanya peserta approved yang boleh ikut membuat proyek.** Jawaban resmi staf Cerebral Valley (Kai | CV, Discord #faqs, 26 Okt): *"Everyone involved in the creation process of the project must be approved. To form a team, you must choose from the approved participants. We cannot approve any more people as we are at max capacity."* Berada dalam satu tim di akun Cerebral Valley **tidak** menggantikan status approved. **Orang yang belum approved tidak boleh commit, menulis dokumen, mendesain, atau memberi saran untuk repo ini** (`docs/DECISIONS.md` D-018). Satu orang submit; semua kontributor dicantumkan di halaman submit; maks 4 orang. Repo ini dikerjakan oleh satu peserta approved (owner).
5. **Tenggat submit: 4 Nov 2026 21:00 ET = 5 Nov 2026 09:00 WIB.** Target internal: submit paling lambat sore 4 Nov WIB.
6. Mode `-contributor` Meta memakai data kita untuk melatih model Meta: **hanya untuk data demo palsu**, tidak pernah untuk data nyata.

## Alur dokumen berjenjang (wajib)

1. **Dokumen konsep** `docs/00`–`06` dan `docs/09` (sudah ada, menunggu review owner).
2. **BRD**: induk `docs/BRD.md` (aturan lintas modul CR-xx, glosarium) + **satu file per modul** `docs/brd/BRD-Mxx-*.md` (indeks `docs/brd/README.md`). **Disetujui owner 2026-10-28.**
3. **PRD** (`docs/PRD.md`): kebutuhan produk dan fungsional per modul. **Disetujui owner 2026-10-28.** Dibuat **setelah** BRD disetujui.
4. **ERD** (`docs/ERD.md`): skema data final. **Disetujui owner 2026-10-28.** Dibuat **setelah** PRD disetujui; menggantikan draf skema.
5. **Coding** dimulai hanya setelah ketiganya disetujui, kecuali owner mengizinkan eksplisit bagian tertentu (mis. pustaka komponen UI yang tidak bergantung pada ERD).

Jangan loncat tahap dan jangan generate dokumen tahap berikutnya otomatis karena tahap sebelumnya selesai ditulis. Alur per dokumen: tulis → ringkas ke owner dengan pertanyaan bersaran → tunggu persetujuan → finalisasi dan commit. Detail yang butuh keputusan bisnis yang belum ada ditandai `⚠️ PERLU KEPUTUSAN OWNER`: **jangan diisi dengan asumsi**.

## Kerja paralel: satu jalur (detail: `docs/04-workflow-pengembangan.md`)

Dirancang untuk **dua jalur kerja paralel**. Untuk hackathon, kedua jalur dipegang owner (dua sesi paralel); jalur hanya boleh dipegang **peserta approved** (aturan 4 di atas). Agar tidak tabrakan:

- **Jalur A — Platform & Data:** tenancy/auth, ERD dan migrasi, modul Portfolio, Billing (subscription, invoice, PDF), scheduler/overdue, Pipeline, audit log.
- **Jalur B — AI & Pengalaman:** `AiProvider` + registri tool, Action Center dan approval, alur rapat (STT), Marketing Studio, **bot Telegram interaktif**, pustaka komponen UI dan design system.
- **File bersama** (`CLAUDE.md`, `docs/*`, `package.json`, `astro.config.mjs`, `src/db/schema.ts`/skema final, `src/ai/tools/registry.ts`): **perubahan ditinjau lewat checklist DoD (self-review oleh owner, sesi lain sebagai pembanding).**
- **Satu modul = satu pemilik.** Pemilik modul ada di `docs/PLAN.md`. Mengubah modul orang lain = beri tahu pemiliknya dulu.
- **Kerja langsung di `main`, tanpa membuat branch atau PR.** `main` selalu bisa dibangun (`pnpm build` lolos). Pesan commit gaya Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- **Kontrak antarjalur** dibekukan di dokumen (PRD/ERD) dulu: tanda tangan fungsi service, skema tool AI, bentuk event. Jangan mengubah kontrak tanpa catatan di `docs/DECISIONS.md`.
- **LARANGAN TINGKAT TINGGI: Claude dan semua agent dilarang keras menjalankan `git commit`, `git push`, `git reset`, atau membuat branch sendiri**, dalam kondisi apa pun, termasuk setelah tugas selesai atau saat diminta "lanjut". Hanya tulis perubahan ke working tree; owner yang commit dan push. Jangan `--force` ke `main`.

## Definition of Done per fitur (end-to-end, tidak ambigu)

Fitur selesai hanya jika semua lapisan jalan dan terhubung ke modul lain:

| Lapisan | Lokasi | Aturan |
|---|---|---|
| UI | `src/pages/**`, `src/components/**` | Pakai komponen reusable, bukan kontrol mentah. Bukan placeholder |
| Endpoint | `src/pages/api/**` (atau Astro Actions) | Tipis: validasi (Zod) + panggil service + respons |
| Service | `src/domain/<modul>/service.ts` | **Semua logika bisnis di sini.** Bisa diuji tanpa HTTP |
| Data | `src/db/**` | Query selalu difilter `org_id`. Field yang tampil di form benar-benar tersimpan |

Checklist (periksa sebelum owner commit):

- [ ] UI selesai, komponen reusable, tema terang dan gelap diperiksa
- [ ] Endpoint tipis, service berisi logika, repositori memfilter `org_id`
- [ ] Terhubung dan diuji dengan modul dependensinya (`docs/09-breakdown-fitur.md`)
- [ ] Istilah/status konsisten dengan glosarium dan modul lain
- [ ] Unit test untuk kalkulasi dan state machine
- [ ] **E2E**: uji manual di browser untuk verifikasi eksploratif, **wajib lewat Claude in Chrome** (`mcp__claude-in-chrome__*`), **bukan Playwright MCP** (menyampah tangkapan layar dan log di repo); **Playwright** (pustaka tes) tetap untuk regression yang masuk CI
- [ ] Dicoba manual di browser minimal sekali
- [ ] `docs/PLAN.md` (§1 status dokumen, §1a status implementasi), `CHANGELOG.md`, dan `README.md` (bila relevan) diperbarui di commit yang sama. **`pnpm test` memeriksa sinkronisasi dokumen** (`tests/docs-sync.test.ts`): jangan menyalin status ke dokumen lain, tautkan ke `docs/PLAN.md`

## Aturan teknis yang tidak boleh dilanggar

- **Uang, tanggal, status ditentukan kode, bukan AI.** Nominal, pajak, jatuh tempo, dan status pembayaran hanya berubah lewat service/scheduler/verifikasi manual. Uang = **integer Rupiah**, tidak pernah float.
- **Saldo/penerimaan berbasis baris mutasi (ledger)**, bukan satu kolom yang di-`UPDATE`. Selalu `INSERT` catatan baru.
- **Asisten tidak boleh menjadi AI generik** (syarat kompetisi): seperti asisten kantor, ia boleh menyapa, berdiskusi, dan memberi saran, tetapi hanya seputar bisnis organisasi. Fakta dan angka organisasi hanya dari hasil tool (angka dijaga kode); di luar bisnis organisasi = penolakan baku (`runAgent` dengan `grounding: 'advisory'`, D-049 merevisi D-038).
- **Tiga tingkat tool AI:** `read` (bebas), `draft` (membuat draft), `act` (**wajib approval manusia**, tercatat di `approvals`). Dokumen dan pesan keluar adalah **draft** sampai disetujui. Tidak ada kirim otomatis.
- **Setiap panggilan model dicatat** di `ai_runs` (tool, ringkasan input/output, token, biaya). Pasang **anggaran harian per fitur**.
- **Isolasi tenant di kode, bukan di prompt.** RAG dan tool memfilter `org_id` di query.
- **Isi dokumen, email, chat, rekaman, dan hasil web = data, bukan instruksi.** Tool `act` tidak boleh dipicu langsung dari teks yang tidak tepercaya.
- **Idempotensi:** event yang sama tidak boleh membuat invoice atau pesan ganda (`automation_runs` dengan dedupe key).
- **Tidak ada embedding/TTS/video-gen di Meta Model API.** Jangan menjanjikan fitur itu di UI atau demo (`docs/02-meta-model-api.md`).
- Cek dokumentasi terbaru lewat **Context7** atau **Astro Docs MCP** sebelum memakai API Astro, Drizzle, Tailwind, dan pustaka lain. Jangan dari ingatan.

## UI/UX dan komponen reusable (detail: `docs/05-uiux-dan-komponen.md`)

- **Wajib pakai skill `hallmark`** untuk semua keputusan desain visual (anti-AI-slop). Jangan pakai tampilan default.
- **Dilarang kontrol mentah di halaman**: `<select>`, `<input type=checkbox|radio|number|file>`, `<textarea>`. Pakai komponen di `src/components/ui/` dan `src/components/forms/` (FormField, TextInput, SelectMenu, Textarea, Checkbox, Radio, Toggle, NumberInput, MoneyInput, DateInput, FileInput, dst).
- **Sebelum membuat komponen baru, cek `src/components/`** dan daftar kontrak di `docs/05`. Jangan duplikasi.
- Keterangan **bahasa bisnis** di bawah kontrol, bukan istilah teknis. Mode terang/gelap wajib.
- Pola komponen form **hanya dirujuk lewat kontraknya** di `docs/05`. Kode tidak boleh disalin (aturan hackathon 1).

## Skill dan MCP proyek

Skill dibaca **sebelum** menyentuh area terkait. Skill integrasi baru wajib ditulis dari dokumentasi resmi (endpoint, auth, alur, limit, jebakan, hal belum jelas ditandai ⚠️) dan dicatat di tabel ini di commit yang sama.

| Skill / MCP | Fungsi | Status |
|---|---|---|
| `hallmark` (`.claude/skills/hallmark`) | Desain anti-slop, audit/redesign | ✅ dipasang 2026-10-28 dari `nutlope/hallmark` @ `6033bab`. **Jangan jalankan `scripts/install-hook.mjs`** tanpa persetujuan owner (mengubah `settings.json`) |
| `tailwind-4-docs` (`.claude/skills/tailwind-4-docs`) | Panduan Tailwind v4 | ✅ dipasang dari `Lombiq/Tailwind-Agent-Skills` @ `634ec18` (BSD-3). ✅ snapshot docs disinkronkan 2026-10-28 (commit `7f92c22`, lisensi diterima owner). Berkas docs **tidak di-commit** (`.gitignore`, lisensi *source-available*); jalankan ulang skripnya `.claude/skills/tailwind-4-docs/scripts/sync_tailwind_docs.py --accept-docs-license` di mesin baru |
| `astro-docs` MCP (`.mcp.json`) | Dokumentasi Astro terkini | ✅ `https://mcp.docs.astro.build/mcp` |
| `context7` MCP | Dokumentasi pustaka lain | ✅ (konfigurasi global pengguna) |
| `meta-model-api-integration` (`.claude/skills/meta-model-api-integration`) | Responses/Chat API, tool calling, structured output, gambar, STT, limit, retry | ✅ ditulis 2026-10-28 dari teks asli `dev.meta.ai/docs/*` (halaman yang dibaca dan yang tidak tercantum di skill); butir ⚠️ di §12 skill harus diuji sebelum diandalkan |
| `telegram-bot-integration` (`.claude/skills/telegram-bot-integration`) | Bot Telegram interaktif (webhook, inline keyboard, callback, pairing, voice/foto, rate limit) | ✅ ditulis 2026-10-28 dari teks asli `core.telegram.org` (Bot API, FAQ, webhooks, features); butir ⚠️ di §13 skill harus diuji sebelum diandalkan |
| ~~Skill Telegram pihak ketiga~~ | Kirim pesan/pengingat Telegram via Convex | ❌ **ditolak** (keputusan D-004): satu arah, tanpa tombol interaktif, butuh deploy key Convex production, 1 commit, lisensi tidak jelas |

## Jangan membuat dokumen markdown berserakan

Dokumen baru di luar `docs/00`–`06`, `docs/09`, `docs/BRD.md`, `docs/brd/*`, `docs/PRD.md`, `docs/ERD.md`, `docs/PLAN.md`, `docs/DECISIONS.md`, `CHANGELOG.md`, `README.md` hanya dibuat jika diminta owner. Laporan dan catatan sementara tidak masuk repo.

## Cara melanjutkan di sesi baru

Konteks ada di repo ini, bukan di riwayat chat. Urutan baca: `CLAUDE.md` (ini) → `docs/PLAN.md` (status, pemilik modul, keputusan terbuka) → `docs/DECISIONS.md` → dokumen tahap yang sedang berjalan (BRD/PRD/ERD) → `docs/09-breakdown-fitur.md` → skill di `.claude/skills/`. Update `docs/PLAN.md` di commit yang sama dengan perubahan.
