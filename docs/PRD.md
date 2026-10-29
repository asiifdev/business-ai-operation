# Product Requirements Document (PRD)

| | |
|---|---|
| **Status** | ✅ Disetujui owner (2026-10-28), v0.1.0 |
| **Tanggal** | 2026-10-28 |
| **Dasar** | BRD induk dan 14 BRD modul (disetujui owner 2026-10-28), `docs/02`, `docs/03`, `docs/05`, `docs/DECISIONS.md` |
| **Tahap berikutnya** | `docs/ERD.md` (draf v0.1.0 ditulis, menunggu review) |

> PRD menjawab **"bagaimana produk berperilaku"**: halaman, endpoint, layanan, state, job, dan kontrak AI/Telegram. Aturan bisnis **tidak diulang**; PRD merujuk ID-nya (`BR-Mxx-nn`, `CR-nn`). Skema tabel dan kolom ada di ERD, bukan di sini. Item bertanda ⚠️ menunggu keputusan owner; PRD tidak mengisi asumsi diam-diam, hanya memberi **default** yang jelas dan dapat diganti.

## 0. Keputusan yang dikunci di PRD

| ID | Keputusan | Dasar |
|---|---|---|
| D-009 | **Auth: Better Auth** (email + kata sandi), dipasang di route Astro `/api/auth/[...all]`, adaptor Drizzle (PostgreSQL), sesi dibaca di middleware Astro dan ditaruh di `Astro.locals`. `org_id` dan `role` disimpan sebagai kolom tambahan pada pengguna (satu pengguna = satu organisasi, BR-M01-02); **plugin organization tidak dipakai** (lebih banyak tabel dari yang dibutuhkan) | Dokumentasi Better Auth (integrasi Astro dan Drizzle) dibaca 2026-10-28. ⚠️ Nama paket adaptor Drizzle diverifikasi saat `pnpm add` |
| D-010 | **Bot Telegram: grammY**, webhook lewat `webhookCallback` dengan `secretToken`, handler `callbackQuery` untuk tombol, `message:voice` untuk voice note (unduhan maks 20 MB, di bawah batas STT 32 MB) | Dokumentasi grammY dibaca 2026-10-28. ⚠️ Nama adaptor Astro pada `webhookCallback` diverifikasi saat implementasi; cadangan: adaptor `std/http` (Fetch) di route Astro |
| D-008 | **Job: tabel `jobs` di PostgreSQL** diambil worker dalam proses server yang sama (`FOR UPDATE SKIP LOCKED`), ditambah **ticker penjadwal** yang hanya aktif pada satu proses lewat `pg_try_advisory_lock`. Tanpa Redis, tanpa layanan tambahan | Menjaga jumlah infrastruktur minimal untuk satu server live; idempotensi tetap lewat `automation_runs` (BR-M15-04) |
| D-011 | Isolasi tenant: **filter `org_id` wajib di lapisan repositori** (tidak ada query tanpa `org_id`), diuji dengan dua organisasi seed. RLS Postgres diputuskan di ERD | BR-M01-01, CR-02 |
| D-022 | **Pembuatan PDF: `@react-pdf/renderer`** (memakai React yang sudah ada, font disematkan); ikon berupa SVG inline buatan sendiri. Cadangan: `pdfkit` | Diterima owner 2026-10-28; BR-M03-15. ⚠️ Dokumentasi dibaca ulang saat implementasi M03 |
| D-023 | **Penyimpanan berkas** (rekaman, gambar, PDF): **Cloudflare R2** lewat klien S3 (`@aws-sdk/client-s3`, endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, region `auto`), **bucket privat**, metadata di tabel `files`. Unggahan lewat server aplikasi (bukan presigned PUT) agar tipe MIME dan ukuran diperiksa di server; unduhan lewat route yang memeriksa sesi dan `org_id` (stream, atau presigned GET ≤ 5 menit). Driver diganti dengan `STORAGE_DRIVER=r2\|disk` (disk untuk tes/lokal). Job STT mengunduh berkas ke folder sementara, mengonversi dengan `ffmpeg`, lalu menghapus salinan sementara | Pilihan owner 2026-10-28. Dokumentasi R2 (S3 API dan presigned URL) dibaca 2026-10-28. ⚠️ Paket `@aws-sdk/*` diverifikasi saat install |
| D-024 | **Waktu lewat satu `Clock`** (`now()` yang dapat diganti di tes) dan zona waktu organisasi; tidak ada `new Date()` langsung di layanan domain | Tes scheduler deterministik (CR-10) |

**Default PRD atas pertanyaan terbuka BRD** (BRD disetujui, jawaban atas ⚠️ di bawah ini mengikuti usulan BRD; bila owner ingin lain, cukup revisi BRD modulnya):

| Pertanyaan | Default PRD |
|---|---|
| Pajak (BR-M03-17) | Tarif per organisasi, default **0%**; bila > 0 tampil sebagai baris terpisah di layar dan PDF |
| Kanal kirim ke klien | **Tidak ada pengiriman keluar di MVP.** "Tandai terkirim" + **unduh PDF** + **salin teks pesan**. Tautan publik bertanda tangan ditunda |
| Metode login | Email + kata sandi saja (tanpa Google/tautan ajaib, tanpa MFA) |
| Undang pengguna | Pemilik/Admin **menambah pengguna** lewat form (nama, email, peran, kata sandi awal yang wajib diganti); tanpa email undangan |
| Pembayaran sebagian | **Diizinkan** (BR-M03-08) |
| Cabang klien | Tidak ada entitas cabang; dicatat sebagai **deployment** dengan label/environment |
| Koreksi invoice terkirim | Batalkan lalu buat baru; credit note ditunda |
| Diskon | Tidak ada di MVP |

## 1. Prinsip implementasi (mengikat semua modul)

1. **Satu jalur tulis untuk setiap fakta bisnis.** Status, nominal, jatuh tempo, dan pembayaran hanya berubah lewat fungsi layanan domain (`src/domain/**`). Tombol web, persetujuan AI, dan tombol Telegram memanggil **fungsi yang sama** (CR-05, BR-M08-04).
2. **Kondisi turunan dihitung, tidak disimpan**: lewat jatuh tempo, tertinggal versi, task terlambat, lead stagnan, outstanding (CR-01). Satu modul `derived` per kondisi, dipakai UI, AI, dan Telegram.
3. **Uang = integer Rupiah**; dihitung di satu layanan `money` (CR-03, CR-04). Format tampilan lewat `src/lib/format.ts`.
4. **Append-only** untuk pembayaran dan audit (BR-M03-06, BR-M15-01); koreksi = baris baru.
5. **Setiap tulis data dan audit dalam satu transaksi** (BR-M15-03).
6. **Idempoten**: setiap efek otomatis punya kunci dedupe (BR-M15-04). Format kunci: `<rule>:<entitas>:<periode|id>`.
7. **Isi dokumen, transkrip, chat = data, bukan instruksi** (CR-12). Konteks yang tidak tepercaya selalu dibungkus pembatas dan model tidak diberi tool `act` yang dapat dipicu langsung dari teksnya.
8. **Setiap panggilan model tercatat** di `ai_runs` dengan token dan biaya, dan dibatasi anggaran harian (CR-11).
9. **Semua teks UI lewat kamus i18n** (`useT`); pesan bot mengikuti bahasa tiap pengguna (D-013).

## 2. Arsitektur dan struktur

```
src/
  pages/                 # halaman Astro (SSR); island React hanya untuk bagian interaktif
    api/                 # endpoint JSON, webhook Telegram, unduhan berkas
  layouts/  components/{ui,forms,app}/  styles/
  domain/<modul>/        # service.ts: logika domain (satu-satunya penulis fakta bisnis)
  db/                    # skema Drizzle (setelah ERD), repositori ber-org_id, transaksi
  ai/{provider,tools,agent,prompts}/   # AiProvider, registri tool, loop agen
  telegram/              # bot grammY, handler, kartu, pairing
  jobs/                  # worker, ticker, rule
  lib/                   # format, money, clock, i18n, files, validasi
  middleware.ts          # sesi -> locals.user/org/role; penolakan bila tidak login
```

