# PLAN — status, jadwal, pemilik

Terakhir diperbarui: 2026-10-28. Diperbarui di commit yang sama dengan perubahan.

## 1. Tahap dokumen

| Tahap | Dokumen | Status |
|---|---|---|
| Konsep | `docs/00`–`05`, `09`, DECISIONS | ✅ disetujui owner 2026-10-28 |
| BRD | `docs/BRD.md` (induk) + `docs/brd/BRD-Mxx-*.md` (14 modul; indeks `docs/brd/README.md`) | ✅ disetujui owner 2026-10-28 (v0.1.0) |
| PRD | `docs/PRD.md` | ✅ disetujui owner 2026-10-28 (v0.1.0) |
| ERD | `docs/ERD.md` | ✅ disetujui owner 2026-10-28 (v0.1.0) |
| Skill integrasi | `meta-model-api-integration`, `telegram-bot-integration` | ✅ ditulis 2026-10-28 (butir ⚠️ di akhir tiap skill belum diuji) |
| Coding | | 🟢 **terbuka** (BRD+PRD+ERD disetujui 2026-10-28); mulai Gelombang 1 |

PRD dan ERD disusun berurutan; persetujuan tetap per tahap.

## 1a. Status implementasi (diperbarui setiap kali kode berubah)

| Area | Status | Catatan |
|---|---|---|
| M14 Design system | 🚧 | token, Tailwind v4, komponen form, `Button`, `ThemeToggle`, `LocaleSwitch`, `Panel`, `Meter`, gaya tabel responsif, kerangka aplikasi (sidebar berkelompok, bilah atas, pencarian dan pintasan ⌘K, menu akun, tampilan HP; D-039), beranda dasbor (baris keuangan, banner jatuh tempo, grafik diterima vs ditagihkan dengan sumbu, komposisi deployment, kalender operasional, daftar menunggu tindakan; semua dari data nyata; tautan ke halaman tagihan baru aktif setelah M03 punya halamannya, bendera `BILLING_PAGES_READY` di `src/lib/nav.ts`), bilah atas dengan judul, tanggal, dan lonceng, `PageHeader`, tombol dan kartu datar bergaya modern, galeri `/dev/komponen`; sisa: `Modal`, `Toast`, komponen `Table` penuh dengan urut dan filter, dst. (PRD §4 M14) |
| Skema DB (ERD) | 🚧 | kelompok `auth_org` dan `ai_core` **diterapkan ke DB dev**; kelompok `action_center` (`findings`, `approvals`, `briefings`, migrasi `0004`) dan `billing` (migrasi `0006`–`0007`) **diterapkan ke DB dev** (2026-10-28, dicocokkan dengan ERD §3.3 dan §5); 5 kelompok lain ⬜ |
| M01 Registrasi dan login | ✅ | registrasi atomik, login/keluar, middleware sesi, `AppShell` dasar; diuji (tes + browser) |
| M01 Pengguna dan pengaturan | 🚧 | layanan pengguna dan matriks izin selesai; sisa: halaman Pengguna dan Pengaturan Organisasi, wajib ganti kata sandi awal, E2E Playwright |
| M15 Audit dan guardrail | 🚧 | selesai: tabel, penjaga DB, `recordAudit` dalam transaksi, `automation.once` (`src/domain/automation/once.ts`), keputusan persetujuan atomik (`decideApproval`, `src/domain/action-center/approvals.ts`), kedaluwarsa persetujuan. Sisa: halaman audit `/app/audit` |
| M02 Portfolio | ✅ | DB (`products`, `packages`, `clients`, `deployments`, migrasi `0005`), service dengan audit dan izin per peran, endpoint `/api/products`, `/api/clients`, `/api/deployments`, `/api/packages`, UI (`/app/produk`, `/app/produk/:id`, `/app/klien`, `/app/klien/:id` dengan tampilan 360°), tool asisten (`list_clients`, `get_client_overview`, `list_products`, `get_product_packages`, `list_deployments`), data seed (`pnpm db:seed`), diuji dengan tes dan di browser. **Batas jujur:** tampilan 360° baru memuat deployment dan riwayat perubahan; langganan, invoice, tugas, dan lead bergabung saat M03 sampai M05 dibangun. M03 wajib memperluas `src/domain/portfolio/history.ts` (hapus klien/produk yang punya tagihan ditolak, BR-M02-08) |
| M03 Billing | ✅ | DB (`subscriptions`, `invoices`, `invoice_items`, `payments`, `number_counters`, migrasi `0006`–`0007`: pembayaran append-only, isi invoice terkunci setelah terkirim), service (`calculateTotals`, draf/kirim/batal invoice dengan nomor berurutan, ledger pembayaran dan koreksi, langganan, penjadwal `generateRenewalDrafts` idempoten, ringkasan keuangan dan kalender), kondisi turunan (lewat jatuh tempo, sisa), riwayat klien/produk/deployment, endpoint `/api/invoices/*`, `/api/subscriptions/*`, `/api/billing/options`, `/api/dashboard/calendar`, PDF (`GET /api/invoices/:id/pdf`, D-040), UI (`/app/invoice`, `/app/invoice/baru`, `/app/invoice/:id`, `/app/langganan`, `/app/langganan/:id`, tagihan di 360° klien), tool asisten (`get_billing_summary`, `list_invoices`, `get_invoice`, `list_subscriptions` bertingkat `read`; `draft_invoice` bertingkat `draft`), data demo fiktif lewat `pnpm db:seed`, migrasi diterapkan ke DB dev; diuji dengan tes (termasuk konkurensi nomor dan penjaga DB) dan di browser (draf, kirim, pelunasan, PDF, pembatasan Staf). Penjadwal berjalan di proses server (`src/server/ticker.ts`: tiap 60 detik, kunci advisory, per organisasi pada jam penjadwalnya) dan menjalankan `renewal_draft` serta `invoice_overdue` lewat `automation.once`; event keluar sebagai baris `findings` (`invoice_draft_ready`, `invoice_overdue`) yang ditampilkan M08. PDF memakai font IBM Plex Sans yang disematkan. **Batas jujur:** `grace_days` belum dipakai (BRD belum menjelaskan efeknya, kemungkinan untuk pengingat lanjutan di M08); belum ada E2E Playwright untuk alur tagihan |
| M04 Pipeline | 🚧 | DB (`leads`, `tasks`, migrasi `0008`), service (`src/domain/pipeline`: transisi tahap, kalah wajib alasan, draf AI, konversi ke klien dengan checklist onboarding, nilai pipeline, lead stagnan), endpoint `/api/leads/*`, UI (`/app/pipeline` papan seret-lepas dengan tombol pindah, `/app/lead/:id` dengan ubah, arsip, konversi, tautkan ke klien yang sudah ada, buka kembali); diuji dengan tes dan di browser (buat lead, pindah lewat tombol dan seret, tandai menang, konversi ke klien). **Sisa:** tool asisten untuk lead (`convert_lead_to_client` sebagai `act`), rule `lead_stagnant` di M08, penetapan penanggung jawab lead di UI (belum ada daftar pengguna), alur Kalah dan Buka kembali belum diuji di browser, E2E Playwright. Aturan transisi tahap masih default ⚠️ PERLU KEPUTUSAN OWNER |
| M05 Tasks dan maintenance | ⬜ | |
| M06 Dokumen | ⬜ | proposal, quotation, notulen |
| M07 AI Core | ✅ | DB (`ai_runs`, `ai_budgets`, `approvals`), service dan endpoint (`/api/ai/*`), UI (`/app/asisten`, `/app/ai`), AI dengan grounding ketat, dan asisten web; diuji dengan tes, API Meta sungguhan, dan di browser (chat, tolak pertanyaan umum, ubah anggaran, blokir saat habis, riwayat). **Batas jujur:** tool data bisnis (klien, invoice, lead) menyusul bersama M02 sampai M05, RAG menyusul bersama dokumen M06 dan notulen M09 (D-038), chatbot Telegram ada di M11 |
| M08 Action Center | 🚧 | rule `renewal_upcoming` (baru) bersama `invoice_overdue` dan `invoice_draft_ready` dari M03, semuanya lewat `automation.once`; kartu temuan dengan angka dibaca langsung dari invoice/langganan (BR-M08-03), prioritas rumus tetap (`src/domain/action-center/facts.ts`), status Baru/Ditangani/Diabaikan/Ditunda/Selesai sendiri (sapuan otomatis tiap menit), penjelasan dan draf pesan AI disimpan sekali per temuan dengan grounding ketat (tool `get_finding_facts`), usulan `mark_invoice_sent` menjadi persetujuan `Menunggu` dengan argumen persis, keputusan atomik (satu pemenang web/Telegram), validasi ulang izin dan data saat diputuskan, kedaluwarsa dari pengaturan organisasi, briefing harian (angka dari service dasbor, narasi AI dibuang bila angkanya tidak cocok); endpoint `/api/action-center`, `/api/findings/*`, `/api/approvals/:id/decide`, `/api/briefing`; UI `/app/action-center`, `/app/briefing`, lonceng dan lencana sidebar; penjadwal menjelaskan maks 3 temuan baru per hari dan menulis briefing pada jam briefing; 23 tes (unit + integrasi DB, semua poin §10 BRD-M08). **Batas jujur:** `task_late` dan `lead_stagnant` menunggu M05/M04; kanal Telegram menunggu M11; rumus prioritas masih default ⚠️ (D-043); sudah diuji manual di browser dengan API Meta sungguhan (2026-10-28: kartu temuan, penjelasan dan draf AI, tandai ditangani, tunda, briefing, lencana yang ikut diperbarui). **Belum**: alur persetujuan `mark_invoice_sent` di browser dan E2E Playwright (Playwright belum terpasang di repo; syarat DoD sebelum ✅) |
| M09 Rapat | ⬜ | STT, notulen, draf lead/task |
| M10 Marketing Studio | ⬜ | gambar dan caption |
| M11 Telegram | 🚧 | selesai: klien Bot API (`src/integrations/telegram`) dengan retry flood control, verifikasi secret webhook, `callback_data` persetujuan, kode pairing (hanya hash disimpan), pembantu teks HTML, parser update; 40 tes tanpa jaringan. Sisa: endpoint webhook, layanan pairing dan tautan (DB), kartu temuan, keputusan persetujuan, voice note dan foto, skrip `bot:webhook` dan `bot:dev` |
| M12 Dashboard | ⬜ | |
| Deploy live | 🚧 | `https://ai-business.asiifdev.com` aktif tetapi **masih menjalankan dev server**; perlu `pnpm build` + `pnpm start` di belakang proxy HTTPS (README, bagian Deploy) dan migrasi pada DB server |
| M16 Landing dan situs pemasaran | 🚧 | selesai: fondasi SEO/GEO/AEO dan tes build, 17 halaman EN dan ID, GA4 dengan persetujuan, beranda modern (hero beranimasi, cara kerja interaktif, bento, kalkulator harga, pita penutup). Sisa: berkas logo resmi, ID GA4 dan kunci Turnstile dari owner, kunci klaim fitur di hari terakhir, audit `hallmark`, uji Lighthouse |
| Skill `meta-model-api-integration`, `telegram-bot-integration` | ✅ | ditulis 2026-10-28 dari teks asli dokumentasi resmi; butir ⚠️ di akhir tiap skill belum diuji |

