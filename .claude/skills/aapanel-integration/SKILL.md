---
name: aapanel-integration
description: Koneksi server lewat aaPanel API (M17), salah satu opsi koneksi yang berdiri sendiri. Baca sebelum menulis kode pelaksana aaPanel, tes koneksi, atau langkah playbook yang memakai panel.
---

# aaPanel API: panduan integrasi (M17)

Sumber: dokumentasi resmi `aapanel.com/docs/api/api-list.html` dibaca **2026-10-29** (sebagian halaman, mis. `databases-mysql.html`, dan `Document/api.pdf` tidak dapat dibaca isinya oleh alat baca; halaman API resmi sendiri menyebut PDF itu "belum selesai"). **Banyak hal tidak terdokumentasi di sini dan ditandai ⚠️: jangan mengandalkannya sebelum diuji terhadap panel uji owner.**

## 1. Bentuk integrasi di proyek ini

- aaPanel adalah **opsi koneksi server yang berdiri sendiri** (D-055); bukan cadangan SSH dan tidak bergantung padanya. Koneksi menyimpan `config.url` (alamat dan port panel) dan rahasia API key terenkripsi (BR-M17-02). Kode: `src/integrations/aapanel/` di balik `ServerRunner`.
- Langkah playbook yang tidak terbukti didukung aaPanel **ditolak saat rencana dibuat**, bukan gagal di tengah jalan (PRD M17).

## 2. Autentikasi (terdokumentasi)

- Aktifkan di panel: **Settings → API → Modify**, simpan **API secret key**, dan isi **IP whitelist** dengan IP server pemanggil. "Access will be denied" bila IP salah. Artinya **IP server Orbyte harus didaftarkan pemilik panel** (D-054 butir 5).
- Tiap permintaan membawa dua parameter: `request_time` (timestamp Unix saat ini) dan `request_token = md5(request_time + md5(api_sk))`. Keduanya harus dari timestamp yang sama.
- Base URL: `{alamat_panel}:{port_panel}/<path>`. Port bawaan tidak disebut dokumen ⚠️ (tiap panel berbeda).
- Sumber tidak resmi (forum, pustaka komunitas) melaporkan: token atau waktu salah dijawab **404**; permintaan umumnya `POST` `application/x-www-form-urlencoded`; panel versi 2 memakai awalan `/v2/`. Dokumen resmi memakai contoh string kueri. ⚠️ Diuji sebelum dipakai.

## 3. Catatan dari halaman resmi (dibaca ulang 2026-10-29)

- Halaman API resmi menyatakan **antarmuka yang sama dipakai oleh front end browser panel**, sehingga parameter permintaan di panel (DevTools → Network → Fetch/XHR) dapat dijadikan petunjuk untuk integrasi pihak ketiga. Artinya banyak endpoint **ada tetapi tidak terdokumentasi resmi**: boleh dipakai hanya setelah diamati dan diuji di panel uji owner, dan dicatat di skill ini per versi panel.
- Sumber resmi lain: PDF `Document/api.pdf` (ditandai belum selesai) dan contoh PHP/Python (`/docs/api_demo/api_demo_php.zip`, `api_demo_python.zip`) ⚠️ belum dibaca.
- Daftar API resmi hanya memuat dua halaman: **Website - PHP Project** dan **Databases - MySQL**. Tidak ada halaman resmi untuk perintah shell, git, nginx, atau berkas.

## 4. Endpoint terdokumentasi (sangat terbatas)

| Fungsi | Path |
|---|---|
| Config | `/config?action=get_token` |
| Query data | `/v2/data?action=getData` dengan `p`, `limit`, `table`, `search`, `order`, `type` (contoh `table=sites`) |

Halaman terpisah dirujuk untuk **PHP Project API** (`website-php.html`) dan **MySQL API** (`databases-mysql.html`), tetapi isinya tidak terbaca di sesi ini ⚠️.

## 5. Yang BELUM terbukti (ditandai ⚠️, uji pada panel uji owner)

- Membuat situs/domain dan konfigurasi nginx lewat API.
- Membuat database dan pengguna database.
- **Menjalankan perintah** atau git clone/pull lewat API, serta membaca commit terpasang (`git rev-parse HEAD`). Bila tidak ada, aaPanel **tidak mendukung** langkah `git_clone`, `git_update`, dan pembacaan commit; jangan menggantinya dengan jalan pintas yang tidak aman.
- Operasi berkas (menulis `.env`).
- Daftar layanan dan restart.
- Format respons dan kode galat; apakah ada pembatas laju.
- Perilaku panel v1 vs v2 (awalan `/v2/`).

## 6. Keamanan

- API key tidak pernah ke model/log/audit/respons API; keluaran respons disaring dari nilai rahasia (BR-M17-03).
- Parameter (domain, nama folder, nama database) divalidasi dengan pola ketat sebelum dikirim (BR-M17-04). Tidak ada eksekusi perintah bebas.
- Sertifikat TLS panel sering tidak tepercaya (panel memakai IP + sertifikat sendiri): pengguna memilih menyematkan sidik jari sertifikat atau menerima risikonya secara eksplisit ⚠️ (keputusan saat implementasi).
