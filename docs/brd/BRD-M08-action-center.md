# BRD-M08 — Action Center & Persetujuan

| | |
|---|---|
| **Status** | ✅ Disetujui owner (2026-10-28), v0.1.0 |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 3 — AI & pengalaman / B |
| **Level usulan** | ✅ (inti demo, *Best Agentic Use-Case*) |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-05, CR-06, CR-07, CR-08, CR-09, CR-10, CR-11, CR-13 |
| **Prasyarat** | BRD-M03, M05, M07, M15 (dan M04 untuk lead stagnan) |
| **Sumber** | konsep awal (AI Action Center, Observe/Reason/Prepare/Execute, Modul 6), `docs/00` §4 |

## 1. Tujuan & nilai bisnis

Pusat tempat sistem **memberi tahu apa yang butuh perhatian hari ini** beserta alasannya, draft tindakannya, dan tombol keputusan. Bukan chatbot: AI dilibatkan setelah event deterministik, dan setiap aksi berisiko menunggu persetujuan. Ini fitur pembeda utama produk. Melayani G1, G3, G4, G7.

## 2. Aktor & hak akses

| Aksi | Pemilik | Admin | Staf | Sistem | AI |
|---|---|---|---|---|---|
| Melihat temuan | ✅ | ✅ | ✅ (sesuai izin modul) | — | — |
| Menyetujui/menolak aksi `act` | ✅ | ✅ (sesuai izin) | ❌ aksi keuangan | — | ❌ |
| Mengabaikan/menunda temuan | ✅ | ✅ | ✅ (non-keuangan) | — | ❌ |
| Menjalankan penjelasan AI atas temuan | ✅ | ✅ | ✅ | ✅ (otomatis) | — |

## 3. Lingkup

**Termasuk:** **rule** deterministik yang menerbitkan **Temuan** dari event (invoice lewat jatuh tempo, invoice draft siap ditinjau, subscription mendekati jatuh tempo, task terlambat, lead stagnan); **kartu temuan** (konteks dari data, alasan, penjelasan AI, draft tindakan); **antrean Persetujuan** untuk tool `act`; keputusan Setujui/Tolak/Edit; **briefing harian** (ringkasan angka + narasi AI); status temuan; kanal web dan Telegram (M11); jejak lengkap.

**Tidak termasuk:** eksekusi otomatis tanpa persetujuan; pengiriman pesan ke klien (hanya draft teks); rule buatan pengguna ⚠️; pembelajaran dari keputusan; analisis prediktif.

## 4. Proses bisnis

