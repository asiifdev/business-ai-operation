# BRD-M03 — Billing: Subscription, Invoice, Pembayaran, PDF

| | |
|---|---|
| **Status** | ✅ Disetujui owner (2026-10-28), v0.1.0 |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 2 — Bisnis inti / A |
| **Level usulan** | ✅ penuh (inti) |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-01, CR-03, CR-04, CR-05, CR-08, CR-10, CR-15 |
| **Prasyarat** | BRD-M01, M02, M15 |
| **Sumber** | konsep awal (Modul 2 Billing, workflow H-7/H+1), `docs/00` §2 (masalah 1, 5, 6), permintaan owner (PDF invoice) |

## 1. Tujuan & nilai bisnis

Modul yang berhubungan langsung dengan uang. Tujuannya: **tidak ada tagihan berulang terlewat**, invoice konsisten, dan status pembayaran selalu benar karena ditentukan kode, bukan AI. Menyediakan event overdue yang menjadi bahan utama Action Center (M08). Melayani G1, G3, G5.

## 2. Aktor & hak akses

| Aksi | Pemilik | Admin | Staf | Sistem | AI |
|---|---|---|---|---|---|
| Melihat subscription, invoice, pembayaran | ✅ | ✅ | ❌ ⚠️ | — | ✅ `read` |
| Membuat/mengubah subscription | ✅ | ✅ | ❌ | — | `draft` |
| Membuat invoice manual / mengubah draft | ✅ | ✅ | ❌ | ✅ (otomatis, draft) | `draft` |
| Menandai invoice `Terkirim` | ✅ | ✅ | ❌ | — | `act` (persetujuan) |
| Mencatat pembayaran | ✅ | ✅ | ❌ | — | ❌ (tidak pernah) |
| Membatalkan invoice | ✅ | ✅ | ❌ | — | ❌ |
| Mengunduh PDF invoice | ✅ | ✅ | ❌ | — | — |

**AI tidak pernah mencatat pembayaran dan tidak pernah mengubah status pembayaran** (BR-M03-10).

## 3. Lingkup

**Termasuk:** subscription (klien × produk × paket, nominal, interval bulan, tanggal jatuh tempo berikutnya, hari tenggang); **pembuatan invoice draf otomatis** sebelum jatuh tempo oleh scheduler; invoice manual; item invoice; nomor invoice berurut; status invoice; **pencatatan pembayaran manual** (append-only) dengan bukti opsional; deteksi **lewat jatuh tempo** (turunan); perpanjangan jatuh tempo setelah lunas; **PDF invoice** dari template; event overdue ke M08.

**Tidak termasuk:** payment gateway dan rekonsiliasi otomatis; pajak kompleks ⚠️; pengiriman email/WhatsApp ke klien ⚠️; kuitansi terpisah ⚠️; credit note ⚠️; multi-mata-uang; proration; diskon ⚠️.

## 4. Proses bisnis

### 4.1 Siklus subscription dan invoice otomatis
1. Pemilik membuat **Subscription** dari paket produk (nominal disalin dari paket sebagai default, dapat dinegosiasikan per klien).
2. Scheduler harian memeriksa subscription aktif: bila `jatuh_tempo − hari_ini ≤ offset` (default 7) dan **belum ada invoice untuk periode itu**, membuat **Invoice Draft** (idempoten, CR-10).
3. Pemilik/Admin meninjau draft, lalu **menandai Terkirim** (setelah PDF diunduh/dibagikan di luar sistem).
4. Pembayaran masuk → **mencatat pembayaran** (jumlah, tanggal, metode, bukti).
5. Bila Σ pembayaran ≥ total → invoice menjadi `Lunas`; `jatuh_tempo` subscription maju sebesar interval.
6. Bila hari ini > jatuh tempo invoice dan belum `Lunas` → kondisi **lewat jatuh tempo** (turunan); scheduler menerbitkan **event overdue** sekali per invoice (dedupe).

### 4.2 Invoice manual
Dibuat untuk pekerjaan sekali jalan (mis. setup fee): klien, item, jatuh tempo → Draft → Terkirim → Lunas.

