# PLAN — status, jadwal, pemilik

Terakhir diperbarui: 2026-10-28. Diperbarui di commit yang sama dengan perubahan.

## 1. Tahap dokumen

| Tahap | Dokumen | Status |
|---|---|---|
| Konsep | `docs/00`–`05`, `09`, DECISIONS | ✅ disetujui owner 2026-10-28 |
| BRD | `docs/BRD.md` (induk) + `docs/brd/BRD-Mxx-*.md` (14 modul; indeks `docs/brd/README.md`) | ✅ disetujui owner 2026-10-28 (v0.1.0) |
| PRD | `docs/PRD.md` | ✅ disetujui owner 2026-10-28 (v0.1.0) |
| ERD | `docs/ERD.md` | ✅ disetujui owner 2026-10-28 (v0.1.0) |
| Skill integrasi | `meta-model-api-integration`, `telegram-bot-integration` | ⬜ ditulis sebelum coding lapisan AI / Telegram |
| Coding | | 🟢 **terbuka** (BRD+PRD+ERD disetujui 2026-10-28); mulai Gelombang 1 |

PRD dan ERD disusun berurutan; persetujuan tetap per tahap.

## 1a. Status implementasi (diperbarui setiap kali kode berubah)

| Area | Status | Catatan |
|---|---|---|
| M14 Design system | 🚧 | token, Tailwind v4, komponen form, `Button`, `ThemeToggle`, `LocaleSwitch`, galeri `/dev/komponen`; sisa: `Card`, `Modal`, `Table`, `Toast`, `AppShell`, dst. (PRD §4 M14) |
| Skema DB (ERD) | 🚧 | kelompok `auth_org` dan `ai_core` ditulis, 4 migrasi dibuat, 14 tes penjaga lulus di DB uji; **belum diterapkan ke DB dev** (menunggu tinjauan owner); 7 kelompok lain ⬜ |
| M01 Auth dan tenancy | 🚧 | skema + konfigurasi Better Auth ditulis; belum terhubung ke halaman (registrasi, login, middleware) dan belum diuji end-to-end |
| M15 Audit dan guardrail | 🚧 | tabel dan penjaga di DB ditulis dan diuji; layanan `audit.record`, `automation.once`, dan keputusan persetujuan belum |
| M02–M13 | ⬜ | menunggu Gelombang 2 dan 3 |
| Skill `meta-model-api-integration`, `telegram-bot-integration` | ⬜ | ditulis sebelum coding lapisan AI / Telegram |

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