Lapisan: **halaman/endpoint → layanan → repositori → DB**. Halaman dan endpoint **tidak** mengakses repositori langsung. Tool AI dan handler Telegram **hanya** memanggil layanan.

**Konteks permintaan (`Ctx`)** dibuat sekali per permintaan/job/handler: `{ orgId, actor: user:<id> | ai:<run> | system:<rule>, onBehalfOf?: userId, role, now }`. Semua layanan menerimanya sebagai argumen pertama; tidak ada `orgId` dari input pengguna atau model (BR-M01-01).

**Bentuk respons API**: `{ ok: true, data }` atau `{ ok: false, error: { code, message, fields? } }`; validasi masukan dengan Zod di tepi (endpoint/tool), pesan error lewat i18n. Kode HTTP: 400 validasi, 401 belum login, 403 izin, 404 tidak ada/bukan milik org (tanpa membocorkan keberadaan), 409 transisi tidak valid atau persetujuan sudah diputuskan, 429 batas laju/anggaran.

## 3. Peran dan izin (BR-M01-04)

Ditegakkan di **layanan** (`can(ctx, aksi)`), bukan hanya di UI. ✅ boleh · ◐ terbatas · ❌ tidak.

| Aksi | Pemilik | Admin | Staf |
|---|---|---|---|
| Kelola pengguna, peran, pengaturan org, anggaran AI | ✅ | ◐ (pengguna, bukan Pemilik; tanpa anggaran) | ❌ |
| Produk, paket, klien, deployment (lihat) | ✅ | ✅ | ✅ (**harga paket terlihat**, diputuskan owner) |
| Produk, paket, klien, deployment (ubah) | ✅ | ✅ | ❌ |
| Subscription, invoice, pembayaran (lihat) | ✅ | ✅ | ❌ |
| Subscription, invoice, pembayaran (ubah/catat) | ✅ | ✅ | ❌ |
| **Menyetujui aksi keuangan** (`mark_invoice_sent`) | ✅ | ✅ | ❌ |
| Lead, pipeline | ✅ | ✅ | ◐ (lihat, ubah yang ditugaskan) |
| Task | ✅ | ✅ | ◐ (buat; ubah dan tutup **milik sendiri**) |
| Dokumen (draft) | ✅ | ✅ | ◐ (lihat) |
| Finalisasi dokumen, konversi lead | ✅ | ✅ | ❌ |
| Action Center (lihat) | ✅ | ✅ | ◐ (hanya temuan non-keuangan) |
| Rekaman rapat dan notulen | ✅ | ✅ | ◐ (unggah dan lihat milik sendiri) |
| Marketing Studio | ✅ | ✅ | ✅ |
| Dashboard | ✅ | ✅ | ◐ (tanpa angka keuangan) |
| Audit | ✅ | ◐ (hanya audit non-keuangan) | ❌ |
| Telegram: tautkan akun sendiri | ✅ | ✅ | ✅ (kemampuan mengikuti peran, BR-M01-08) |

## 4. Spesifikasi per modul

Setiap bagian: **halaman**, **layanan/endpoint**, **state dan validasi**, **job**, **uji**. Kriteria penerimaan lengkap ada di BRD modul (§10) dan menjadi dasar uji E2E.

### M01 Organisasi, auth, peran (BRD-M01)

- **Halaman:** `/login`, `/register` (membuat organisasi + Pemilik), `/app/settings/organisasi`, `/app/settings/pengguna`, `/app/settings/profil` (ganti kata sandi, bahasa).
- **Endpoint:** `/api/auth/*` (Better Auth); `POST /api/settings/org`, `POST/PATCH /api/users`, `POST /api/users/:id/deactivate`.
- **Perilaku:** middleware memuat sesi; tanpa sesi → redirect `/login`; pengguna nonaktif → sesi dicabut seketika (BR-M01-06). Batas laju login per IP+email, pesan gagal seragam (BR-M01-09). Pemilik terakhir tidak dapat diturunkan/dinonaktifkan (BR-M01-03). Perubahan peran, pengaturan org, dan penonaktifan masuk audit (BR-M01-11).
- **Pengaturan org (nilai awal, BR-M01-07):** mata uang `IDR`, zona waktu `Asia/Jakarta`, hari tenggang 7, offset draf invoice 7 hari, jam scheduler 08:00, format nomor `INV-YYYY-NNNN`, tarif pajak 0%, info pembayaran (bank, nama, rekening), jam briefing, **anggaran AI harian per fitur**, **hari stagnan lead** (14), dan **kedaluwarsa persetujuan** (24 jam). Semua dapat diubah Pemilik (D-025).
- **Seed demo:** dua organisasi palsu (untuk uji isolasi), menolak jalan di `NODE_ENV=production` (BR-M01-10).
- **Uji:** isolasi dua org di UI/endpoint/tool/Telegram; staf ditolak di layanan; pemilik terakhir; seed menolak produksi.

### M15 Audit dan guardrail (BRD-M15)

- **Halaman:** `/app/audit` (daftar entri dengan filter pelaku/entitas/tanggal), garis waktu per entitas di halaman detail.
- **Layanan:** `audit.record(tx, ctx, {aksi, entitas, id, ringkasan})` dipanggil **di dalam transaksi** perubahan (BR-M15-03). `automation.once(ctx, rule, kunci, fn)` menjalankan `fn` hanya bila kunci belum ada (BR-M15-04). `approvals.create/decide`, `aiRuns.record/sumToday(fitur)`.
- **Aturan:** tidak ada endpoint ubah/hapus audit; ringkasan tidak memuat rahasia atau isi dokumen penuh (BR-M15-06); `decide` idempoten: `UPDATE ... WHERE status='Menunggu'` dan memeriksa jumlah baris (BR-M15-08).
- **Uji:** tidak ada jalur ubah/hapus; rule dijalankan dua kali menghasilkan satu efek; keputusan ganda paralel hanya satu menang.

### M14 Design system (BRD-M14)

Sebagian sudah dibangun (token terang/gelap, form components, `Button`, `ThemeToggle`, `LocaleSwitch`, galeri `/dev/komponen`, D-021). Sisa untuk PRD ini:
- **Komponen UI yang belum ada:** `Card`, `Badge`, `Alert`, `Modal`, `Dropdown`, `Toast`, `Table` (+ toolbar pencarian/filter/baris per halaman, pagination), `Stat`, `Tabs`, `EmptyState`, `Skeleton`, `ApprovalCard`, `AuditTimeline`, `AppShell` (navigasi samping, header, pengalih bahasa/tema).
- **Aturan:** token di `:root` (BR-M14-01), tanpa kontrol mentah (dijaga tes yang sudah ada), tabel dan kartu memakai angka dari layanan.
- **Ikon:** ⚠️ pustaka belum dipilih; default PRD: SVG inline buatan sendiri untuk ikon yang dipakai (tanpa dependensi).

### M02 Portfolio (BRD-M02)

- **Halaman:** `/app/produk` (daftar), `/app/produk/:id` (detail + paket + deployment), `/app/klien`, `/app/klien/:id` (**tampilan 360°**: deployment, subscription, invoice, task, lead terkait, jejak audit).
- **Layanan:** `products.*`, `packages.*` (harga integer ≥ 0, BR-M02-02), `clients.*` (nama unik tak peka huruf, BR-M02-10), `deployments.*` (unik produk+klien+environment, BR-M02-04). Arsip alih-alih hapus bila ada tagihan (BR-M02-08).
- **Turunan:** `isBehind(deployment, product)` membandingkan semver (BR-M02-05, BR-M02-06); versi bukan semver ditandai "tak terbandingkan".
- **Larangan:** tidak ada kolom kata sandi/token/env **aplikasi klien** pada deployment (BR-M02-07, diamandemen 2026-10-29). Repo, branch, server, folder, commit terpasang, dan status uptime ditambahkan oleh M17.
- **Uji:** dua paket per produk; tertinggal versi dihitung; hapus klien bertagihan ditolak; ubah harga paket tidak mengubah invoice lama (BR-M02-11).

### M03 Billing (BRD-M03)

