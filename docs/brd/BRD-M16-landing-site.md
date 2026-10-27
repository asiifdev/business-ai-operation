# BRD-M16 — Landing & Marketing Site

| | |
|---|---|
| **Status** | 📝 Draf v0.1.0, menunggu review owner |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 3 — AI & pengalaman / B (dikerjakan setelah M14 dan sebelum deploy akhir) |
| **Level usulan** | ◐ |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-16, CR-17, CR-18, CR-20, CR-21 |
| **Prasyarat** | BRD-M14 (token dan komponen), BRD-M01 (daftar/masuk). ⚠️ Nama brand (D-002) |
| **Sumber** | permintaan owner 2026-10-28 (produk dijual sebagai SaaS), `docs/00` §1, `docs/01` §3 (Impact dan Demo dinilai) |

## 1. Tujuan & nilai bisnis

Halaman publik yang menjelaskan produk dalam beberapa detik, meyakinkan **tanpa klaim palsu**, dan mengarahkan pengunjung ke daftar atau demo. Melayani G6 (siap dijual sebagai SaaS) dan nilai *Impact* serta *Demo* hackathon: juri yang membuka alamat live melihat produk yang tampak nyata, bukan formulir login kosong.

## 2. Aktor & hak akses

| Aktor | Akses |
|---|---|
| Pengunjung anonim (calon pelanggan, juri) | Semua halaman publik |
| Pengguna masuk | Dapat membuka halaman publik; ada tombol "Buka aplikasi" |
| Pemilik/Admin | Tidak ada fungsi khusus (konten statis dikelola lewat kode) |

## 3. Lingkup

**Termasuk:** beranda `/` (untuk semua pengunjung); bagian: hero dengan satu janji dan satu tindakan utama, masalah yang dipecahkan, cara kerja (data terstruktur → temuan → persetujuan manusia), **kemampuan nyata** (Action Center, rapat → notulen, Telegram interaktif, invoice PDF, Marketing Studio) lengkap dengan batasnya, kendali dan keamanan (persetujuan manusia, jejak audit, isolasi organisasi), untuk siapa, FAQ, ajakan bertindak; tampilan produk dari **data seed palsu**; dwibahasa ID/EN dengan pengalih; tema terang/gelap; metadata SEO dasar (judul, deskripsi, Open Graph, `sitemap.xml`, `robots.txt`); halaman `/demo` berisi video 3 menit setelah tersedia; tautan ke `/login` dan `/register`; halaman privasi dan syarat yang singkat ⚠️.

**Tidak termasuk:** blog dan CMS; harga paket SaaS dan penagihan platform (di luar lingkup BRD induk §4.2); portal klien; analitik atau pelacak pihak ketiga ⚠️; formulir newsletter/waitlist ⚠️; uji A/B; testimoni, logo klien, dan angka statistik (tidak ada data nyata, lihat BR-M16-01).

## 4. Proses bisnis

1. Pengunjung membuka `/`, memahami produk, lalu memilih **Daftar** (`/register`), **Masuk** (`/login`), atau **Lihat demo** (`/demo`).
2. Konten klaim mengikuti **fitur yang benar-benar ada**: bila modul belum jadi, klaimnya tidak ditulis (atau diberi label "segera").
3. Arah visual ditentukan dengan skill `hallmark` dan token M14 dikunci sebelum halaman kedua dibangun.
4. Sebelum rilis: audit `hallmark` (anti-slop), uji aksesibilitas dasar, uji tampilan seluler (320–414 px), dan pemeriksaan semua tautan.

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M16-01 | **Tidak ada metrik, testimoni, logo klien, atau jumlah pengguna karangan.** Bila tidak ada data nyata, bagian itu tidak ditampilkan | Final (aturan lantai Hallmark, CR-16) |
| BR-M16-02 | Setiap klaim fitur sesuai kemampuan yang **sudah berjalan** dan batas Meta Model API; tidak menjanjikan video generation, suara/TTS, atau embedding/RAG vektor | Final (CR-17) |
| BR-M16-03 | Semua teks lewat kamus i18n (ID/EN); tidak ada teks hardcode di komponen | Final (CR-18, BR-M14-09) |
| BR-M16-04 | Warna dan font hanya lewat token M14; terang dan gelap tersedia dengan pengalih | Final (BR-M14-01/-02) |
| BR-M16-05 | Tangkapan layar atau data contoh hanya dari **seed palsu**; tidak ada data klien nyata | Final (CR-16) |
| BR-M16-06 | Halaman publik tidak menyetel kuki pelacak dan tidak memuat skrip pihak ketiga tanpa keputusan owner | Usulan ⚠️ |
| BR-M16-07 | Aksesibilitas dan performa: satu `<h1>`, urutan judul benar, kontras memadai, fokus terlihat, gambar punya teks alternatif, `prefers-reduced-motion` dihormati; halaman statis dirender di build agar cepat | Final (BR-M14-10) |
| BR-M16-08 | Tombol utama membawa ke `/register` hanya bila pendaftaran publik terbuka; bila ditutup, tombol berubah sesuai kebijakan yang dipilih owner | Usulan ⚠️ |
| BR-M16-09 | Pengunjung yang sudah masuk **tidak dipaksa** pindah dari `/`; tersedia tombol "Buka aplikasi" | Usulan ⚠️ |
| BR-M16-10 | Halaman memuat penjelasan jujur bahwa AI **menyiapkan draf dan meminta persetujuan**; tidak menyiratkan otomatisasi penuh | Final (CR-05, CR-12) |
| BR-M16-11 | Setiap halaman publik memiliki judul dan deskripsi unik per bahasa dan tidak memuat data pribadi di URL | Usulan |

