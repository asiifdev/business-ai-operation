# BRD-M16 — Landing & Marketing Site

| | |
|---|---|
| **Status** | ✅ Disetujui owner (2026-10-28), v0.2.0. Progres implementasi: lihat `docs/PLAN.md` §1a |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 3 — AI & pengalaman / B (infrastruktur SEO lebih dulu; konten akhir dikunci setelah modul produk selesai) |
| **Level usulan** | ✅ (diminta owner; SaaS) |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-16, CR-17, CR-18, CR-20, CR-21 |
| **Prasyarat** | BRD-M14 (token dan komponen), BRD-M01 (daftar/masuk). Skill `hallmark` |
| **Sumber** | permintaan dan jawaban owner 2026-10-28; riset harga resmi vendor (Lampiran A); panduan `ai-seo` dan `schema` (dibaca 2026-10-28) |

## 1. Tujuan & nilai bisnis

Situs publik multi-halaman yang menjelaskan produk dengan jujur, membuatnya mudah **ditemukan (SEO)**, **dikutip mesin generatif (GEO)**, dan **dijawab langsung oleh mesin jawaban (AEO)**, lalu mengarahkan pengunjung ke daftar. Melayani G6 (siap dijual sebagai SaaS) serta nilai *Impact* dan *Demo* hackathon.

## 2. Aktor & hak akses

| Aktor | Akses |
|---|---|
| Pengunjung anonim (calon pelanggan, juri), mesin pencari, perayap AI, agen AI | Semua halaman publik |
| Pengguna masuk | Halaman publik tetap terbuka; tombol "Buka aplikasi" |
| Pemilik | Menyetel ID analitik dan verifikasi mesin pencari lewat variabel lingkungan |

## 3. Lingkup

**Termasuk**
- **Peta situs multi-halaman** (bukan satu halaman dengan jangkar), dwibahasa dengan **URL terpisah per bahasa**: Inggris di akar (`/`), Indonesia di `/id/`. Halaman: beranda; produk (ikhtisar + halaman per kemampuan: Action Center, billing dan invoice, rapat menjadi notulen, asisten Telegram, Marketing Studio); cara kerja; keamanan dan kendali AI; **harga**; perbandingan; FAQ; tentang; demo; changelog; kontak; privasi; syarat.
- **Ilustrasi interaktif** yang menjelaskan alur Action Center (temuan → draf AI → persetujuan manusia → jejak audit), dengan data contoh yang diberi label jelas.
- **Optimasi SEO, GEO, dan AEO** (BR-M16-12 sampai BR-M16-24), diperiksa otomatis setiap build.
- **Analitik GA4** dengan persetujuan (Consent Mode), hanya di halaman publik.
- **Halaman privasi dan syarat yang ditulis dari kondisi kode sebenarnya** (BR-M16-30 sampai BR-M16-33).
- Tombol utama ke `/register` (pendaftaran terbuka untuk semua orang, dengan pengaman, D-032).
- Aset merek: logo "Orbyte" (D-029).

**Tidak termasuk:** blog dan CMS; portal klien; penagihan SaaS milik platform (halaman harga menampilkan paket **terencana**, bukan checkout, lihat BR-M16-26); testimoni, logo klien, dan angka statistik karangan; analitik pada area aplikasi (`/app`); pelacak iklan.

## 4. Proses bisnis

1. Pengunjung (atau agen AI) membuka halaman publik, mendapat jawaban langsung, lalu memilih **Daftar**, **Masuk**, atau **Demo**.
2. Klaim fitur mengikuti **registri fitur** (`src/content/features.ts`) yang menyatakan status tiap kemampuan (`available`, `in_development`, `planned`) dan menunjuk baris `docs/PLAN.md`; tes menolak klaim "tersedia" bila PLAN belum ✅.
3. Setiap build menjalankan **pemeriksaan SEO/GEO/AEO otomatis** atas hasil build (BR-M16-24).
4. Sebelum rilis: audit `hallmark`, uji aksesibilitas dasar, uji tampilan seluler 320–768 px, dan verifikasi di Google Search Console, Bing Webmaster Tools, dan Brave (tindakan owner).

## 5. Aturan bisnis

### 5.1 Kejujuran dan konten

