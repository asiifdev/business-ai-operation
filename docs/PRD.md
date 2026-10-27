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
- **Larangan:** tidak ada kolom kata sandi/token deployment (BR-M02-07).
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

Lihat kontrak lengkap di §5.

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
| STT Indonesia: ✅ **terbukti** satu pembicara 22 dtk (`docs/02` §0). ⚠️ Masih diuji: **dua pembicara**, rekaman 5–10 menit, derau/code-switching | M09, M11 | skrip uji dengan rekaman tambahan | tolak > 10 menit; hapus klaim pembeda pembicara bila `speaker` tidak andal |
| Vision (input gambar ke Spark) | M11 foto → task | satu gambar uji | hapus fitur foto |
| Image generation: varian, ukuran, edit dengan gambar masukan | M10 | skrip uji | revisi lewat prompt baru, bukan edit |
| Structured output + tool calling pada alur agen (sudah lolos uji dasar) | M07 | tes dengan `FakeProvider` + uji langsung | n/a |
| ✅ **`ffmpeg` terpasang** di server live dan di mesin lokal (konfirmasi owner 2026-10-28) | M09, voice note M11 | `ffmpeg -version` | n/a |
| **Bucket Cloudflare R2** privat + token API S3 (Access Key ID dan Secret) | M06, M09, M10 | owner membuat bucket dan token (hak: baca/tulis objek pada bucket itu saja); nilai disimpan di `.env`/server, tidak di repo | `STORAGE_DRIVER=disk` sementara |
| **Domain `ai-business.asiifdev.com`** (HTTPS) dan bot Telegram sudah siap (owner) | M11 | `pnpm bot:webhook` mendaftarkan `https://ai-business.asiifdev.com/api/telegram/webhook` | long polling di server |

## 11. Variabel lingkungan

`DATABASE_URL`, `DATABASE_URL_TEST`, `MODEL_API_KEY`, `MODEL_API_BASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `STORAGE_DRIVER`, `STORAGE_DIR` (hanya driver disk), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `APP_URL`, `NODE_ENV`. Contoh di `.env.example`; nilai nyata tidak pernah di repo.

## 12. Urutan implementasi dan fallback

Mengikuti gelombang BRD (yang paling akhir dipangkas lebih dulu). Dikerjakan solo, dua jalur paralel (A: platform dan data, B: AI dan pengalaman).

| Tahap | Isi | Jalur |
|---|---|---|
| ERD disetujui | skema + migrasi pertama | A |
| **Gelombang 1** | M01 auth/tenancy, M15 audit/guardrail, sisa M14 (AppShell, Table, Modal, Toast, dst.) | A + B |
| **Gelombang 2** | M02 → M03 (inti: subscription, invoice, pembayaran, PDF, scheduler) → M04 → M05 | A |
| **Gelombang 3** | M07 AI Core → M08 Action Center → M09 Meeting → M11 Telegram → M06 Dokumen → M10 Marketing → M12 Dashboard | B (+ A untuk M06, M12) |
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