### 4.3 PDF
Dokumen dirender dari data invoice yang sama (nominal tidak dihitung ulang di template) dan disimpan; unduh dari halaman invoice.

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M03-01 | Semua nominal **integer Rupiah**; total invoice = Σ (kuantitas × harga satuan) ± pajak bila ada; dihitung **satu service** | Final (CR-03, CR-04) |
| BR-M03-02 | **Status invoice tersimpan**: `Draft`, `Terkirim`, `Lunas`, `Batal`. **"Lewat jatuh tempo" adalah kondisi turunan**, tidak disimpan (CR-01) | Final |
| BR-M03-03 | Transisi valid: `Draft→Terkirim`, `Draft→Batal`, `Terkirim→Lunas`, `Terkirim→Batal`; `Lunas` dan `Batal` final | Usulan |
| BR-M03-04 | Invoice **tidak dapat diubah isinya** setelah `Terkirim`; koreksi = batalkan dan buat baru ⚠️ (credit note ditunda) | Usulan |
| BR-M03-05 | **Nomor invoice** berurutan per organisasi per tahun, format default `INV-YYYY-NNNN` (configurable), unik, tanpa celah akibat konkurensi | Usulan |
| BR-M03-06 | Pembayaran = **baris mutasi append-only** (jumlah > 0, tanggal, metode, pencatat); koreksi = baris baru berjenis koreksi, bukan ubah/hapus | Final (CR-04) |
| BR-M03-07 | `Lunas` ditentukan **service** dari Σ pembayaran ≥ total; tidak pernah diset langsung oleh AI atau input teks | Final (CR-05) |
| BR-M03-08 | Pembayaran sebagian diperbolehkan; invoice tetap `Terkirim` sampai Σ ≥ total ⚠️ | Usulan |
| BR-M03-09 | Pembuatan invoice otomatis **idempoten** per (subscription, periode); scheduler yang berjalan dua kali tidak menghasilkan invoice ganda | Final (CR-10) |
| BR-M03-10 | **AI tidak mencatat pembayaran, tidak mengubah status, nominal, atau jatuh tempo**; AI hanya membaca, menjelaskan, dan menyiapkan draft pesan follow-up | Final (CR-05) |
| BR-M03-11 | Offset pembuatan draf (default **7 hari**), **hari tenggang** (default **7**), format nomor, dan jam scheduler adalah parameter organisasi | Usulan (CR-15) |
| BR-M03-12 | Event overdue diterbitkan **sekali** per invoice (dedupe); pengingat lanjutan hanya atas persetujuan (M08) | Final |
| BR-M03-13 | Mengubah nominal subscription hanya berlaku untuk **invoice berikutnya** | Final |
| BR-M03-14 | Subscription `Berhenti` tidak menghasilkan invoice baru; invoice yang ada tetap | Usulan |
| BR-M03-15 | PDF dibuat dari **data tersimpan** (bukan keluaran AI); memuat identitas organisasi, klien, nomor, tanggal, item, total, jatuh tempo, dan info pembayaran organisasi | Final |
| BR-M03-16 | Perubahan status/pembayaran/pembatalan tercatat di audit dengan pelaku | Final (CR-09) |
| BR-M03-17 | Pajak (mis. PPN): tarif configurable per organisasi, default **0%**, dihitung service dan tampil terpisah di PDF ⚠️ | Usulan |

## 6. Entitas bisnis & data kunci

Subscription (`Aktif`/`Berhenti`), Invoice (`Draft`/`Terkirim`/`Lunas`/`Batal`) + Item, Pembayaran (mutasi, jenis `Pembayaran`/`Koreksi`), Berkas PDF. Skema di ERD.

## 7. Keterkaitan modul

Bergantung pada M01, M02 (paket, klien), M15 (audit, dedupe). Dipakai oleh M08 (event overdue), M06 (invoice sebagai dokumen), M12 (MRR, outstanding), M11 (status via Telegram), M07 (tool `read`/`draft`).

## 8. Integrasi eksternal & skill

Renderer PDF (Chromium via Playwright, ⚠️ verifikasi), penyimpanan berkas (`Storage`). Tidak ada gateway pembayaran.

## 9. Notifikasi & dokumen keluaran

Invoice PDF. Event ke M08: `invoice.draft_ready`, `invoice.overdue`. Pengiriman ke klien di luar sistem (⚠️ kanal).

## 10. Kriteria penerimaan

- [ ] Scheduler membuat **satu** draft invoice untuk subscription yang jatuh tempo ≤ 7 hari; menjalankan ulang tidak membuat ganda.
- [ ] Mencatat pembayaran penuh mengubah invoice menjadi `Lunas` dan memajukan jatuh tempo subscription sesuai interval.
- [ ] Pembayaran sebagian membiarkan invoice `Terkirim` dengan sisa yang benar.
- [ ] Invoice melewati jatuh tempo muncul sebagai "lewat jatuh tempo" tanpa kolom status yang ditulis scheduler, dan event overdue terbit tepat sekali.
- [ ] Hasil AI/Telegram tidak dapat mengubah status/nominal invoice (uji pemanggilan tool terlarang ditolak).
- [ ] PDF invoice memuat nominal yang **identik** dengan layar, nomor berurut, dan terbuka dengan benar.
- [ ] Invoice `Terkirim` tidak dapat diubah isinya.
- [ ] Pengguna org lain tidak dapat melihat/mengunduh invoice.

## 11. Risiko & pertanyaan terbuka

1. ⚠️ **Pajak**: ada PPN di invoice, atau 0% tanpa baris pajak di MVP?
2. ⚠️ **Kanal kirim ke klien** (email?) atau cukup unduh/salin tautan.
3. ⚠️ **Pembayaran sebagian** diizinkan?
4. ⚠️ **Credit note/koreksi** setelah terkirim: batalkan-dan-buat-baru cukup?
5. ⚠️ **Diskon** pada item/paket?
6. ⚠️ Jatuh tempo bulan pendek (tanggal 31) dan zona waktu: aturan penyesuaian (usulan: hari terakhir bulan).
7. ⚠️ Info pembayaran di PDF (nama bank/rekening organisasi) disimpan di Pengaturan Org (M01).