| ID | Aturan | Status |
|---|---|---|
| BR-M16-01 | **Tidak ada metrik, testimoni, logo klien, atau jumlah pengguna karangan.** Tanpa data nyata, bagian itu tidak tampil | Final (CR-16) |
| BR-M16-02 | Klaim fitur hanya untuk kemampuan yang **sudah berjalan**; sisanya diberi label "dalam pengembangan" atau "terencana". Tidak menjanjikan video generation, suara/TTS, atau embedding/RAG vektor | Final (CR-17) |
| BR-M16-03 | Semua teks lewat kamus i18n (EN/ID); tidak ada teks hardcode di komponen | Final (CR-18) |
| BR-M16-04 | Warna dan font hanya lewat token (M14); terang dan gelap tersedia | Final |
| BR-M16-05 | Contoh data di ilustrasi dan tangkapan layar hanya dari **seed palsu** dan diberi label "data contoh" | Final (CR-16) |
| BR-M16-07 | Aksesibilitas: satu `<h1>`, urutan judul benar, kontras memadai, fokus terlihat, teks alternatif, `prefers-reduced-motion` dihormati, ilustrasi dapat dioperasikan dengan keyboard dan tidak berputar otomatis | Final (BR-M14-10) |
| BR-M16-10 | Halaman menjelaskan jujur bahwa AI **menyiapkan draf dan meminta persetujuan**; tidak menyiratkan otomatisasi penuh | Final (CR-05, CR-12) |
| BR-M16-11 | Setiap halaman punya judul dan deskripsi unik per bahasa; tidak ada data pribadi di URL | Final |
| BR-M16-36 | Header, isi halaman, dan footer memakai **satu kontainer lebar yang sama** (`.wrap`) sehingga tepinya sejajar; tes menolak lebar kontainer lain | Final |
| BR-M16-37 | Beranda disusun seperti landing page SaaS modern: hero dengan banner produk, strip "dibangun di atas", "Cara kerja" interaktif, kemampuan, kendali, harga, FAQ, dan penutup; **tiap bagian punya karakter visual dan cara interaksi sendiri** (tidak monoton). Animasi hanya fade/geser ringan, berhenti bila `prefers-reduced-motion`, dan ada tombol jeda untuk animasi yang berjalan terus | Final (arahan owner 2026-10-28) |
| BR-M16-34 | Merek dan nama produk dibaca dari **satu berkas konfigurasi** (`src/config/brand.ts`), tidak ditulis ulang di komponen | Final (D-029) |

### 5.2 SEO teknis (mesin pencari)

| ID | Aturan | Status |
|---|---|---|
| BR-M16-12 | Seluruh halaman publik **dirender statis saat build** dan seluruh konten penting ada di **HTML awal** (bukan hasil JavaScript klien) | Final |
| BR-M16-13 | Setiap halaman: `<title>` unik (≤ 60 karakter), `meta description` unik (≤ 160 karakter), URL kanonik absolut, `lang`, tag Open Graph dan Twitter, satu `<h1>` | Final |
| BR-M16-14 | **hreflang timbal-balik** (`en`, `id`, `x-default`) di setiap halaman dan di sitemap | Final |
| BR-M16-15 | `sitemap.xml` memuat semua halaman publik beserta alternatif bahasa dan `lastmod` asli; `robots.txt` menunjuk ke sitemap; halaman yang tidak ada mengembalikan **404 sungguhan** | Final |
| BR-M16-16 | Performa: LCP ≤ 2,0 s pada profil seluler menengah, CLS ≤ 0,05, JavaScript halaman publik seminimal mungkin (island hanya untuk ilustrasi, banner persetujuan, dan pengalih); **font dihosting sendiri** (tanpa Google Fonts); gambar dioptimalkan dengan ukuran eksplisit | Final |
| BR-M16-17 | Struktur URL dangkal dan stabil; navigasi dan *footer* menautkan semua halaman penting (tautan internal sebagai tautan HTML biasa, bukan jangkar `#`); *breadcrumb* di halaman anak | Final |

### 5.3 GEO dan AEO (mesin generatif dan mesin jawaban)