- **Halaman:** `/app/langganan` (+ detail), `/app/invoice` (daftar dengan filter "lewat jatuh tempo"), `/app/invoice/:id` (detail, item, pembayaran, riwayat, unduh PDF, salin teks pesan), `/app/invoice/baru`.
- **State invoice:** `Draft → Terkirim → Lunas`, `Draft → Batal`, `Terkirim → Batal` (BR-M03-03). Transisi lain 409. **Lewat jatuh tempo** = `due_date < today(org) AND status = Terkirim` (turunan).
- **Layanan:**
  - `billing.calculateTotals(items, taxRate)` satu-satunya penghitung total.
  - `invoices.createDraft/updateDraft/markSent/cancel`; `markSent` mengunci isi (BR-M03-04) dan memberi **nomor berurutan** lewat penghitung per (org, tahun) yang diambil dengan `UPDATE ... RETURNING` di dalam transaksi (tanpa celah, BR-M03-05).
  - `payments.record(invoiceId, {jumlah, tanggal, metode})` menambah baris; setelah itu layanan menghitung Σ pembayaran dan **hanya layanan** yang memindahkan invoice ke `Lunas` serta memajukan jatuh tempo subscription sesuai interval (BR-M03-07). Koreksi = baris `koreksi`.
  - `subscriptions.create/stop`; nominal baru berlaku untuk invoice berikutnya (BR-M03-13).
- **PDF:** `GET /api/invoice/:id/pdf` merender dari data tersimpan: identitas organisasi, klien, nomor, tanggal, item, subtotal, pajak (bila > 0), total, jatuh tempo, info pembayaran (BR-M03-15). Nominal **identik** dengan layar karena dipanggil dari `calculateTotals`.
- **Job (lihat §7):** `rule.renewal_draft` (draf invoice ≤ 7 hari sebelum jatuh tempo, idempoten per subscription+periode, BR-M03-09), `rule.invoice_overdue` (satu event per invoice, BR-M03-12).
- **Tanggal akhir bulan:** jatuh tempo bulan pendek memakai hari terakhir bulan itu (default usulan BRD).
- **Uji:** semua poin §10 BRD-M03, ditambah uji konkurensi nomor invoice (dua transaksi paralel menghasilkan nomor berbeda dan berurutan).

### M04 Pipeline (BRD-M04)

- **Halaman:** `/app/pipeline` (kanban seret-lepas dengan alternatif papan tombol untuk aksesibilitas), `/app/lead/:id`.
- **State:** `Baru → Penjajakan → Proposal → Negosiasi → Menang | Kalah`; `Kalah` wajib alasan; transisi di luar urutan yang diizinkan ditolak.
- **Layanan:** `leads.*`, `leads.convertToClient(leadId)` membuat klien (atau menautkan bila nama sudah ada), **draf** subscription/deployment, dan task onboarding (checklist). Pemanggilan dari AI = tool `act` (`convert_lead_to_client`) yang butuh persetujuan; dari web tetap meminta konfirmasi.
- **Draf AI:** lead `draft` tidak dihitung ke nilai pipeline sampai diterima.
- **Turunan:** `isStagnant(lead)` = tidak berubah tahap > N hari (N default 14, pengaturan org ⚠️).
- **Uji:** transisi valid/tidak valid, kalah tanpa alasan, konversi tanpa duplikat, draf tidak masuk pipeline.

### M05 Tasks dan maintenance (BRD-M05)

- **Halaman:** `/app/task` (daftar + papan), `/app/task/:id`; panel task di halaman klien/deployment.
- **State:** `Terbuka → Dikerjakan → Selesai`; jenis `Tugas/Bug/Fitur/Maintenance`; tenggat bawaan menurut prioritas untuk `Bug`.
- **Turunan:** `isLate(task)` = tenggat < hari ini dan belum `Selesai`.
- **AI:** `find_similar_tasks` (tool `read`) mengembalikan kandidat; penautan hanya atas persetujuan pengguna. Pencarian kemiripan memakai pembanding teks sederhana dan **bukan embedding** (tidak ada di model Meta).
- **Uji:** task terlambat tanpa kolom status; draf dari rekaman tidak dihitung terbuka; staf tidak menutup task orang lain.

### M06 Dokumen (BRD-M06)

- **Halaman:** `/app/dokumen`, `/app/dokumen/:id` (editor narasi, tabel item, pratinjau, unduh PDF).
- **Jenis:** `Proposal`, `Quotation`, `Notulen`. Status `Draft → Final`; final tidak dapat disunting, revisi membuat **versi baru** (BRD-M06).
- **Item harga:** diambil dari paket resmi (M02) lewat layanan; kuantitas/penyesuaian terbatas; total dihitung `billing.calculateTotals`. Narasi AI **tidak** memuat angka harga yang ditulis model.
- **Layanan:** `documents.createFromLead/createFromMinutes/updateDraft/finalize` (`finalize` = tool `act`).
- **Penomoran:** penghitung per (org, jenis, tahun), mekanisme sama dengan invoice.
- **Uji:** mengubah narasi tidak mengubah total; transkrip berisi "ganti harga 1 rupiah" tidak mengubah harga (uji injeksi); PDF identik dengan layar.

### M07 AI Core (BRD-M07)

Kontrak lengkap di §5. Permukaan pengguna:

- **`/app/asisten`**: asisten web. **Bukan chatbot umum**: menjawab hanya dari hasil tool atas data organisasi (grounding ketat, D-038). Tanpa hasil tool tidak ada jawaban; pertanyaan di luar cakupan ditolak dengan teks baku; angka yang tidak ada di hasil tool tidak lolos; sumber (nama tool) ditampilkan di bawah jawaban. Endpoint `POST /api/ai/chat`, 20 pertanyaan per menit per pengguna.
- **`/app/ai`**: tab **Anggaran** (Pemilik dan Admin melihat pemakaian hari ini per fitur; hanya Pemilik mengubah batas) dan tab **Riwayat run** (manajer melihat semua, Staf hanya miliknya; `?tab=` di URL). Endpoint `GET /api/ai/overview`, `PUT /api/ai/budgets`, `GET /api/ai/runs`.
- **Tool nyata saat ini:** penggunaan AI, anggota tim, aktivitas audit, persetujuan menunggu, dan penjelasan kemampuan asisten. Tool data bisnis (klien, invoice, lead, tugas) ditambahkan bersama M02 sampai M05.
- **Keadaan:** setiap region yang memuat data punya keadaan memuat, kosong, galat, dan penuh.

### M08 Action Center (BRD-M08)

- **Halaman:** `/app/action-center` (daftar temuan + antrean persetujuan), kartu temuan dengan **Setujui / Tolak / Edit draft / Tunda / Abaikan**, `/app/briefing`.
- **State temuan:** `Baru → Ditangani | Diabaikan | Ditunda | Selesai sendiri` (`Baru` ditambahkan PRD sebagai keadaan awal).
- **State persetujuan:** `Menunggu → Disetujui | Ditolak | Kedaluwarsa`; kedaluwarsa default **24 jam** (⚠️ M15/M08). Eksekusi hanya pada `Disetujui`; sebelum eksekusi layanan **memeriksa ulang prakondisi** (mis. invoice sudah `Lunas` → persetujuan ditolak dengan alasan, temuan `Selesai sendiri`).
- **Rule awal** (deterministik, di `src/jobs/rules`): `invoice_overdue`, `invoice_draft_ready`, `renewal_upcoming`, `task_late`, `lead_stagnant`. Setiap rule menerbitkan temuan lewat `automation.once`.
- **Alur kartu:** rule → temuan → agen dipanggil **sekali** untuk penjelasan + draft (hasil disimpan di temuan) → bila ada aksi disarankan, `approvals.create` dengan tool dan argumen persis → pengguna memutuskan di web atau Telegram.
- **Briefing harian:** job pada jam yang diatur; angka dari M12, narasi dari AI; bila anggaran habis, tampil angka saja berlabel "bukan hasil AI" (BR-M08-11).
- **Uji:** poin §10 BRD-M08, termasuk persetujuan paralel web+Telegram dan invoice yang dilunasi sebelum disetujui.

### M09 Meeting Intelligence (BRD-M09)

