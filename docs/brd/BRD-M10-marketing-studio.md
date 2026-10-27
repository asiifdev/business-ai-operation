# BRD-M10 — Marketing Studio

| | |
|---|---|
| **Status** | 📝 Draf v0.1.0, menunggu review owner |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 3 — AI & pengalaman / B |
| **Level usulan** | ◐ (gambar + caption; video **ditiadakan**) |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-05, CR-08, CR-11, CR-13, CR-16, CR-17 |
| **Prasyarat** | BRD-M02, M07 |
| **Sumber** | permintaan owner (image/video content generator untuk marketing), `docs/02` (Muse Image; tanpa video), hasil uji `docs/02` §0 |

## 1. Tujuan & nilai bisnis

Membuat konten promosi produk (gambar dan caption) dari **data produk yang sudah ada** dan brand kit, tanpa tool desain terpisah. Menyasar bonus *Best Creative Build* dan memperlihatkan pemakaian Muse Image. Melayani G5 dan G7.

## 2. Aktor & hak akses

| Aksi | Pemilik | Admin | Staf | Sistem | AI |
|---|---|---|---|---|---|
| Mengatur brand kit | ✅ | ✅ | ❌ | — | ❌ |
| Membuat konten | ✅ | ✅ | ✅ | — | `draft` |
| Menyimpan/mengunduh aset | ✅ | ✅ | ✅ | — | — |
| Menghapus aset | ✅ | ✅ | milik sendiri | — | ❌ |

## 3. Lingkup

**Termasuk:** **brand kit** (nama merek, warna, nada bahasa, larangan); pembuatan **gambar** dari produk + tujuan (peluncuran, promo, edukasi, rilis versi); beberapa varian; **penyuntingan lanjutan** (instruksi tambahan atas gambar terpilih); **caption** oleh Spark berdasar data produk; penyimpanan aset; unduh.

**Tidak termasuk:** **video generation, TTS/voiceover** (tidak ada di Meta Model API, CR-17); penjadwalan/posting ke media sosial; testimoni/metrik karangan; templat desain kompleks; kolase multi-halaman.

## 4. Proses bisnis

1. Pemilik mengisi **brand kit** sekali.
2. Pengguna memilih **produk**, tujuan, dan arahan singkat; sistem memeriksa anggaran dan menyusun prompt dari **data produk** dan brand kit.
3. Muse Image menghasilkan 1–N gambar; pengguna memilih, meminta revisi, atau membuang.
4. Spark membuat **caption** dari fakta produk (nama, deskripsi, paket resmi).
5. Aset disimpan dengan prompt dan penanda "dibuat AI"; pengguna mengunduh.

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M10-01 | Konten dibuat hanya dari **fakta di data produk/paket**; **tidak boleh** memuat testimoni, jumlah pengguna, atau metrik yang tidak ada di data | Final |
| BR-M10-02 | **Harga dan fitur** yang tampil di caption/gambar berasal dari paket resmi (M02); AI tidak menciptakan harga | Final (CR-05) |
| BR-M10-03 | Semua output berstatus **draft aset** sampai pengguna menyimpan; tidak ada posting otomatis | Final (CR-08) |
| BR-M10-04 | Aset berlabel **"dibuat AI"** di sistem (metadata); pengguna bertanggung jawab atas penggunaan publiknya | Final (CR-13) |
| BR-M10-05 | **Teks dalam gambar** diperiksa manusia sebelum dipakai (risiko salah eja); UI menyarankan caption terpisah daripada teks di gambar | Usulan |
| BR-M10-06 | **Kuota gambar harian** per organisasi (default 20/hari, configurable) dan anggaran AI diperiksa **sebelum** panggilan | Final (CR-11) |
| BR-M10-07 | Prompt tidak memuat data pribadi klien; konten tidak menampilkan nama klien tanpa izin ⚠️ | Usulan |
| BR-M10-08 | Respons yang terkena **filter keamanan** model ditampilkan sebagai gagal dengan pesan jelas dan tidak ditagih (sesuai dokumentasi) | Final |
| BR-M10-09 | Gambar disimpan sebagai berkas di Storage (bukan base64 di basis data); format asal (WebP) dipertahankan atau dikonversi | Usulan |
| BR-M10-10 | Fitur video/suara **tidak ditampilkan** di UI atau demo | Final (CR-17) |
| BR-M10-11 | Brand kit hanya dapat diubah Pemilik/Admin; perubahan tercatat di audit | Final |

## 6. Entitas bisnis & data kunci

Brand Kit (warna, nada, larangan), Aset Media (jenis, prompt, produk, berkas, penanda AI), Permintaan Konten (tujuan, arahan, hasil). Skema di ERD.

## 7. Keterkaitan modul

Bergantung pada M02 (produk/paket), M07 (Image, Spark, anggaran), M01 (brand kit di pengaturan), Storage. Dipakai oleh M11 ("buat poster promo" via Telegram) ⚠️.

## 8. Integrasi eksternal & skill

Meta: `muse-image-1.0` (`/v1/images/generations`, `/v1/images/edits`; uji nyata 2026-10-28: respons `b64_json` WebP). Skill `meta-model-api-integration` ⬜.

## 9. Notifikasi & dokumen keluaran

Galeri aset; unduhan gambar; caption siap salin.

## 10. Kriteria penerimaan

- [ ] Dari satu produk dengan brand kit, pengguna menghasilkan minimal satu gambar dan satu caption yang memuat **hanya fakta dari data produk**.
- [ ] Revisi lanjutan ("buat lebih terang") menghasilkan versi baru tanpa kehilangan yang lama.
- [ ] Harga di caption sama dengan paket resmi; tidak ada testimoni/metrik rekaan.
- [ ] Melewati kuota/anggaran harian memblokir dengan pesan jelas.
- [ ] Aset tersimpan sebagai berkas dengan penanda "dibuat AI".
- [ ] Tidak ada elemen UI untuk video atau suara.

## 11. Risiko & pertanyaan terbuka

1. ⚠️ **Kualitas teks dalam gambar** dan bahasa Indonesia belum diuji.
2. ⚠️ Ukuran/rasio output (sosial, banner) yang didukung endpoint.
3. ⚠️ Edit multi-turn lewat Responses API: format belum diuji.
4. ⚠️ Logo organisasi sebagai gambar referensi (image-to-image) diperlukan di MVP?
5. ⚠️ Kuota harian default 20 gambar.