| ID | Aturan | Status |
|---|---|---|
| BR-M16-18 | **Satu konten untuk manusia dan mesin**: tidak ada versi konten terpisah "untuk AI" dan konten tidak dipecah menjadi serpihan (sesuai panduan resmi Google). Struktur memakai judul dan paragraf biasa | Final |
| BR-M16-19 | Tiap halaman membuka dengan **jawaban langsung** (40–60 kata) atas pertanyaan utamanya, dengan judul bagian berbentuk pertanyaan yang dipakai orang; blok definisi, perbandingan (tabel), dan langkah memakai pola yang bisa dikutip berdiri sendiri | Final |
| BR-M16-20 | Fakta yang berubah (harga, batas, status) ditulis **sebagai teks di HTML** dan diberi tanggal ("Terakhir diperbarui"), tidak hanya di JSON-LD atau gambar | Final |
| BR-M16-21 | **`robots.txt` disengaja per tujuan**: perayap penemuan pencarian (Googlebot, Bingbot, `OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot`, `meta-webindexer`) diizinkan; pengambil atas permintaan pengguna (`ChatGPT-User`, `Claude-User`, `Perplexity-User`) diizinkan; kebijakan perayap **pelatihan model** (`GPTBot`, `ClaudeBot`, `meta-externalagent`, `Google-Extended`) adalah keputusan owner (usulan: diizinkan agar merek dikenal model, lihat §11). WAF/Cloudflare tidak boleh menantang perayap yang diizinkan | Usulan ⚠️ |
| BR-M16-22 | Berkas penemuan di akar: **`/llms.txt`** dan **`/llms-full.txt`** (dihasilkan otomatis dari konten halaman, bukan ditulis tangan terpisah), **`/pricing.md`** (harga sebagai teks mentah), dan tautan ke semuanya dari *footer* | Final |
| BR-M16-23 | **Data terstruktur JSON-LD** yang cocok dengan isi halaman: `Organization`, `WebSite` (tanpa `SearchAction`), `SoftwareApplication`, `BreadcrumbList`, `FAQPage` (hanya sebagai penanda semantik atas FAQ yang terlihat; **tidak dijanjikan menghasilkan rich result**, Google tidak lagi menampilkannya), `TechArticle` untuk changelog bila perlu. `Offer` hanya dipasang bila paket benar-benar dapat dibeli (BR-M16-26) | Final |
| BR-M16-24 | **Pemeriksaan otomatis atas hasil build** (`pnpm test`): satu `<h1>`; title dan description unik dan dalam batas; kanonik dan hreflang timbal-balik; JSON-LD valid dan fakta cocok dengan teks; semua tautan internal tembus; semua gambar ber-`alt`; sitemap lengkap; `llms.txt` dan `pricing.md` konsisten dengan halaman; tidak ada `noindex` tak sengaja; **tidak ada skrip pihak ketiga selain pemuat GA4 yang menunggu persetujuan** | Final |
| BR-M16-25 | Keterbaruan: setiap halaman menampilkan tanggal pembaruan asli (dari riwayat berkas/konten); halaman **changelog** dihasilkan dari `CHANGELOG.md` agar isinya nyata dan segar | Final |

### 5.4 Harga dan paket SaaS

| ID | Aturan | Status |
|---|---|---|
| BR-M16-26 | Halaman harga menampilkan **paket terencana** berdasarkan riset pasar (Lampiran A) dengan keterangan jujur bahwa penagihan platform belum aktif dan organisasi akses awal tidak dikenai biaya. Tanpa `Offer` di JSON-LD dan tanpa tombol bayar sampai penagihan nyata ada | Usulan ⚠️ |
| BR-M16-27 | Harga tampil dalam **USD** di halaman Inggris dan **IDR** di halaman Indonesia, ditulis sebagai teks; metodologi dan tanggal riset dicantumkan | Usulan ⚠️ |
| BR-M16-28 | Batas paket hanya memakai batas yang **dapat ditegakkan sistem** (jumlah pengguna, klien aktif, anggaran AI harian, menit STT, gambar per bulan) | Usulan |
| BR-M16-29 | Perbandingan dengan produk lain hanya memuat **fakta yang bersumber** dari halaman resmi vendor, dengan tanggal dan tautan sumber, dan tanpa klaim superioritas yang tidak dapat dibuktikan | Final |

### 5.5 Privasi, analitik, dan kepatuhan