- **Halaman:** `/app/rapat` (daftar), `/app/rapat/baru` (unggah audio lewat `FileInput`), `/app/rapat/:id` (progres, transkrip per pembicara, pemetaan Pembicara A/B → nama, notulen, draf lead/task/proposal).
- **Alur (job `meeting.process`):** simpan berkas → **konversi ke WAV mono 16-bit 24 kHz dengan `ffmpeg`** (wajib: API menolak m4a/OGG, uji 2026-10-28) → bila > 10 menit **potong** → STT per potongan dengan `mode:"DIARIZATION"` dan `keywords` **hanya nama produk/klien** (biasing berlebih menambah derau, `docs/02` §0); bahasa terdeteksi otomatis → gabung berurutan → Spark membuat **notulen terstruktur** (structured output: ringkasan, keputusan, action item) → ekstraksi lead/task sebagai **draft** dengan kutipan sumber.
- **Konversi dan pemotongan audio:** **`ffmpeg` wajib ada di server live** (✅ terpasang, konfirmasi owner). Tanpanya M09 dan voice note M11 tidak berfungsi (voice note Telegram berformat OGG/Opus juga harus dikonversi). Tanpa timestamp per kata, potongan memakai durasi tetap (mis. 9 menit) dengan sedikit tumpang tindih yang dibersihkan saat digabung.
- **Keamanan:** transkrip dibungkus sebagai data tidak tepercaya; hasil ekstraksi hanya membuat **draft**; tidak ada tool `act` yang terjangkau dari job ini (CR-12).
- **Uji:** rekaman Indonesia ≤ 10 menit, rekaman 25 menit terpotong dan tergabung, injeksi di transkrip, file terlalu besar/format salah, anggaran habis. ✅ STT dasar terbukti (22 dtk Indonesia, HTTP 200, ±5 dtk); ⚠️ masih perlu uji dua pembicara dan rekaman lebih panjang (§10).

### M10 Marketing Studio (BRD-M10)

- **Halaman:** `/app/marketing` (brand kit, pembuat gambar, galeri aset).
- **Alur:** pilih produk + tujuan (peluncuran/promo/edukasi/rilis) → Spark menyusun prompt gambar dari **data produk dan brand kit** → `muse-image-1.0` menghasilkan beberapa varian → pengguna memilih, merevisi dengan instruksi tambahan (versi baru, yang lama tetap) → caption oleh Spark memakai **hanya fakta dari data produk**; harga dari paket resmi.
- **Penyimpanan:** hasil `b64_json` WebP disimpan sebagai berkas dengan penanda "dibuat AI" (BR-M10).
- **Tidak ada** elemen UI untuk video atau suara (CR-17).
- **Uji:** poin §10 BRD-M10, termasuk kuota/anggaran. ⚠️ Edit gambar dengan gambar masukan belum diuji pada API Meta.

### M11 Telegram Assistant (BRD-M11)

Lihat kontrak lengkap di §6.

### M12 Dashboard (BRD-M12)

- **Halaman:** `/app` (dashboard): kartu KPI **MRR**, **Outstanding**, **Lewat jatuh tempo** (nominal + jumlah), **Nilai pipeline**, **Klien aktif**, **Task terbuka/terlambat**; daftar singkat Action Center; tren 6 bulan pendapatan lunas (⚠️ opsional).
- **Layanan:** `metrics.summary(ctx)` **satu-satunya** sumber angka, dipakai dashboard, briefing, Telegram, dan tool `get_business_summary` (CR-06). Draf tidak ikut dihitung. Cache pendek (maks 30 detik) dibolehkan; pencatatan pembayaran membatalkan cache org itu.
- **Uji:** dengan seed yang diketahui angka sama dengan hitungan manual; angka identik di keempat permukaan.

### M16 Landing dan situs pemasaran (BRD-M16)

> ✅ **Revisi PRD disetujui owner (2026-10-28):** bagian ini menambah spesifikasi M16 pada PRD v0.1.0. Tidak ada perubahan pada modul lain dan **tidak ada tabel baru** (ERD tidak berubah).

**Prinsip.** Satu konten untuk manusia dan mesin (BR-M16-18). Semua halaman publik **dirender statis saat build** dengan konten penting di HTML awal (BR-M16-12); JavaScript hanya untuk ilustrasi interaktif, banner persetujuan, dan pengalih bahasa. Tidak ada klaim yang tidak didukung kode (BR-M16-02).

**Routing dan bahasa.** Astro i18n: `defaultLocale: 'en'`, `locales: ['en','id']`, `prefixDefaultLocale: false`. Inggris di `/…`, Indonesia di `/id/…`. Satu templat halaman membaca konten dari `src/content/site/<locale>/<slug>.ts`, jadi kedua bahasa selalu memiliki halaman yang sama (tes menolak halaman yang hanya ada di satu bahasa). Pengalih bahasa di situs publik adalah **tautan ke URL padanan** (bukan keadaan klien). `/` menampilkan landing untuk semua orang; pengguna masuk melihat tombol "Buka aplikasi" (BR-M16-09 usulan). Peta halaman: BRD-M16 Lampiran B. Halaman tak dikenal mengembalikan **404 sungguhan**.

**Struktur berkas**
```
src/config/brand.ts            # nama, tagline, logo, URL situs (D-029)
src/config/site.ts             # URL kanonik dari APP_URL, locale, ID verifikasi/GA dari env
src/content/features.ts        # registri fitur: status + rujukan baris PLAN (BR-M16-02)
src/content/data-practices.ts  # registri praktik data (BR-M16-32)
src/content/pricing.ts         # paket terencana + sumber riset + tanggal (BR-M16-26/27)
src/content/site/{en,id}/*.ts  # konten halaman (judul, jawaban langsung, bagian, FAQ)
src/layouts/MarketingLayout.astro, src/components/marketing/*   # Seo, Header, Footer, Breadcrumbs, FaqList, PricingTable, ConsentBanner, ActionCenterIllustration
src/pages/[...slug].astro, src/pages/id/[...slug].astro         # halaman statis dari konten
src/pages/{robots.txt,sitemap.xml,llms.txt,llms-full.txt,pricing.md}.ts   # berkas penemuan (BR-M16-15/21/22)
```

**Komponen `Seo`** memasang di `<head>`: `title`, `description`, `canonical` absolut, `hreflang` (en, id, x-default), Open Graph dan Twitter, `robots` (indeks/ikuti), JSON-LD `@graph`, dan tag verifikasi Search Console dan Bing bila variabel lingkungan ada. **Data terstruktur per halaman**: semua halaman `Organization` + `WebSite` (tanpa `SearchAction`) + `BreadcrumbList` (halaman anak); `SoftwareApplication` di beranda dan produk (`applicationCategory: BusinessApplication`, `operatingSystem: Web`, **tanpa `offers`** sampai penagihan nyata, BR-M16-23); `FAQPage` di `/faq` dan halaman dengan FAQ yang terlihat, hanya sebagai penanda semantik; `TechArticle` untuk entri changelog bila relevan. Setiap fakta di JSON-LD juga ada sebagai teks terlihat.

**Berkas penemuan**
- `robots.txt`: dihasilkan dari konfigurasi kebijakan perayap (BR-M16-21). Grup `User-agent: *` mengizinkan; grup bernama hanya untuk pengecualian sadar (pelatihan model sesuai keputusan owner); `Disallow` untuk `/app/`, `/api/`, `/login`, `/register`; menunjuk `Sitemap:`.
- `sitemap.xml`: semua halaman publik kedua bahasa, `xhtml:link rel="alternate" hreflang`, `lastmod` dari tanggal pembaruan nyata konten.
- `llms.txt` dan `llms-full.txt`: dihasilkan dari konten halaman yang sama (tanpa teks terpisah); tautan ke keduanya dan ke `pricing.md` dan `sitemap.xml` ada di *footer* (berkas yang tidak ditautkan jarang diambil agen).
- `pricing.md`: paket, harga, batas, dan tanggal sebagai teks mentah, dihasilkan dari `src/content/pricing.ts` sehingga identik dengan halaman `/pricing`.

**Performa dan aset.** Font dihosting sendiri (paket `@fontsource*`), tanpa Google Fonts (juga menghapus transfer data ke Google tanpa persetujuan); gambar lewat `astro:assets` dengan ukuran eksplisit; CSS kritis dari Tailwind; tidak ada pustaka animasi. Target di BRD-M16 BR-M16-16. Logo: berkas resmi di `public/brand/` (menunggu ekspor owner), sementara SVG sederhana bertanda sementara.