## 2. Jadwal (WIB)

Target awal ("BRD 29 Okt, ERD 30 Okt, coding mulai 30 Okt") **dipercepat**: konsep, BRD, PRD, dan ERD disetujui seluruhnya pada **28 Okt**.

| Tanggal | Target |
|---|---|
| 28 Okt | ✅ Konsep, BRD, PRD, ERD disetujui; pustaka komponen form; uji STT nyata; **coding Gelombang 1 dimulai** |
| 29 Okt | Gelombang 1: skema dan migrasi, auth, audit, AppShell; skill Meta dan Telegram |
| 30 Okt – 2 Nov | Gelombang 2 (M02–M05) dan Gelombang 3 (M07–M12), urutan di `docs/PRD.md` §12 |
| 2 Nov | Deploy live, E2E |
| 3 Nov | Video 3 menit, README, post X |
| 4 Nov | Buffer + submit sore WIB (batas 5 Nov 09:00 WIB) |

Opsi percepatan (izin owner diberikan 2026-10-28, D-021): Jalur B mengerjakan **design system + pustaka komponen form** (M14) selama BRD/PRD/ERD berjalan, karena tidak bergantung pada ERD.

## 3. Pemilik modul

| Jalur | Modul | Pemilik |
|---|---|---|
| A | M01, M02, M03, M04, M05, M12, M15 | owner (jalur A) |
| B | M07, M08, M09, M10, M11, M14 | owner (jalur B) |
| Bersama | M06 (engine di A, narasi AI di B) | sesi A + B |