| ID | Aturan | Status |
|---|---|---|
| BR-M16-30 | **GA4** dipasang dengan **Consent Mode v2**: default semua penyimpanan analitik ditolak, skrip Google **baru dimuat setelah pengunjung menyetujui**; tombol Setuju dan Tolak setara; pilihan dapat diubah kapan saja; ID pengukuran dari variabel lingkungan (tidak ada di repo) | Final (keputusan owner) |
| BR-M16-31 | GA4 **tidak** dimuat di area aplikasi (`/app`, `/api`) maupun halaman masuk/daftar; peristiwa yang dikirim hanya klik ajakan bertindak dan awal pendaftaran dari halaman publik | Final |
| BR-M16-32 | Halaman privasi dan syarat **ditulis dari kondisi kode dan infrastruktur sebenarnya** (data apa disimpan, di mana, oleh siapa diproses, kuki dan penyimpanan lokal apa yang dipakai, apa yang belum tersedia seperti penghapusan akun mandiri). Daftar itu berasal dari satu registri (`src/content/data-practices.ts`) dan **tes menolak** kuki/penyimpanan/host eksternal yang tidak tercatat di sana | Final (keputusan owner) |
| BR-M16-33 | Halaman hukum diberi keterangan jujur bahwa ini penjelasan praktik data, **bukan nasihat hukum**; tinjauan hukum profesional dianjurkan sebelum penjualan komersial | Final |
| BR-M16-35 | Pendaftaran terbuka untuk semua orang dilindungi: batas per IP, batas harian total organisasi baru, dan **Cloudflare Turnstile** pada formulir (⚠️ butuh kunci dari owner), karena tiap organisasi mendapat anggaran AI harian | Usulan ⚠️ (D-032) |

## 6. Entitas bisnis & data kunci

Tidak ada tabel basis data. Konten ada di berkas konten per bahasa (`src/content/**`), registri fitur, registri praktik data, dan konfigurasi merek.

## 7. Keterlacakan modul

Bergantung pada M14 dan M01. Isinya mengikuti status modul lain lewat registri fitur (satu sumber, diperiksa terhadap `docs/PLAN.md`).

## 8. Integrasi eksternal & skill

Skill `hallmark` (halaman penuh, anti-slop), `ai-seo`, `schema`, `site-architecture`. Integrasi: GA4 (hanya setelah persetujuan), Cloudflare Turnstile ⚠️, Google Search Console, Bing Webmaster Tools + IndexNow, pengiriman ke Brave (tindakan owner untuk verifikasi dan pengiriman; kode menyediakan tag verifikasi dari variabel lingkungan).

## 9. Notifikasi & dokumen keluaran

`sitemap.xml`, `robots.txt`, `llms.txt`, `llms-full.txt`, `pricing.md`, JSON-LD per halaman, tag Open Graph dan Twitter, gambar Open Graph.

## 10. Kriteria penerimaan

- [ ] Peta situs multi-halaman EN dan ID tersedia dan semua tautan internal tembus (tanpa navigasi hanya-jangkar).
- [ ] Pemeriksaan otomatis BR-M16-24 hijau pada hasil build.
- [ ] Rich Results Test dan Schema.org Validator lolos untuk tipe yang didukung; fakta di JSON-LD sama dengan teks halaman.
- [ ] LCP ≤ 2,0 s dan CLS ≤ 0,05 pada pengujian seluler; skor Lighthouse SEO, Aksesibilitas, dan Praktik Terbaik ≥ 95.
- [ ] `robots.txt`, `llms.txt`, `llms-full.txt`, dan `pricing.md` ada, tertaut dari *footer*, dan konsisten dengan halaman.
- [ ] Tidak ada klaim fitur yang belum berjalan; registri fitur terhadap PLAN lolos tes.
- [ ] Banner persetujuan: tanpa persetujuan tidak ada skrip atau kuki Google; setelah Setuju GA4 mengirim peristiwa; setelah Tolak tidak ada.
- [ ] Halaman privasi mencantumkan semua kuki, penyimpanan lokal, pemroses data, dan keterbatasan yang nyata; tes registri hijau.
- [ ] Ilustrasi interaktif dapat dipakai dengan keyboard, menghormati `prefers-reduced-motion`, dan berlabel data contoh.
- [ ] Pendaftaran publik terlindungi (batas per IP, batas harian, Turnstile bila kunci tersedia).
- [ ] Tampilan benar pada 320, 375, 414, dan 768 px tanpa gulir horizontal; `hallmark` audit tanpa FAIL.

## 11. Risiko & pertanyaan terbuka