1. Scheduler/event menjalankan **rule**; bila kondisi terpenuhi dan belum ada temuan untuk (rule, kunci) → membuat **Temuan** (idempoten, CR-10).
2. Untuk temuan yang butuh konteks, **agen** (M07) dipanggil **sekali** untuk menyusun penjelasan dan **draft** (mis. pesan follow-up) memakai tool `read`/`draft`; hasil disimpan pada temuan (tidak diulang tiap dibuka).
3. Bila ada aksi yang disarankan (mis. tandai invoice terkirim), agen membuat **Persetujuan `Menunggu`** dengan tool dan argumen persis.
4. Pengguna meninjau kartu → **Setujui / Tolak / Edit draft**. Persetujuan dieksekusi oleh **service domain yang sama** dengan tombol manual.
5. Hasil dicatat (audit), temuan ditandai `Ditangani`; pengguna dapat `Abaikan` atau `Tunda`.
6. **Briefing harian** dihasilkan pada jam yang diatur dari data hari itu.

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M08-01 | Temuan lahir dari **rule deterministik** atas data; **AI tidak memutuskan ada/tidaknya masalah** | Final (CR-05) |
| BR-M08-02 | **Satu temuan per (rule, kunci entitas)**; rule yang berjalan ulang tidak menggandakan temuan | Final (CR-10) |
| BR-M08-03 | Kartu menampilkan **angka dari data** (nominal, hari terlambat, klien), bukan hasil hitung model; penjelasan AI berlabel "dibantu AI" | Final (CR-05, CR-13) |
| BR-M08-04 | **Setiap aksi `act` butuh Persetujuan manusia**; kartu persetujuan menampilkan tool, **argumen persis**, dampak, pemohon, dan masa berlaku | Final (CR-06/08) |
| BR-M08-05 | Persetujuan berlaku default **24 jam** (configurable) lalu `Kedaluwarsa`; saat diputuskan, izin dan keadaan data **divalidasi ulang**; berubah/kedaluwarsa → ditolak dengan pesan jelas | Usulan ⚠️ |
| BR-M08-06 | Persetujuan **idempoten**: diputuskan sekali; keputusan ganda (web + Telegram) ditolak | Final (BR-M15-08) |
| BR-M08-07 | Hanya pengguna **berwenang** yang dapat menyetujui; aksi keuangan tidak dapat disetujui Staf | Final |
| BR-M08-08 | Eksekusi lewat **service domain yang sama** dengan UI manual; tidak ada jalur khusus AI | Final (CR-07) |
| BR-M08-09 | **Draft pesan follow-up tidak terkirim otomatis**; "mengirim" = pengguna menyalin/menandai terkirim ⚠️ kanal | Final (CR-08) |
| BR-M08-10 | Penjelasan AI **disimpan per temuan** dan tidak dipanggil ulang tiap tampilan (kontrol biaya); regenerasi atas permintaan | Usulan |
| BR-M08-11 | Bila AI gagal/anggaran habis, kartu tetap tampil dengan data dan tombol manual dan berlabel **"ini bukan hasil AI"** | Final (CR-13) |
| BR-M08-12 | Status temuan: `Baru`, `Ditangani`, `Diabaikan`, `Ditunda sampai <tanggal>`; temuan yang kondisinya hilang (mis. invoice dilunasi) otomatis `Selesai sendiri` | Usulan |
| BR-M08-13 | **Briefing harian** merangkum angka dari service (M12) dan temuan terbuka; AI hanya menyusun bahasa | Final |
| BR-M08-14 | Urutan prioritas temuan ditentukan **rumus tetap** (dampak nominal, urgensi tenggat, jenis), bukan opini model ⚠️ rumus dirinci di PRD | Usulan |
| BR-M08-15 | Semua temuan, penjelasan, persetujuan, dan eksekusi tercatat di audit/`ai_runs` | Final (CR-09) |

## 6. Entitas bisnis & data kunci

Temuan (rule, kunci, entitas, status, penjelasan AI, draft), Persetujuan (di M15), Briefing (tanggal, isi). Siklus Temuan: `Baru → Ditangani | Diabaikan | Ditunda`, atau `Selesai sendiri`. Skema di ERD.

## 7. Keterkaitan modul

Bergantung pada M03 (overdue/draft), M05 (terlambat), M04 (stagnan), M07 (agen), M15 (persetujuan, audit), M12 (angka briefing). Dipakai oleh M11 (kartu dan tombol di Telegram).

## 8. Integrasi eksternal

Tidak ada selain M07. Telegram melalui M11.

## 9. Notifikasi & dokumen keluaran

Kartu temuan; briefing harian; notifikasi ke Telegram dengan tombol (M11).

## 10. Kriteria penerimaan

- [ ] Invoice melewati jatuh tempo menghasilkan **satu** temuan; menjalankan rule ulang tidak menggandakan.
- [ ] Kartu menampilkan nominal dan hari terlambat **sama persis** dengan data invoice.
- [ ] Penjelasan dan draft follow-up disusun AI dan tidak terkirim ke siapa pun.
- [ ] Menyetujui aksi `mark_invoice_sent` mengubah status lewat service yang sama dengan tombol manual; audit mencatat pengguna **dan** run AI.
- [ ] Staf tidak dapat menyetujui aksi keuangan; persetujuan kedaluwarsa tidak dapat dieksekusi.
- [ ] Persetujuan dari web dan Telegram bersamaan: hanya satu berhasil.
- [ ] Invoice dilunasi sebelum disetujui → persetujuan ditolak dengan alasan, temuan `Selesai sendiri`.
- [ ] Anggaran AI habis: kartu tetap muncul berlabel "bukan hasil AI".
- [ ] Briefing harian memuat angka yang sama dengan dashboard.

## 11. Risiko & pertanyaan terbuka

1. ⚠️ **Masa berlaku persetujuan** (usulan 24 jam).
2. ⚠️ **Kanal "kirim"**: tanpa kanal ke klien, apa arti "kirim follow-up"? (usulan: salin teks + tandai sudah dikirim).
3. ⚠️ **Rumus prioritas** temuan.
4. ⚠️ **Rule buatan pengguna** ditunda.
5. ⚠️ Biaya: temuan massal (mis. 50 invoice) memanggil AI 50 kali; ambang/batching di PRD.
