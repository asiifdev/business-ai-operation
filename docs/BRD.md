# Business Requirements Document (BRD) — Induk

| | |
|---|---|
| **Status** | ✅ Disetujui owner (2026-10-28), v0.1.0 |
| **Tanggal** | 2026-10-28 |
| **Dasar** | `docs/00`–`05`, `docs/09`, `docs/DECISIONS.md` |
| **BRD modul** | `docs/brd/BRD-Mxx-<slug>.md`, satu file satu modul satu approval. Indeks: [`brd/README.md`](brd/README.md) |

> Konvensi: aturan bernomor `BR-Mxx-nn` (kalimat tunggal yang dapat diuji). **Final** = bersumber dari keputusan owner atau dokumen yang disetujui. **Usulan** = saran penulis, menunggu owner. Setiap `⚠️ PERLU KEPUTUSAN OWNER` **tidak diisi asumsi**.

## 0. Keputusan yang perlu dikonfirmasi saat review BRD induk

1. **Siapa yang mengerjakan** (D-018): hanya peserta approved yang boleh mengerjakan (owner). BRD ini ditulis netral terhadap jumlah orang.
2. **Pemilahan MVP** (D-014): setiap BRD modul memuat usulan level (✅ penuh / ◐ minimal / ❌ ditunda). Konfirmasi di §4.1.
3. ✅ **Bahasa UI**: ID dan EN dengan pengalih (D-013).
4. **Pajak pada invoice** (PPN): default 0% dan dapat diatur per org, atau tidak ada pajak sama sekali di MVP? (lihat BRD-M03)
5. **Kanal pengiriman invoice/pesan ke klien** di MVP: hanya "tandai terkirim + unduh PDF/salin tautan", atau ada kanal kirim sungguhan (email)? Telegram dipakai untuk **pemilik/staf**, bukan klien.

## 1. Ringkasan eksekutif

Sistem operasi bisnis berbasis AI untuk agensi dan startup software. Data bisnis (produk, klien, deployment, subscription, invoice, pipeline, tiket) disimpan terstruktur; **AI Action Center** mengamati kondisi nyata lewat event, menjelaskan, menyiapkan draft, dan meminta persetujuan sebelum aksi berisiko. Antarmuka: web dan **bot Telegram interaktif**. Model: Meta Model API. Dibuat untuk Meta Global AI Developer Hackathon (track Startup) dan dirancang SaaS-ready. Visi lengkap: `docs/00`.

## 2. Tujuan bisnis

| ID | Tujuan | Ukuran keberhasilan |
|---|---|---|
| G1 | Tidak ada tagihan berulang yang terlewat | Semua subscription memunculkan invoice dan pengingat sebelum jatuh tempo; overdue terdeteksi otomatis |
| G2 | Mempercepat dari lead ke proposal dan klien aktif | Rekaman rapat menjadi lead, draft proposal, dan task dalam hitungan menit, tetap dengan persetujuan |
| G3 | Satu gambaran kondisi bisnis yang dapat dipercaya | Angka MRR, outstanding, pipeline konsisten di semua tampilan karena dihitung satu service |
| G4 | AI yang aman dan akuntabel | Tidak ada aksi berisiko tanpa persetujuan; setiap panggilan model tercatat dengan biaya |
| G5 | Mengurangi pekerjaan administratif berulang | Invoice/proposal PDF dan konten marketing dibuat dari data terstruktur |
| G6 | Siap dikembangkan menjadi SaaS | Semua data terisolasi per organisasi sejak awal |
| G7 | Layak dinilai hackathon | Demo 3 menit menonjolkan agen dengan approval, audit trail, dan multimodal (STT + gambar) |

## 3. Aktor dan pengguna

| Aktor | Peran |
|---|---|
| **Pemilik** | Pemilik organisasi. Semua izin, pengaturan org, anggaran AI, menyetujui aksi berisiko |
| **Admin** | Mengelola data bisnis, menyetujui aksi sesuai izin |
| **Staf** | Mengerjakan tiket/task, melihat data sesuai izin; tidak menyetujui aksi keuangan |
| **Sistem** | Scheduler dan event (aktor otomatis, tercatat `system:<rule>`) |
| **AI** | Aktor tak berdiri sendiri: bertindak **atas nama pengguna** dengan izin yang tidak melebihi pengguna itu; tercatat `ai:<run>` |
| **Klien org** | Penerima invoice/proposal; **tidak punya akun di MVP** (portal klien ditunda) |