**Ilustrasi interaktif `ActionCenterIllustration`.** Menjelaskan empat langkah dengan **data contoh berlabel**: (1) temuan "invoice lewat jatuh tempo", (2) penjelasan dan draf pesan oleh AI, (3) persetujuan manusia (Setujui/Tolak), (4) jejak audit. **Peningkatan progresif:** HTML awal sudah memuat keempat langkah sebagai daftar berurutan yang dapat dibaca mesin dan pengguna tanpa JavaScript; JavaScript menambah kontrol Sebelumnya/Berikutnya/Ulang. Dapat dioperasikan dengan keyboard, tidak berputar otomatis, menghormati `prefers-reduced-motion`, angka diformat lewat `format.ts`.

**Persetujuan dan GA4 (BR-M16-30/31).** `ConsentBanner` (island `client:idle`): tombol Setuju dan Tolak setara, pilihan tersimpan di penyimpanan lokal (kunci tercatat di registri praktik data) dan dapat diubah dari *footer*. Sebelum persetujuan: tidak ada permintaan ke Google. Setelah Setuju: Consent Mode v2 `analytics_storage: granted`, skrip `gtag.js` dimuat dengan ID dari `PUBLIC_GA_MEASUREMENT_ID`. Peristiwa: `cta_click` (tujuan, halaman) dan `signup_start`. Tidak dimuat pada `/app`, `/api`, `/login`, `/register`.

**Pendaftaran terbuka (D-032, BR-M16-35).** `/api/register` mendapat: batas harian total organisasi baru (`REGISTRATION_DAILY_CAP`, default 50), batas per IP (sudah ada), dan verifikasi **Cloudflare Turnstile** (`TURNSTILE_SECRET_KEY` di server, kunci situs publik di formulir) bila kunci tersedia; tanpa kunci, hanya dua batas pertama dan peringatan di log.

**Pemeriksaan otomatis (BR-M16-24)** `tests/seo/*.test.ts`, berjalan atas `dist` hasil `pnpm build` (dilewati bila `dist` belum ada; `pnpm verify` = build + semua tes):
1. per halaman: satu `<h1>`, `title` ≤ 60 dan `description` ≤ 160 karakter dan unik, kanonik absolut, `lang` benar, tidak ada `noindex`;
2. hreflang timbal-balik, EN dan ID memiliki himpunan halaman yang sama, sitemap memuat semuanya;
3. JSON-LD dapat di-*parse*, berisi properti wajib, dan fakta (nama merek, FAQ, harga bila ada) cocok dengan teks halaman;
4. semua tautan internal tembus, semua `<img>` ber-`alt`, tidak ada tautan `#` sebagai satu-satunya navigasi;
5. `llms.txt`, `llms-full.txt`, `pricing.md`, dan `robots.txt` konsisten dengan halaman dan registri;
6. **tidak ada permintaan ke host pihak ketiga** di HTML awal; satu-satunya pemuat pihak ketiga adalah pemuat GA4 yang menunggu persetujuan; tidak ada Google Fonts.

**Registri dan tes kejujuran.** (a) `features.ts`: tiap kemampuan punya `status` dan `planRef`; tes menolak `available` bila baris PLAN tersebut belum ✅. (b) `data-practices.ts`: tiap kunci `localStorage`, kuki, dan host eksternal yang ditemukan di `src/` harus tercatat; halaman privasi dibuat dari registri ini dalam dua bahasa.

**Uji.** Selain pemeriksaan SEO: uji komponen (banner persetujuan tidak memuat GA4 sebelum Setuju; pilihan Tolak tidak memuat), uji ilustrasi (urutan langkah, navigasi keyboard), uji pembatas pendaftaran harian, Lighthouse manual sebelum rilis. Tindakan owner yang tidak dapat diautomasi: verifikasi Search Console dan Bing, pengiriman sitemap, IndexNow/Brave, dan pembuatan ID GA4 dan kunci Turnstile.

### M17 Koneksi, playbook, dan operasi deployment (BRD-M17)

> ✅ **Revisi PRD disetujui owner (2026-10-29, D-055):** bagian ini menambah spesifikasi M17 pada PRD v0.1.0. Nilai bawaan yang ditandai ⚠️ dapat diatur per organisasi. Tabelnya ada di ERD §3.9.

**Prinsip.** SaaS multi-tenant: semua koneksi dan data milik satu organisasi (BR-M17-01). AI **merencanakan dan bertanya**, kode **memvalidasi dan menjalankan**, manusia **menyetujui** (BR-M17-04, -05). Tidak ada shell bebas.

**Halaman**
- `/app/koneksi`: daftar koneksi organisasi dan tombol tambah. Jenis **GitHub**, **SSH**, **aaPanel** aktif; **CyberPanel** dan **cPanel** tampil nonaktif berlabel "segera hadir". Hanya Pemilik membuat, mengubah, menguji, menghapus; yang lain hanya melihat (tanpa rahasia).
- `/app/produk/:id` tab **Setup**: profil setup produk (form), dapat diisi atau diusulkan AI, disunting kapan saja oleh Pemilik/Admin.
- `/app/setup` dan `/app/setup/:id`: daftar run dan **progres per langkah** (menunggu, berjalan, selesai, gagal, dilewati), keluaran tersaring, tombol coba lagi, lanjutkan, batalkan.
- Deployment di `/app/produk/:id` dan 360° klien menampilkan lencana **kode tertinggal N commit** dan **status uptime**, serta tombol Perbarui (membuat run yang butuh persetujuan).
- `/app/asisten` menampilkan kartu rencana dan progres run di dalam percakapan; kartu persetujuan juga di Action Center dan Telegram.

**Koneksi**
- **GitHub:** GitHub App (D-054). Organisasi memasang App pada akunnya dan memilih repo, lalu **membuktikan** akses ke instalasi itu lewat otorisasi pengguna GitHub (D-057); `installationId` mentah tidak diterima. Token instalasi berumur pendek diminta saat dipakai. ⚠️ Pendaftaran GitHub App dilakukan owner (lihat §10).
- **SSH:** host, port, pengguna, metode `password` | `private_key` (passphrase opsional) | `key_and_password` ⚠️. **Sidik jari host disematkan** saat tes pertama atas konfirmasi pengguna; sidik jari berubah = koneksi ditolak sampai dikonfirmasi ulang (BR-M17-08).
- **aaPanel:** URL panel dan API key. Daftar kemampuan yang dipakai dibatasi pada yang terdokumentasi resmi dan terbukti di server uji ⚠️ (BR-M17-09).
- **Rahasia:** disimpan terenkripsi (AES-256-GCM dengan kunci induk `CONNECTIONS_KEY`, nonce acak per nilai, nomor versi kunci disimpan), tampil sebagian, tidak pernah dikembalikan API (BR-M17-02). Rahasia hanya didekripsi di dalam proses yang menjalankan koneksi, tidak pernah dilewatkan ke model, `ai_runs`, audit, log, atau keluaran langkah (BR-M17-03); keluaran disaring dengan mengganti nilai rahasia yang dikenal.
- **Tes koneksi** wajib sebelum dipakai (BR-M17-10). Menghapus koneksi yang dipakai profil atau run aktif ditolak (BR-M17-13).

**Profil setup per produk** (satu per produk): koneksi GitHub, repo, branch bawaan, **mode** `branch_per_client` | `shared_branch`, pola nama folder (mis. `{produk}-{klien}`), koneksi server bawaan, urutan langkah (dari katalog di bawah), templat nginx dan env, dan **catatan aturan kerja** teks bebas yang dibaca AI sebagai memori produk. AI boleh **mengusulkan** isi (tool `draft`), tersimpan bertanda "dibantu AI" sampai pengguna menyimpannya.