## 6. Entitas bisnis & data kunci

Tidak ada tabel basis data. Konten berupa teks di kamus i18n dan aset statis di repo (gambar dibuat dari seed palsu atau SVG buatan sendiri).

## 7. Keterlacakan modul

Bergantung pada M14 (token, komponen, `LocaleSwitch`, `ThemeToggle`) dan M01 (`/register`, `/login`). Isinya merujuk kemampuan M03, M07, M08, M09, M10, M11, dan M15, sehingga klaim diperbarui setiap modul selesai.

## 8. Integrasi eksternal & skill

Skill `hallmark` (wajib, mode halaman penuh dengan aturan makrostruktur, anti-slop, dan salinan jujur), `tailwind-4-docs`. Tidak ada integrasi eksternal. Gambar Open Graph: ⚠️ aset statis buatan sendiri; bila dibuat dengan Muse Image, diberi penanda "dibuat AI" (BR-M10).

## 9. Notifikasi & dokumen keluaran

`sitemap.xml`, `robots.txt`, metadata Open Graph per halaman.

## 10. Kriteria penerimaan

- [ ] Beranda memuat satu `<h1>`, satu tindakan utama, dan semua bagian di §3 tanpa angka, testimoni, atau logo karangan.
- [ ] Setiap klaim fitur dapat ditunjuk ke fitur yang berjalan; tidak ada klaim video, suara, atau embedding.
- [ ] Teks berganti penuh antara ID dan EN tanpa sisa teks hardcode.
- [ ] Terang dan gelap sama-sama terbaca; kontras lolos pemeriksaan.
- [ ] Tampilan benar pada lebar 320, 375, 414, dan 768 px tanpa gulir horizontal.
- [ ] `hallmark` audit tanpa temuan FAIL; semua tautan berfungsi (diperiksa otomatis).
- [ ] `sitemap.xml`, `robots.txt`, dan metadata Open Graph ada.
- [ ] Halaman tidak memuat skrip atau kuki pihak ketiga.
- [ ] Pengunjung masuk melihat tombol "Buka aplikasi" dan tidak dialihkan paksa.

## 11. Risiko & pertanyaan terbuka

1. ⚠️ **Nama brand dan logo** (D-002) belum diputuskan; halaman membutuhkannya sebelum ditulis.
2. ⚠️ **Pendaftaran publik terbuka** untuk semua orang, atau hanya undangan/waitlist? Tiap organisasi baru mendapat anggaran AI harian, jadi ini berkaitan dengan biaya (BR-M16-08).
3. ⚠️ **Bahasa utama** halaman: Indonesia dulu atau Inggris dulu (juri internasional)?
4. ⚠️ **Halaman harga**: tidak ada di lingkup. Cukup "hubungi kami", atau tampilkan paket SaaS (butuh keputusan bisnis dan billing platform)?
5. ⚠️ **Analitik** (mis. hitungan kunjungan tanpa kuki) diperlukan, atau tidak sama sekali?
6. ⚠️ **Privasi dan syarat**: cukup halaman singkat berisi penjelasan data demo palsu, atau perlu teks hukum lengkap?
7. ⚠️ **Posisi**: landing di `/` pada domain yang sama dengan aplikasi, atau domain terpisah?
8. ⚠️ Gambar produk: tangkapan layar dari aplikasi (seed palsu) atau ilustrasi buatan sendiri?