Pengguna utama: pendiri/CTO agensi atau startup software kecil-menengah. Detail peran dan izin: BRD-M01.

## 4. Lingkup

### 4.1 Dalam lingkup (usulan level MVP; keputusan di D-014)

| ID | Modul | Jalur | Level usulan |
|---|---|---|---|
| M01 | Organisasi, Auth, Peran & Tenancy | A | ✅ dasar |
| M02 | Portfolio: produk, klien, deployment | A | ✅ minimal |
| M03 | Billing: subscription, invoice, pembayaran, PDF, scheduler | A | ✅ penuh (inti) |
| M04 | Pipeline: lead sampai klien aktif | A | ✅ |
| M05 | Tasks & Maintenance | A | ◐ |
| M06 | Dokumen: proposal, quotation, notulen | A+B | ◐ (proposal + notulen) |
| M07 | AI Core: provider, tool 3 tingkat, log, anggaran | B | ✅ |
| M08 | Action Center & Approvals | B | ✅ (inti demo) |
| M09 | Meeting Intelligence (STT) | B | ✅ (inti demo) |
| M10 | Marketing Studio | B | ◐ (gambar) |
| M11 | Telegram Assistant interaktif | B | ✅ target |
| M12 | Dashboard & BI | A | ◐ |
| M14 | Design System & UI Kit | B | ✅ lebih dulu |
| M15 | Audit & Guardrail Data | A | ✅ |
| M16 | Landing & Marketing Site (publik) | B | ✅ |
| M17 | Koneksi, Playbook, dan Operasi Deployment (GitHub, SSH, aaPanel, setup klien, drift kode, uptime) | B+A | ✅ (disetujui 2026-10-29) |

### 4.2 Di luar lingkup (dicatat, tidak dibangun di hackathon)

Portal klien; payment gateway dan rekonsiliasi otomatis; ~~integrasi GitHub/monitoring domain/server~~ (dimasukkan ke M17, 2026-10-29); profitabilitas berbasis jam kerja; forecast dan churn mendalam; billing SaaS milik platform sendiri, tier, dan onboarding self-serve; **video generation, TTS, embedding/RAG vektor** (tidak ada di Meta Model API, `docs/02`); knowledge base penuh (M13); integrasi kanal WhatsApp; SOW dan kontrak sebagai dokumen; multi-organisasi per pengguna (⚠️ M01).

## 5. Aturan bisnis lintas modul (CR)

Mengikat semua modul. BRD modul boleh memperinci, tidak boleh bertentangan.