1. ⚠️ **Nama "Orbyte"**: ada perusahaan bernama mirip (mis. Orbyte Aerospace Technologies, Turki, perangkat lunak dirgantara; Orbbyte, Spanyol). Domain dan merek dagang **belum diperiksa**. Periksa ketersediaan domain, DJKI (Indonesia), WIPO/USPTO/EUIPO sebelum dipakai komersial (D-029).
2. ⚠️ **Berkas logo resmi**: tautan Canva hanya menampilkan gambar JPG. Mohon ekspor logo (SVG atau PNG transparan, varian ikon dan horizontal, versi terang dan gelap) ke `public/brand/`. Sementara itu saya dapat membuat padanan SVG sederhana yang ditandai sementara.
3. ⚠️ **Perayap pelatihan model** (`GPTBot`, `ClaudeBot`, `Google-Extended`, `meta-externalagent`): izinkan (merek lebih mudah dikenal model) atau tolak (konten tidak dipakai melatih)? Usulan: izinkan penemuan dan pengambilan pengguna, putuskan pelatihan secara sadar.
4. ⚠️ **Paket dan harga** (Lampiran A): usulan harus disetujui; aktifkan penagihan nyata atau tetap "akses awal gratis" hingga setelah hackathon?
5. ⚠️ **ID pengukuran GA4** (`G-…`), kode verifikasi Google Search Console dan Bing, dan kunci Turnstile: owner membuatnya dan mengisi variabel lingkungan; saya tidak dapat membuatnya.
6. ⚠️ **Email kontak** resmi untuk halaman kontak dan privasi (permintaan penghapusan data).
7. ⚠️ **Halaman perbandingan** memuat nama vendor lain: dapat diterima selama fakta bersumber dan bertanggal (BR-M16-29)?
8. ⚠️ **Entitas dan penulis**: halaman "Tentang" dengan identitas nyata pendiri meningkatkan kepercayaan (E-E-A-T). Siapa yang dicantumkan dan seberapa banyak?
9. ⚠️ **Gambar Open Graph**: dibuat dari logo dan data contoh (dirender saat build) atau aset statis?

## Lampiran A — Riset pasar dan usulan paket (perspektif R&D / Business Development)

### A.1 Pasar dan posisi

Sasaran: agensi dan *software house* kecil-menengah (3–30 orang) yang kini menyambung manajemen proyek, penagihan, dan catatan rapat dengan banyak alat terpisah. Produk berposisi sebagai **lapisan operasi bisnis berbasis AI**: data terstruktur menjadi sumber kebenaran, AI menyusun draf dan penjelasan, manusia menyetujui, semuanya tercatat. Pembeda yang dapat dibuktikan di kode: persetujuan manusia untuk tindakan berisiko, jejak audit tak dapat diubah, isolasi organisasi di basis data, asisten Telegram interaktif, rapat menjadi notulen dan draf lead. Alat pembanding umumnya menonjolkan manajemen proyek, waktu, dan penagihan, dengan AI sebagai fitur tambahan.

### A.2 Harga pembanding (halaman harga resmi vendor, diambil 2026-10-28)

