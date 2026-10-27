# BRD-M02 — Portfolio: Produk, Klien, Deployment

| | |
|---|---|
| **Status** | ✅ Disetujui owner (2026-10-28), v0.1.0 |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 2 — Bisnis inti / A |
| **Level usulan** | ✅ minimal |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-01, CR-02, CR-03, CR-05, CR-09 |
| **Prasyarat** | BRD-M01 |
| **Sumber** | `docs/00` §2 (masalah 2), konsep awal (Modul 1 Portfolio), pelajaran "satu produk ≠ satu klien ≠ satu branch" |

## 1. Tujuan & nilai bisnis

Satu tempat untuk tahu **produk apa, dipakai klien siapa, di deployment mana, versi berapa**. Menjadi sumber data resmi untuk paket dan harga yang dipakai proposal dan invoice, sehingga AI tidak pernah menebak harga. Melayani G1, G3, G5.

## 2. Aktor & hak akses

| Aksi | Pemilik | Admin | Staf | Sistem | AI |
|---|---|---|---|---|---|
| Melihat produk, klien, deployment | ✅ | ✅ | ✅ | — | ✅ `read` |
| Membuat/mengubah produk dan paket harga | ✅ | ✅ | ❌ | — | ❌ |
| Membuat/mengubah klien | ✅ | ✅ | ✅ (tanpa data kontrak) ⚠️ | — | `draft` |
| Mengelola deployment | ✅ | ✅ | ✅ | — | `draft` |
| Mengarsipkan klien/produk | ✅ | ✅ | ❌ | — | ❌ |

## 3. Lingkup

**Termasuk:** produk (nama, deskripsi, versi saat ini, **paket dan harga resmi**), klien (nama, kontak, catatan), deployment (produk × klien: domain, versi terpasang, environment, status), tampilan **360° klien** (deployment, subscription, invoice, task), penandaan **deployment tertinggal versi** (turunan), arsip.

**Tidak termasuk:** monitoring status server/domain otomatis; penyimpanan kredensial/rahasia deployment; integrasi repository/GitHub; branch Git; kontrak sebagai dokumen; cabang klien sebagai entitas terpisah ⚠️.

## 4. Proses bisnis

1. Pemilik membuat **Produk** dan mendefinisikan **Paket** (nama, harga bulanan integer IDR, daftar fitur).
2. Membuat **Klien**, lalu **Deployment** (memilih produk, mengisi domain/versi/environment).
3. Saat versi produk diperbarui, deployment dengan versi lebih lama otomatis tampil "tertinggal" (turunan).
4. Halaman klien menampilkan ringkasan dari modul lain (M03/M05).
5. Klien/produk yang punya riwayat tagihan hanya dapat **diarsipkan**, bukan dihapus.

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M02-01 | **Paket dan harga resmi hanya disimpan di Produk**; proposal, quotation, subscription, dan invoice mengambil dari sini; AI tidak mengubah dan tidak menebak harga | Final (CR-05) |
| BR-M02-02 | Harga paket integer Rupiah ≥ 0 | Final (CR-04) |
| BR-M02-03 | Satu produk dapat dipakai banyak klien; satu klien dapat memakai banyak produk; hubungan dicatat lewat **Deployment** | Final |
| BR-M02-04 | Kombinasi (produk, klien, environment) **unik** | Usulan |
| BR-M02-05 | **"Tertinggal versi"** adalah kondisi turunan: versi terpasang < versi produk saat ini; tidak disimpan sebagai status (CR-01) | Final |
| BR-M02-06 | Versi dibandingkan sebagai semver; format lain ditolak atau ditandai tak terbandingkan ⚠️ | Usulan |
| BR-M02-07 | **Rahasia deployment (kata sandi, token, env) tidak disimpan** di sistem | Final (keamanan) |
| BR-M02-08 | Klien/produk dengan subscription/invoice **tidak dapat dihapus**, hanya diarsipkan; arsip menyembunyikan dari daftar aktif tetapi data tetap utuh | Usulan |
| BR-M02-09 | Setiap perubahan produk, paket, klien, dan deployment tercatat di audit | Final (CR-09) |
| BR-M02-10 | Nama klien unik per organisasi (tidak peka huruf besar/kecil) untuk mencegah duplikat saat konversi lead | Usulan |
| BR-M02-11 | Perubahan harga paket **tidak mengubah** subscription/invoice yang sudah ada (nominalnya sudah tersimpan di sana) | Final (CR-03) |

## 6. Entitas bisnis & data kunci

Produk (nama, deskripsi, versi saat ini, status aktif/arsip), Paket (nama, harga bulanan, fitur) di bawah Produk, Klien (nama, kontak, catatan, status aktif/arsip), Deployment (produk, klien, domain, versi, environment, status). Skema di ERD.

## 7. Keterkaitan modul

Bergantung pada M01. Dipakai oleh M03 (paket → subscription), M04 (konversi lead menjadi klien), M05 (task terhubung klien/produk/deployment), M06 (harga paket di proposal), M10 (data produk untuk konten), M08/M12 (agregasi), M07 (tool `read`).

## 8. Integrasi eksternal

Tidak ada.

## 9. Notifikasi & dokumen keluaran

Tidak ada notifikasi. Halaman 360° klien dapat diekspor sebagai ringkasan ⚠️ tidak di MVP.

## 10. Kriteria penerimaan

- [ ] Produk dengan dua paket dapat dibuat; paket tampil sebagai sumber harga di proposal dan subscription.
- [ ] Klien dengan dua deployment (produk berbeda) tampil lengkap di halaman 360°.
- [ ] Menaikkan versi produk menandai deployment lama sebagai tertinggal tanpa menyimpan status.
- [ ] Menghapus klien yang punya invoice ditolak; mengarsipkan berhasil dan data tagihan tetap ada.
- [ ] Mengubah harga paket tidak mengubah invoice lama.
- [ ] Pengguna org B tidak melihat produk/klien org A.
- [ ] Tidak ada field untuk menyimpan kata sandi/token deployment.

## 11. Risiko & pertanyaan terbuka

1. ⚠️ **Cabang klien**: perlu entitas tersendiri atau cukup beberapa deployment (konsep awal menyebut "Client A — Cabang Klaten")?
2. ⚠️ **Konfigurasi/fitur kustom per klien**: dicatat di mana (catatan teks, atau modul Knowledge yang ditunda)?
3. ⚠️ Staf boleh melihat data kontrak/harga klien?
4. ⚠️ Versi non-semver (mis. tanggal)?
5. ⚠️ Impor data klien (CSV) di luar MVP.