| ID | Aturan |
|---|---|
| CR-01 | **Satu sumber kebenaran untuk setiap status.** Setiap status ditulis oleh satu service. Kondisi turunan (mis. "melewati jatuh tempo") **dihitung**, tidak disimpan sebagai status yang ditulis banyak jalur |
| CR-02 | **Isolasi data antar-organisasi di kode.** Semua query dan tool memfilter `org_id` yang berasal dari sesi, bukan dari input pengguna atau model |
| CR-03 | **Definisi uang tunggal.** "Total", "Tagihan", "Outstanding", "MRR", "Nilai pipeline" didefinisikan sekali (§7) dan dihitung satu service, dipakai sama di web, PDF, Telegram, dan AI |
| CR-04 | **Uang = integer Rupiah**, tidak pernah float. Pembayaran dicatat sebagai **baris mutasi append-only**; koreksi = baris baru, bukan mengubah/menghapus yang lama |
| CR-05 | **Kode menentukan fakta; AI menjelaskan dan menyusun.** Nominal, pajak, tanggal, jatuh tempo, dan status pembayaran tidak pernah berasal dari keluaran model; angka dalam jawaban AI berasal dari hasil tool |
| CR-06 | **Tool AI tiga tingkat**: `read` (langsung), `draft` (membuat draft tak berlaku), `act` (wajib persetujuan manusia). Daftar tool baku di BRD-M07; tool baru hanya lewat perubahan BRD |
| CR-07 | **Aksi `act` dijalankan oleh service yang sama** dengan tombol manual (aturan, validasi, audit identik); tidak ada jalur khusus AI |
| CR-08 | **Dokumen dan pesan keluar adalah draft** sampai disetujui dan difinalkan oleh manusia. Tidak ada pengiriman otomatis |
| CR-09 | **Semua aksi bermakna tercatat** (siapa/apa, kapan, entitas, hasil) di audit log append-only |
| CR-10 | **Idempotensi:** event/rule yang sama tidak boleh menghasilkan invoice, pesan, atau temuan ganda |
| CR-11 | **Anggaran dan batas AI:** anggaran harian per fitur diperiksa sebelum panggilan; batas putaran tool dan token per run; setiap panggilan tercatat (token, biaya) |
| CR-12 | **Konten tak tepercaya = data, bukan instruksi** (dokumen, chat, transkrip, email, hasil web). Tool `act` tidak boleh dipicu langsung dari teks tak tepercaya |
| CR-13 | **Kejujuran AI:** hasil AI diberi label "dibantu AI"; bila model gagal/tidak tersedia, tampil "ini bukan hasil AI", tidak menyamarkan jawaban generik |
| CR-14 | **Integrasi pihak ketiga dibungkus antarmuka** (`AiProvider`, `Storage`, `Notifier`, dll.) dan skill integrasinya dibaca/ditulis sebelum coding; kredensial dari konfigurasi |
| CR-15 | **Parameter bisnis dikonfigurasi, bukan hardcode** (grace period, offset pengingat, anggaran AI, target tiket, format nomor) dengan nilai default di BRD modul |
| CR-16 | **Data demo palsu.** Repo public dan kredit gratis Meta bisa melatih model: tidak ada data klien/kontrak nyata di seed, commit, atau panggilan model |
| CR-17 | **Tidak menjanjikan fitur yang Meta Model API tidak punya** (video, TTS, embedding) di UI, demo, atau dokumen |
| CR-18 | **Satu kosakata** (§7), semua teks UI lewat i18n, keterangan bahasa bisnis |
| CR-19 | **Definition of Done end-to-end** (UI → endpoint → service → data, terhubung ke modul dependen) dan E2E untuk fitur ber-UI (`docs/04`) |
| CR-20 | **Design system terkunci (Hallmark) sebelum halaman kedua dibangun**; komponen reusable dipakai di semua halaman |
| CR-21 | **Kerja baru saja:** tidak ada kode, aset, atau data yang disalin dari repo lain (`docs/01`) |

## 6. Model dan batas AI (rujukan, bukan duplikasi)

Model, harga, dan batas: `docs/02`. Hasil uji nyata: `docs/02` §0. Ringkas: Spark untuk agen/tool/structured output, Voice Transcribe untuk STT (maks 10 menit/file, Indonesia didukung), Image untuk gambar; **tanpa** video, TTS, embedding.

## 7. Glosarium istilah baku (satu konsep, satu nama)

| Istilah baku | Arti | Jangan dipakai |
|---|---|---|
| **Organisasi** | Agensi/startup pengguna sistem; batas isolasi data | tenant, workspace (di UI pakai "Organisasi") |
| **Pengguna** | Orang yang login ke satu organisasi | akun (untuk orang) |
| **Produk** | Software milik organisasi yang dijual/dilayani | aplikasi, sistem (untuk hal yang sama) |
| **Paket** | Varian harga resmi sebuah produk (nama, harga bulanan, fitur) | plan, tier |
| **Klien** | Pelanggan organisasi yang sudah/akan dilayani | customer |
| **Deployment** | Satu instalasi produk untuk satu klien (domain, versi, environment) | instance, cabang (untuk hal ini) |
| **Subscription** | Siklus tagihan berulang klien untuk satu produk dan paket | langganan (di UI Indonesia boleh "Langganan") |
| **Invoice** | Tagihan bernomor kepada klien | faktur (kecuali pajak) |
| **Status invoice** | `Draft`, `Terkirim`, `Lunas`, `Batal` (disimpan) | — |
| **Lewat jatuh tempo** | Kondisi **turunan**: jatuh tempo < hari ini dan status bukan `Lunas`/`Batal`. Tidak disimpan sebagai status (CR-01) | overdue sebagai status tersimpan |
| **Pembayaran** | Catatan uang masuk untuk satu invoice (append-only) | transaksi |
| **Outstanding** | Σ (total invoice berstatus `Terkirim`) − Σ pembayaran terhadapnya | piutang (di UI boleh "Belum dibayar") |
| **MRR** | Σ nominal subscription aktif dinormalisasi ke per bulan (nominal ÷ interval bulan) | revenue (umum) |
| **Lead** | Calon klien dalam pipeline | prospek |
| **Tahap lead** | `Baru`, `Penjajakan`, `Proposal`, `Negosiasi`, `Menang`, `Kalah` | — |
| **Task** | Pekerjaan; jenis `Tugas`, `Bug`, `Fitur`, `Maintenance` | tiket (di UI boleh "Tiket" hanya untuk jenis Bug/Maintenance) |
| **Temuan** | Satu item di Action Center hasil rule/event | alert, notifikasi |
| **Persetujuan** | Keputusan manusia atas satu aksi `act` (`Menunggu`, `Disetujui`, `Ditolak`, `Kedaluwarsa`) | konfirmasi (dipakai hanya untuk kartu UI) |
| **Draft** | Dokumen/pesan/entitas yang belum berlaku | konsep |
| **Run AI** | Satu eksekusi agen atau panggilan model yang tercatat | job |
| **Tool** | Fungsi yang boleh dipanggil model; tingkat `read`/`draft`/`act` | plugin |
| **Brand kit** | Nama, warna, nada bahasa untuk konten marketing | — |