Selama D-018 belum berubah, kedua jalur dipegang owner. Nama developer baru diisi hanya jika orang itu approved.

## 4. Blocker dan pertanyaan terbuka untuk owner

1. ~~Akses Meta Model API~~ — **API terbukti jalan** (uji 2026-10-28, `docs/02` §0).
2. ~~Jumlah kontributor~~ — hanya peserta approved yang boleh terlibat (D-018, dikonfirmasi forum). **Owner memutuskan solo dengan scope penuh**, dua jalur kerja paralel. Risiko: scope penuh solo dalam ±4 hari coding; mitigasi: urutan gelombang BRD (yang paling akhir dipangkas lebih dulu) dan fallback Telegram ke minimal.
3. ~~Hosting live~~ — satu server + PostgreSQL + `ffmpeg`, domain `ai-business.asiifdev.com`, berkas di Cloudflare R2 (D-007, D-023).
4. ~~Bahasa UI~~ — ID/EN dengan pengalih (D-013).
5. Pemilahan modul MVP (D-014), ditentukan saat BRD.
6. ~~Draf skema~~ — dihapus, database kosong (D-006). Skema baru hanya setelah ERD disetujui.
7. Snapshot docs Tailwind: owner menjalankan sendiri skrip sinkronisasi dan menerima lisensinya.
8. Keputusan embedding: apakah perlu provider non-Meta (`docs/02` §4).
9. Jadwal: owner menilai 4 hari cukup untuk coding (30 Okt – 2 Nov).

## 5. Risiko utama

| Risiko | Mitigasi |
|---|---|
| Scope terlalu besar untuk ±7 hari | Pemilahan MVP di BRD; M11 bisa turun ke minimal |
| Kemampuan model belum teruji | Uji sebelum PRD dikunci; provider palsu untuk tes |
| Pelanggaran aturan "kerja baru" | Repo bersih, commit sejak 28 Okt, tanpa salin kode |
| Kontributor di luar daftar approved | Hanya owner (approved) yang commit; periksa `git log` sebelum submit |
| Biaya AI/loop agen | Batas putaran, token, dan anggaran harian |
| Data nyata bocor ke repo public/model | Hanya seed palsu; contributor mode untuk data palsu saja |
