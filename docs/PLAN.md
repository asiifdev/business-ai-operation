# PLAN — status, jadwal, pemilik

Terakhir diperbarui: 2026-10-28. Diperbarui di commit yang sama dengan perubahan.

## 1. Tahap dokumen

| Tahap | Dokumen | Status |
|---|---|---|
| Konsep | `docs/00`–`06`, `09`, DECISIONS | ✅ ditulis 2026-10-28, ⏳ review owner |
| BRD | `docs/BRD.md` (induk) + `docs/brd/BRD-Mxx-*.md` (14 modul, satu file per modul; indeks `docs/brd/README.md`) | 📝 draf v0.1.0 ditulis 2026-10-28, ⏳ review owner (boleh disetujui per gelombang) |
| PRD | `docs/PRD.md` | ⬜ setelah BRD disetujui |
| ERD | `docs/ERD.md` | ⬜ setelah PRD disetujui |
| Skill integrasi | `meta-model-api-integration`, `telegram-bot-integration` | ⬜ sebelum coding lapisan terkait |
| Coding | | 🔒 terkunci sampai BRD+PRD+ERD disetujui (kecuali izin eksplisit) |

Usulan pemadatan karena tenggat: **BRD satu dokumen berisi bagian per modul** (bukan satu file per modul), PRD dan ERD disusun berurutan. Persetujuan tetap per tahap.

## 2. Jadwal (WIB)

| Tanggal | Target |
|---|---|
| 28 Okt | Konsep + CLAUDE.md + skill; review owner; BRD draf |
| 29 Okt | BRD disetujui → PRD draf → disetujui; uji kemampuan model Meta (setelah akun pulih); tulis skill Meta + Telegram |
| 30 Okt | ERD disetujui (menggantikan draf skema); **coding dimulai** |
| 30 Okt – 2 Nov | Implementasi per jalur (urutan di `docs/09`) |
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
3. ~~Hosting live~~ — tersedia (D-007); detail di PRD.
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