**Katalog langkah (daftar izin, BR-M17-04).** Tiap langkah punya nama, skema argumen (Zod), tingkat (`read` atau `change`), dan templat perintah tetap. Argumen disisipkan dengan pengutipan aman setelah lolos pola ketat: domain (`^[a-z0-9.-]{1,253}$`, tanpa `..`), nama folder dan database (`^[a-z0-9_-]{1,64}$`), nama branch (pola nama ref Git yang aman, tanpa awalan `-`), URL repo harus milik koneksi GitHub. Langkah awal: `check_server` (read), `git_clone` (clone satu branch ke folder), `git_update` (tarik commit terbaru), `create_database`, `write_env` (dari templat; nilai rahasia aplikasi klien, mis. kata sandi database yang dibuat saat setup, **tidak disimpan** di Orbyte, BR-M02-07: ditampilkan sekali di hasil run, lalu hilang ⚠️ default), `install_dependencies`, `build_app`, `set_domain_and_nginx`, `restart_service`, `verify_http` (read). Langkah yang tidak tersedia pada pelaksana tertentu ditandai tidak didukung dan rencana ditolak sebelum disetujui (bukan gagal di tengah jalan).

**Pelaksana (`ServerRunner`).** Satu antarmuka, **tiap jenis koneksi server adalah opsi yang berdiri sendiri** (D-055): `ssh`, `aapanel`, dan kelak `cyberpanel` dan `cpanel` (tampil "segera hadir"), ditambah pelaksana palsu `simulated` yang **hanya ada di tes otomatis** (BR-M17-16; tidak ada mode demo, D-059). Satu server memakai tepat satu koneksi; kemampuan tiap jenis berbeda, dan langkah yang tidak didukung jenis itu ditolak saat rencana dibuat. Tidak ada jenis yang menjadi cadangan jenis lain. Pustaka SSH dipilih saat implementasi ⚠️.

**Run**
- **Status:** `planned → awaiting_approval → running → (paused saat langkah gagal) → done | failed | cancelled`. Langkah: `pending → running → done | failed | skipped`.
- **Rencana** dibuat service dari profil, koneksi, dan parameter (klien, domain, branch) yang dikonfirmasi pengguna dalam percakapan; AI tidak mengarang parameter. Rencana menjadi `approvals` dengan argumen persis (BR-M17-05); web dan Telegram memakai `decideApproval` yang sama.
- **Eksekusi** oleh worker (`setup.run`, D-048): satu run per server pada satu waktu, batas waktu per langkah (default 5 menit, dapat diatur per organisasi: `organizations.step_timeout_sec`), keluaran dipotong 8 KB per langkah dan disaring. Langkah gagal menghentikan run; **lanjutkan** mengulang dari langkah gagal tanpa mengulang langkah sukses (BR-M17-07). Rollback manual (D-054).
- Setelah `done`: deployment dibuat atau diperbarui (domain, repo, branch, commit terpasang), dan langganan serta draf invoice pertama dapat dibuat lewat service M03 atas persetujuan pengguna (nominal tetap dari kode).

**Webhook GitHub (D-058).** Satu URL produksi `{APP_URL}/api/github/webhook`, publik tetapi hanya menerima kiriman bertanda tangan. Push memperbarui commit ujung branch deployment yang cocok seketika; Installation yang dihapus atau ditangguhkan menandai koneksi gagal. Payload adalah data dan tidak pernah memulai run.

**Sinkronisasi kode (BR-M17-11, -12).** Job terjadwal membaca commit terpasang tiap deployment (lewat langkah `read` pada SSH ⚠️; lewat aaPanel bergantung hasil uji) dan ujung branch dari GitHub, lalu menyimpan keduanya dan waktu cek. `behindBy` dihitung, bukan disimpan sebagai status. Rule baru `deployment_outdated` lewat `automation.once` (dedupe per deployment dan commit ujung); selesai sendiri saat sejajar. Tombol Perbarui membuat run `git_update` yang perlu persetujuan. Mode `shared_branch`: satu pembaruan dapat mencakup beberapa deployment sebagai satu run per server.

**Uptime.** Job terjadwal memeriksa HTTP domain deployment aktif (batas waktu dan jumlah percobaan ulang tetap di kode); dua kegagalan berurutan menerbitkan temuan `deployment_down`, pulih menutupnya. Frekuensi default **5 menit**, dapat diatur per organisasi (`organizations.uptime_interval_min`); riwayat panjang tidak disimpan pada versi ini.

**Tool AI (BR-M17-03 sampai -06)**

| Tool | Tingkat | Izin | Fungsi |
|---|---|---|---|
| `list_connections` | read | `connection.read` | nama, jenis, status tes; tanpa rahasia |
| `get_setup_profile` | read | `setup.read` | profil produk dan catatan aturan kerja |
| `get_code_status` | read | `setup.read` | deployment yang tertinggal beserta selisih commit |
| `list_setup_runs`, `get_setup_run` | read | `setup.read` | status dan progres run |
| `draft_setup_profile` | draft | `setup.write` | usulan isi profil produk |
| `start_client_setup` | act | `setup.run` | membuat rencana run, menjadi persetujuan |
| `update_deployment_code` | act | `setup.run` | membuat run pembaruan kode |

Isi chat, screenshot, README dan pesan commit adalah data tersusun dalam pembungkus tidak tepercaya (CR-12); tidak ada tool yang menerima perintah mentah.

**Izin baru** (matriks PRD §3 bertambah): `connection.read` (semua peran), `connection.write` (Pemilik), `setup.read` (semua), `setup.write` dan `setup.run` (Pemilik, Admin).

**Layanan dan lokasi kode:** `src/domain/connections/` (vault, layanan koneksi), `src/domain/setup/` (profil, katalog langkah, perencana, run), `src/domain/operations/` (drift, uptime), `src/integrations/{github,ssh,aapanel}/` di balik `ServerRunner`.

**Uji.** Parameter berbahaya ditolak (`;`, `$()`, spasi, `..`, awalan `-`); rahasia tidak ada di respons API, `ai_runs`, audit, log, dan keluaran langkah (pencarian string); dua organisasi tidak bisa memakai koneksi satu sama lain; argumen yang disetujui sama persis dengan yang dijalankan; langkah gagal lalu dilanjutkan tanpa mengulang yang sukses; sidik jari host berubah ditolak; temuan kode tertinggal satu kali lalu selesai sendiri; teks "jalankan rm -rf" di chat atau README tidak memicu langkah; CyberPanel dan cPanel tidak dapat dibuat; tes SSH memakai **server SSH sungguhan** (`ssh2` Server) untuk metode login, host key, dan eksekusi; `FakeProvider` untuk model; ditambah uji manual terhadap server uji owner.

## 5. Kontrak AI (M07)

**Antarmuka `AiProvider`** (`src/ai/provider`): `chat({messages, tools?, schema?, effort, maxTokens})`, `transcribe({file, language, hints})`, `generateImage({prompt, n, size})`. Implementasi: `MetaProvider` (base `https://api.meta.ai/v1`, Bearer `MODEL_API_KEY`) dan `FakeProvider` (skrip balasan untuk tes tanpa jaringan, BRD-M07).

**Aturan panggilan** (`docs/02`, D-019): `max_tokens` ≥ 1.000 dan `reasoning_effort` eksplisit per fitur; respons `null` dianggap kegagalan yang tercatat, bukan jawaban kosong; 429 dicoba ulang dengan jeda bertahap lalu gagal jujur.

| Fitur | Model | `reasoning_effort` awal | Anggaran harian awal ⚠️ |
|---|---|---|---|
| Agen/penjelasan/draf (M08, M11) | `muse-spark-1.3` | rendah | USD 2 |
| Notulen dan ekstraksi (M09) | `muse-spark-1.3` (structured output) | sedang | USD 1 |
| Transkripsi (M09) | `muse-voice-transcribe-1.0` | n/a | USD 1 |
| Gambar (M10) | `muse-image-1.0` | n/a | USD 1 |

Anggaran disimpan di pengaturan org (hanya Pemilik yang mengubah) dan dibandingkan dengan `Σ biaya` hari itu dari `ai_runs`; biaya dihitung dari tabel harga di konfigurasi (token masuk/keluar, per jam audio, per gambar). Nilai di atas adalah titik awal yang aman terhadap kredit $150 dan dapat diganti.