| Vendor | Paket → harga per pengguna per bulan (tagihan tahunan, kecuali dinyatakan) | Catatan |
|---|---|---|
| [Teamwork](https://www.teamwork.com/pricing/) | Free $0 (≤ 5 pengguna); Basics $9,99 (min. 3); Accelerate $24,99 (min. 5; invoice dari waktu tercatat); Optimize dan Enterprise: hubungi penjualan | Halaman hanya menampilkan harga tahunan; kredit AI berbasis penggunaan dijadwalkan November 2026 |
| [Productive](https://productive.io/pricing/) | Essential $10; Professional $25 (tagihan tahunan) atau $29 (bulanan); Ultimate: hubungi penjualan | **Halaman memuat angka yang tidak konsisten** ($12 vs $10; $25 vs $29; total 10 pengguna tidak sama dengan harga × 10); uji coba 14 hari |
| [Bonsai](https://www.hellobonsai.com/pricing) | Basic $9 (bulanan $15); Essentials $19 ($25); Premium $29 ($39); Elite $49 ($59) | Invoice, proposal, dan portal klien mulai paket Essentials; tidak ada fitur AI yang dicantumkan di paket |
| [Scoro](https://www.scoro.com/pricing/) | Time-billing ≈ $17; Quote to Cash ≈ $29; End-to-end ≈ $57 (min. 5 pengguna; diskon tahunan 13–17%) | Halaman tidak melabeli semua mata uang; kredit AI disertakan per pengguna |

Sumber lain (blog pembanding pihak ketiga) bertentangan satu sama lain dan **tidak dipakai** sebagai dasar harga.

### A.3 Temuan

1. Rentang pasar: **$9–$29 per pengguna** untuk paket yang memuat penagihan (Bonsai Essentials $19, Teamwork Accelerate $24,99, Scoro $17–29); $45–$57 untuk paket menyeluruh.
2. Ada paket gratis untuk tim kecil (Teamwork ≤ 5 pengguna): pesaing mengakuisisi lewat gratis.
3. Penagihan umumnya mulai di tingkat menengah; paket termurah hanya waktu dan tugas.
4. AI mulai ditagih berbasis penggunaan (kredit); biaya model produk ini kecil dan **dibatasi anggaran harian per organisasi** (D-025), sehingga dapat disertakan dalam paket.
5. Harga kompetitif untuk Indonesia perlu **dalam Rupiah** dan lebih rendah dari USD pasar global.

### A.4 Usulan paket (⚠️ keputusan owner)

| Paket | USD / pengguna / bulan (tahunan; bulanan) | IDR / pengguna / bulan (tahunan) | Untuk siapa | Batas yang dapat ditegakkan |
|---|---|---|---|---|
| **Starter** | $0 | Rp 0 | tim ≤ 3 orang mencoba | ≤ 3 pengguna, ≤ 5 klien aktif, anggaran AI harian kecil, tanpa Marketing Studio |
| **Team** | $15; $19 | Rp 149.000 | agensi 3–15 orang | pengguna min. 3; klien tak terbatas; invoice, langganan, Action Center, Telegram, rapat menjadi notulen (kuota menit per bulan) |
| **Business** | $29; $35 | Rp 289.000 | agensi 10–50 orang | min. 5 pengguna; anggaran AI dan kuota STT lebih besar; Marketing Studio; dukungan prioritas |
| **Enterprise** | hubungi kami | hubungi kami | kebutuhan khusus | sesuai perjanjian |

Penalaran: Team berada di bawah Bonsai Essentials/Teamwork Accelerate namun memuat AI, Telegram, dan rapat; Business berada di tengah Scoro dan mengikuti rentang Bonsai Premium. Kuota dan anggaran yang tepat dihitung dari biaya model nyata sebelum angka final dipublikasikan.

### A.5 Estimasi biaya AI per organisasi (dasar penetapan batas)

Tarif Meta Model API (`docs/02`): `muse-spark-1.3` $1,25 / $4,25 per juta token masuk/keluar; STT $0,18 per jam audio; gambar $0,01 per gambar. Contoh: satu organisasi Team dengan 2 jam rapat dan 20 gambar per bulan dan ±1.000 siklus agen ≈ di bawah beberapa USD per bulan; batas atas dijaga anggaran harian per fitur. Angka final dikunci setelah pengukuran penggunaan nyata.

## Lampiran B — Peta halaman dan niat pencarian

| URL (EN; ID di `/id/…`) | Pertanyaan utama yang dijawab (blok jawaban 40–60 kata) |
|---|---|
| `/` | Apa itu sistem operasi bisnis berbasis AI untuk agensi? Apa yang dilakukannya? |
| `/product` | Apa saja yang dilakukan produk ini? |
| `/product/action-center` | Bagaimana AI menemukan masalah dan meminta persetujuan sebelum bertindak? |
| `/product/billing` | Bagaimana invoice dan langganan berulang diotomatiskan tanpa kesalahan angka? |
| `/product/meetings` | Bagaimana rekaman rapat menjadi notulen, lead, dan draf proposal? |
| `/product/telegram` | Bagaimana menyetujui tindakan bisnis lewat Telegram? |
| `/product/marketing-studio` | Apa yang bisa dibuat Marketing Studio dan apa yang tidak? |
| `/how-it-works` | Bagaimana alur dari data ke temuan, persetujuan, dan audit? |
| `/security` | Bagaimana AI dikendalikan dan data tiap organisasi dipisahkan? |
| `/pricing` | Berapa harga dan apa batas tiap paket? |
| `/compare` | Bagaimana dibandingkan dengan alat manajemen proyek dan penagihan agensi? (bersumber, bertanggal) |
| `/faq` | Pertanyaan umum dengan jawaban langsung |
| `/about`, `/contact` | Siapa di balik produk ini dan bagaimana menghubungi? |
| `/demo` | Video demo 3 menit (setelah tersedia) |
| `/changelog` | Apa yang baru dan kapan? (dari `CHANGELOG.md`) |
| `/privacy`, `/terms` | Praktik data dan syarat penggunaan yang sebenarnya |
