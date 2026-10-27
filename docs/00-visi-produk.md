# 00 — Visi Produk

Status: draf konsep, menunggu review owner. Sumber: konsep awal owner dan riset hackathon.

## 1. Ringkasan satu paragraf

Satu sistem operasi bisnis untuk **agensi dan startup software** yang mengelola banyak produk, banyak klien, dan banyak deployment. Sistem menyimpan data bisnis (portofolio, subscription, invoice, pipeline, tiket), lalu menaruh **AI Action Center** di atasnya: AI membaca kondisi nyata, menjelaskan masalah, menyiapkan draft tindakan, dan meminta persetujuan manusia sebelum menjalankan aksi berisiko. AI bukan kotak chat; ia lapisan operasi yang bekerja berdasarkan event, dan bisa diajak bicara lewat web maupun **Telegram interaktif**.

## 2. Pengguna dan masalah

**Pengguna utama:** founder/CTO agensi software kecil-menengah, tim 2–30 orang, mengelola 3+ produk dan 10+ klien.

Tujuh masalah (diadopsi dari konsep awal, dijadikan acuan BRD):

1. Subscription terlewat atau terlambat ditagih.
2. Banyak deployment per klien sulit diawasi (versi, domain, konfigurasi).
3. Permintaan klien tercecer (bug, fitur, komplain, maintenance).
4. Proses mendapatkan klien baru terlalu manual (lead → proposal → onboarding).
5. Proposal dan invoice dibuat berulang dengan risiko salah nominal.
6. Tidak ada gambaran kondisi bisnis menyeluruh (recurring revenue, piutang, churn).
7. Semua keputusan dan pengingat bergantung pada ingatan orang.

## 3. Pilar produk

| Pilar | Arti |
|---|---|
| Business Control Center | Portofolio, klien, deployment, subscription, invoice, pipeline, tiket dalam satu data model |
| AI Operations Engine | Analisis, deteksi anomali, rekomendasi, pembuatan dokumen, tindakan terkontrol |
| Automation & Integrations | Scheduler, event, notifikasi, PDF, Telegram, (nanti) payment gateway dan repository |
| Multimodal | Rekaman rapat jadi notulen, lead, proposal, dan task; gambar marketing; bukti/screenshot dibaca model |

## 4. Prinsip AI (tidak bisa ditawar)

1. **Kode menentukan fakta, AI menjelaskan dan menyusun.** Nominal, tanggal, pajak, status pembayaran tidak pernah ditentukan model.
2. **Observe → Reason → Prepare → Execute.** Pengawasan oleh scheduler/event; AI baru dilibatkan saat ada kondisi yang butuh konteks; draft disiapkan; aksi berisiko menunggu persetujuan.
3. **Tool tiga tingkat:** `read`, `draft`, `act`. `act` selalu butuh approval dan tercatat.
4. **Semuanya terlacak:** siapa/apa menjalankan, data yang terpengaruh, hasil, biaya.
5. **Data tiap klien/tenant terisolasi** di level kode.

## 5. Tingkat kematangan

- **Level 1 — Business Dashboard:** data dan tampilan.
- **Level 2 — AI Operations Manager:** deteksi, briefing, dokumen, pengelompokan, rekomendasi.
- **Level 3 — Controlled Autonomous Operations:** workflow terjadwal dengan approval dan penanganan gagal.

Target hackathon: **fondasi Level 1 yang kecil, demo Level 2 yang kuat** (lihat `docs/09-breakdown-fitur.md`).

## 6. Cerita demo hackathon (3 menit, draf)

1. Pagi hari, scheduler menandai invoice overdue (deterministik). Action Center menjelaskan konteks dan menyiapkan follow-up + invoice PDF; pemilik menyetujui lewat web **atau tombol Telegram**.
2. Rekaman rapat calon klien diunggah (atau voice note ke Telegram). Muse Voice Transcribe menghasilkan transkrip, lalu notulen, lead, draft proposal dari paket harga resmi, dan task.
3. Studio marketing membuat gambar promo produk dari data produk dan brand kit.
4. Audit trail menunjukkan setiap aksi AI, biaya, dan siapa yang menyetujui.

## 7. Bukan tujuan (non-goals) untuk hackathon

Portal klien, payment gateway, integrasi GitHub/monitoring domain, profitabilitas berbasis jam kerja, billing SaaS milik platform sendiri, video generation, TTS, RAG vektor penuh. Alasannya ada di `docs/02-meta-model-api.md` (kemampuan model) dan `docs/01-aturan-hackathon.md` (waktu).

## 8. Glosarium awal

| Istilah | Arti |
|---|---|
| Org / Tenant | Satu agensi/startup pengguna sistem. Batas isolasi data |
| Product | Produk software milik org (mis. Sistem POS) |
| Client | Pelanggan org |
| Deployment | Satu instalasi produk untuk satu klien (domain, versi, environment) |
| Subscription | Siklus tagihan berulang klien untuk produk |
| Action Center | Daftar temuan dan draft tindakan AI yang menunggu keputusan |
| Approval | Persetujuan manusia untuk tool tingkat `act` |
| Draft | Dokumen/pesan yang belum final dan belum terkirim |

⚠️ Daftar ini diperluas dan dikunci di BRD.