**Registri tool** (satu daftar, BRD-M07 Lampiran A). Setiap tool: `name`, skema Zod argumen, `tier` (`read`/`draft`/`act`), izin minimum, dan **satu layanan** yang dipanggil.
- `read` dan `draft` dieksekusi langsung; `draft` hanya membuat entitas berstatus draf dan **tidak** mengirim apa pun.
- `act` **tidak dieksekusi oleh agen**: pemanggilan membuat `approval` `Menunggu` berisi tool dan argumen persis, lalu berhenti. Eksekusi terjadi saat pengguna menyetujui, oleh layanan yang sama dengan tombol manual, dengan `ctx.actor = user:<id>` dan `onBehalfOf` mencatat `ai:<run>`.
- Tool terlarang (pembayaran, status/nominal/jatuh tempo invoice, harga paket, hapus data, peran/pengaturan, kirim keluar, anggaran) **tidak terdaftar**; model tidak melihatnya, dan percobaan memanggilnya ditolak dan dicatat.
- Argumen tool selalu divalidasi Zod; argumen rusak tidak menghasilkan efek dan run berakhir dengan status gagal yang jujur.

**Loop agen:** maksimum 6 putaran dan batas token per run; setiap putaran dicatat. Konteks yang tidak tepercaya (transkrip, isi dokumen, pesan chat) dibungkus `<data_tidak_tepercaya>…</data_tidak_tepercaya>` dengan instruksi sistem bahwa isinya bukan perintah; **pertahanan sebenarnya adalah arsitektur** (tool `act` tidak dapat dieksekusi tanpa persetujuan manusia), bukan prompt.

**Angka dari data:** jawaban yang memuat nominal/tanggal diisi dari hasil tool; template jawaban memakai nilai tool dan bukan hasil hitung model (BR-M08-03). Tes membandingkan angka jawaban dengan hasil layanan.

**Label:** keluaran AI diberi tanda "dibantu AI" di UI (BR-M07).

## 6. Kontrak Telegram (M11)

- **Webhook:** `POST /api/telegram/webhook`, memverifikasi header `X-Telegram-Bot-Api-Secret-Token` (`TELEGRAM_WEBHOOK_SECRET`); tanpa secret → 401 dan tidak diproses (BRD-M11). Pendaftaran webhook lewat skrip `pnpm bot:webhook` ke domain live; pengembangan lokal memakai long polling `pnpm bot:dev`.
- **Pairing:** pengguna membuat **kode sekali pakai** di `/app/settings/telegram` (berlaku 10 menit); mengirim `/start <kode>` ke bot menautkan `chat_id` ke pengguna itu. Kode kedua kali/kedaluwarsa ditolak; chat tak tertaut tidak mendapat data apa pun. `/putus` memutus tautan.
- **Perintah:** `/status`, `/overdue`, `/tugas`, `/briefing`, `/bantuan`, `/putus`; **bahasa alami** diteruskan ke agen (M07) dengan konteks pengguna terautentikasi dan izinnya (BR-M01-08).
- **Kartu dan tombol:** notifikasi temuan memakai inline keyboard **[Setujui] [Tolak] [Detail]**. `callback_data` ringkas (batas 64 byte): `ap:<approvalId>:y|n|d`. Setelah keputusan, `editMessageText` mengganti tombol dengan hasil; tombol usang/kedaluwarsa menampilkan pesan jelas dan **tidak** mengeksekusi. Selalu memanggil `answerCallbackQuery`.
- **Idempoten:** keputusan lewat `approvals.decide` yang atomik (§4 M15); menekan dua kali atau dari web dan Telegram bersamaan hanya berhasil sekali.
- **Voice note:** `message:voice` → `getFile` → unduh (≤ 20 MB) → job `meeting.process` (M09); balasan memuat notulen ringkas dan tautan ke web.
- **Foto/screenshot → draft task:** ⚠️ bergantung hasil uji kemampuan gambar; bila model tidak mendukung, fitur dihapus dari menu (bukan dipalsukan).
- **Bahasa pesan:** mengikuti preferensi bahasa pengguna (D-013).
- **Fallback jadwal:** bila waktu mepet, M11 turun ke **minimal**: tautan akun, notifikasi temuan, tombol Setujui/Tolak, dan `/overdue`. Voice note, bahasa alami, dan foto menyusul.
- **Larangan:** tidak mengirim pesan ke klien, tidak ada grup/channel, tidak mengeksekusi aksi terlarang (BRD-M07 Lampiran A).

## 7. Job dan penjadwal (D-008)

- **Worker:** loop dalam proses server mengambil baris `jobs` berstatus `queued` dengan `FOR UPDATE SKIP LOCKED`, menandai `running`, mencoba ulang dengan jeda bertahap (maks 3), dan mencatat hasil. Dipakai untuk pekerjaan panjang: `meeting.process`, `image.generate`, `briefing.generate`, `finding.explain`.
- **Ticker:** setiap 60 detik, hanya pada proses yang memegang `pg_try_advisory_lock`; mengevaluasi rule per organisasi pada jam organisasi (zona waktunya) dan mengantrekan job. Menjalankan dua kali tidak menimbulkan efek ganda karena semua rule lewat `automation.once`.
- **Rule dan kunci dedupe:** `renewal_draft` → `renewal:<subscriptionId>:<periode>`; `invoice_overdue` → `overdue:<invoiceId>`; `invoice_draft_ready` → `draftready:<invoiceId>`; `renewal_upcoming` → `upcoming:<subscriptionId>:<periode>`; `task_late` → `late:<taskId>`; `lead_stagnant` → `stagnant:<leadId>:<minggu>`; `briefing` → `briefing:<org>:<tanggal>`; kedaluwarsa persetujuan → tanpa kunci (pembaruan status bersyarat).
- **Pengujian:** ticker menerima `Clock` yang dapat dimajukan; tes memajukan waktu dan memeriksa efek tepat satu kali.

## 8. Persyaratan non-fungsional

- **Keamanan:** `org_id` di setiap query repositori; sesi cookie `HttpOnly`/`Secure`/`SameSite=Lax`; CSRF ditegakkan untuk metode non-GET (token atau pemeriksaan `Origin`); batas laju login dan endpoint AI; unggahan diperiksa tipe MIME dan ukuran di **server** (klien hanya petunjuk); rahasia hanya di variabel lingkungan; tidak ada rahasia di log, audit, atau repo (CR-16).
- **Privasi dan data:** hanya data demo palsu di repo dan saat memakai kredit gratis Meta (mode kontributor melatih model Meta); tidak ada data klien nyata.
- **Kinerja (target demo):** halaman daftar < 500 ms pada seed demo; respons agen terdengar progresif (status "sedang menyusun…"), tidak menahan UI; pekerjaan panjang (STT, gambar) berjalan di job dengan progres.
- **Ketahanan:** gagal AI tidak menjatuhkan fitur non-AI (BR-M08-11); 429/anggaran habis menampilkan pesan jelas; job gagal tampil dengan alasan dan dapat dicoba ulang.
- **Aksesibilitas:** label terhubung, fokus terlihat, keyboard penuh, `prefers-reduced-motion`, kontras memadai (BR-M14-10); kanban punya alternatif non-seret.
- **i18n:** semua teks lewat kamus; angka Rupiah dan tanggal `DD/MM/YYYY` seragam; bahasa bot mengikuti pengguna.
- **Observabilitas:** log terstruktur (tingkat, `orgId`, `runId`, `requestId`) tanpa data sensitif; endpoint `GET /api/health` (DB siap, ticker aktif).

## 9. Pengujian

| Lapisan | Alat | Cakupan wajib |
|---|---|---|
| Unit | Vitest | `calculateTotals`, `money`, turunan (overdue/versi/terlambat/stagnan), transisi state, matriks izin, parser |
| Integrasi | Vitest + PostgreSQL uji (`DATABASE_URL_TEST`, skema diterapkan dari migrasi) | layanan + repositori + audit-dalam-transaksi, idempotensi, konkurensi (nomor invoice, keputusan persetujuan ganda), isolasi dua org |
| AI | `FakeProvider` | loop agen, validasi argumen, tool terlarang, injeksi di transkrip/dokumen, anggaran habis, angka jawaban = hasil tool |
| E2E | Playwright (golden path + satu error path per fitur) | login → buat produk/klien/subscription → draf invoice otomatis → tandai terkirim → catat pembayaran → PDF; rekaman → notulen → draf lead/task → persetujuan; temuan overdue → kartu → persetujuan |
| Manual | verifikasi eksploratif di browser | sebelum menutup setiap fitur ber-UI |