## 8. Struktur BRD per modul dan urutan penulisan

### 8.1 Lokasi dan penamaan
`docs/brd/BRD-Mxx-<slug>.md`. Indeks dan status: `docs/brd/README.md`.

### 8.2 Template wajib setiap BRD modul
1. Tujuan & nilai bisnis · 2. Aktor & hak akses · 3. Lingkup (termasuk/tidak) · 4. Proses bisnis · 5. Aturan bisnis bernomor `BR-Mxx-nn` (Final/Usulan) · 6. Entitas bisnis & data kunci (konsep, bukan skema; skema di ERD) · 7. Keterkaitan modul · 8. Integrasi eksternal & skill · 9. Notifikasi & dokumen keluaran · 10. Kriteria penerimaan (dasar E2E) · 11. Risiko & pertanyaan terbuka (`⚠️ PERLU KEPUTUSAN OWNER`).

### 8.3 Urutan penulisan dan implementasi (mengikuti dependensi)
**Gelombang 1 — Fondasi:** M01 → M15 → M14.
**Gelombang 2 — Bisnis inti:** M02 → M03 → M04 → M05.
**Gelombang 3 — AI dan pengalaman:** M07 → M06 → M08 → M09 → M10 → M11 → M12.

Alur: tulis modul → ringkas ke owner dengan pertanyaan bersaran → approval → finalisasi. Mengingat tenggat, owner boleh menyetujui per gelombang.

## 9. Asumsi

1. Satu pengguna = satu organisasi di MVP (⚠️ BRD-M01).
2. Mata uang IDR saja; zona waktu default `Asia/Jakarta` (configurable).
3. Klien org tidak punya akun; semua interaksi klien terjadi di luar sistem.
4. Hosting live dan domain tersedia (D-007).
5. API Meta tersedia dan teruji untuk chat, tool calling, structured output, dan gambar; STT, vision, dan Responses API belum diuji (`docs/02` §0).

## 10. Risiko

| Risiko | Mitigasi |
|---|---|
| Cakupan terlalu besar untuk ±4 hari coding | Level MVP per modul; ◐ boleh dipangkas lebih lanjut; Telegram turun ke minimal bila perlu |
| Kemampuan model belum teruji (STT, vision, bahasa Indonesia) | Uji sebelum PRD dikunci; provider palsu untuk tes |
| Pelanggaran aturan kontributor/kerja baru | CR-21, D-018 |
| Biaya AI tak terkendali | CR-11 |
| Data nyata bocor | CR-16 |
| Prompt injection lewat dokumen/transkrip/chat | CR-12 |

## 11. Metrik keberhasilan

Demo end-to-end 3 menit berjalan tanpa penyuntingan data; semua kriteria penerimaan modul ✅ lulus E2E; setiap aksi AI dalam demo punya jejak di audit; biaya AI seluruh demo di bawah anggaran harian.

## 12. Rujukan

`docs/00`–`06`, `docs/09`, `docs/DECISIONS.md`, `docs/PLAN.md`.