Seed deterministik dengan `Clock` tetap; dua organisasi untuk uji isolasi. Pemeriksaan "tanpa kontrol mentah" sudah ada sebagai tes.

## 10. Prasyarat teknis yang harus dibuktikan sebelum coding fitur terkait

Hasil uji dicatat di `docs/02` §0.

| Cek | Dibutuhkan oleh | Cara | Bila gagal |
|---|---|---|---|
| **M17:** kemampuan aaPanel API (situs, database, nginx, perintah, berkas), SSH kunci + kata sandi (`AuthenticationMethods`), baca commit terpasang lewat aaPanel | M17 | skill integrasi dari dokumentasi resmi, lalu uji terhadap server uji owner | langkah yang tidak terbukti ditandai tidak didukung pada jenis koneksi itu (tiap jenis berdiri sendiri) |
| **M17:** GitHub App terdaftar (App ID, kunci privat, slug) oleh owner | M17 | owner mendaftarkan App di akun GitHub-nya | tidak ada koneksi GitHub sampai terdaftar; tes memakai pelaksana palsu (hanya tes) |
| STT Indonesia: ✅ **terbukti** satu pembicara 22 dtk (`docs/02` §0). ⚠️ Masih diuji: **dua pembicara**, rekaman 5–10 menit, derau/code-switching | M09, M11 | skrip uji dengan rekaman tambahan | tolak > 10 menit; hapus klaim pembeda pembicara bila `speaker` tidak andal |
| Vision (input gambar ke Spark) | M11 foto → task | satu gambar uji | hapus fitur foto |
| Image generation: varian, ukuran, edit dengan gambar masukan | M10 | skrip uji | revisi lewat prompt baru, bukan edit |
| Structured output + tool calling pada alur agen (sudah lolos uji dasar) | M07 | tes dengan `FakeProvider` + uji langsung | n/a |
| ✅ **`ffmpeg` terpasang** di server live dan di mesin lokal (konfirmasi owner 2026-10-28) | M09, voice note M11 | `ffmpeg -version` | n/a |
| **Bucket Cloudflare R2** privat + token API S3 (Access Key ID dan Secret) | M06, M09, M10 | owner membuat bucket dan token (hak: baca/tulis objek pada bucket itu saja); nilai disimpan di `.env`/server, tidak di repo | `STORAGE_DRIVER=disk` sementara |
| **Domain `ai-business.asiifdev.com`** (HTTPS) dan bot Telegram sudah siap (owner) | M11 | `pnpm bot:webhook` mendaftarkan `https://ai-business.asiifdev.com/api/telegram/webhook` | long polling di server |

## 11. Variabel lingkungan

`DATABASE_URL`, `DATABASE_URL_TEST`, `MODEL_API_KEY`, `MODEL_API_BASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `STORAGE_DRIVER`, `STORAGE_DIR` (hanya driver disk), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `APP_URL`, `NODE_ENV`, `CONNECTIONS_KEY` (kunci induk enkripsi rahasia koneksi M17, 32 byte base64; tanpa kunci ini koneksi tidak dapat dibuat atau dibaca), `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG` (GitHub App platform, M17), `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` (verifikasi pemasang App, D-057), `GITHUB_WEBHOOK_SECRET` (D-058), `ALLOW_PRIVATE_CONNECTIONS` (hanya pengembangan lokal), `EGRESS_IPS` (alamat keluar server Orbyte, ditampilkan di halaman Koneksi), `CONNECTIONS_KEY_VERSION` dan `CONNECTIONS_KEY_V<n>` (rotasi kunci, `pnpm connections:rotate`). Contoh di `.env.example`; nilai nyata tidak pernah di repo.

## 12. Urutan implementasi dan fallback

Mengikuti gelombang BRD (yang paling akhir dipangkas lebih dulu). Dikerjakan solo, dua jalur paralel (A: platform dan data, B: AI dan pengalaman).

| Tahap | Isi | Jalur |
|---|---|---|
| ERD disetujui | skema + migrasi pertama | A |
| **Gelombang 1** | M01 auth/tenancy, M15 audit/guardrail, sisa M14 (AppShell, Table, Modal, Toast, dst.) | A + B |
| **Gelombang 2** | M02 → M03 (inti: subscription, invoice, pembayaran, PDF, scheduler) → M04 → M05 | A |
| **Gelombang 3** | M07 AI Core → M08 Action Center → M09 Meeting → M11 Telegram → M06 Dokumen → M10 Marketing → M12 Dashboard | B (+ A untuk M06, M12) |
| Landing M16 | Fase A: merek, layout, `Seo`, i18n routing, berkas penemuan, font sendiri, persetujuan + GA4, tes SEO; Fase B: halaman dan konten EN lalu ID; Fase C: ilustrasi interaktif; Fase D (akhir): kunci klaim fitur terhadap status modul | B |
| Penutup | E2E, deploy live, seed demo, video 3 menit, README | A + B |

**Urutan pangkas bila waktu habis** (dari yang pertama dikorbankan): foto→task di M11 → M10 revisi gambar → tren di M12 → M05 saran pengelompokan → M11 bahasa alami (tetap notifikasi + tombol) → M06 Quotation. **Tidak boleh dipangkas** karena inti demo: M03, M07, M08, M09, M15 dan Telegram minimal.

## 13. Keputusan owner atas pertanyaan terbuka (2026-10-28)

| # | Keputusan |
|---|---|
| 1 | Anggaran AI harian awal dan hari stagnan lead (14) **diterima, dengan syarat dapat diatur** di Pengaturan Organisasi (hanya Pemilik). Nilai di §5 hanyalah default |
| 2 | Staf **melihat harga paket**; audit non-keuangan terlihat oleh Admin saja (§3) |
| 3 | Persetujuan kedaluwarsa **24 jam**, dapat diatur di Pengaturan Organisasi |
| 4 | Pustaka PDF `@react-pdf/renderer` dan ikon SVG inline **diterima** (D-022) |
| 5 | `ffmpeg` terpasang di server live dan lokal (§10) |
| 6 | Berkas disimpan di **Cloudflare R2** (D-023) |
| 7 | PostgreSQL satu server dengan aplikasi; domain **`ai-business.asiifdev.com`**; `BETTER_AUTH_URL` dan `APP_URL` memakai domain itu |
| 8 | Bot Telegram sudah dibuat; token hanya di `.env` server/lokal (tidak di repo, chat, atau Discord) |

Sisa ⚠️ yang menunggu: pembeda dua pembicara STT dan rekaman lebih panjang (§10), nama paket `@aws-sdk/*` dan adaptor grammY untuk Astro (diverifikasi saat install).

## 14. Keterlacakan

| Modul | BRD | Bagian PRD |
|---|---|---|
| M01 | `brd/BRD-M01-org-auth-tenancy.md` | §0, §3, §4 M01 |
| M15 | `brd/BRD-M15-audit-guardrail.md` | §1, §4 M15, §7 |
| M14 | `brd/BRD-M14-design-system.md` | §4 M14 |
| M02 | `brd/BRD-M02-portfolio.md` | §4 M02 |
| M03 | `brd/BRD-M03-billing.md` | §4 M03, §7 |
| M04 | `brd/BRD-M04-pipeline.md` | §4 M04 |
| M05 | `brd/BRD-M05-tasks-maintenance.md` | §4 M05 |
| M06 | `brd/BRD-M06-dokumen.md` | §4 M06 |
| M07 | `brd/BRD-M07-ai-core.md` | §5 |
| M08 | `brd/BRD-M08-action-center.md` | §4 M08, §7 |
| M09 | `brd/BRD-M09-meeting-intelligence.md` | §4 M09, §10 |
| M10 | `brd/BRD-M10-marketing-studio.md` | §4 M10 |
| M11 | `brd/BRD-M11-telegram-assistant.md` | §6 |
| M12 | `brd/BRD-M12-dashboard-bi.md` | §4 M12 |
| M16 | `brd/BRD-M16-landing-site.md` | §4 M16 |
| M17 | `brd/BRD-M17-koneksi-playbook-deployment.md` | §4 M17, §11 |
