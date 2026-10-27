# BRD-M01 — Organisasi, Auth, Peran & Tenancy

| | |
|---|---|
| **Status** | 📝 Draf v0.1.0, menunggu review owner |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 1 — Fondasi / A |
| **Level usulan** | ✅ dasar |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-02, CR-09, CR-15, CR-16 berlaku penuh |
| **Prasyarat** | — (modul pertama) |
| **Sumber** | `docs/03` §4 (tenancy), `docs/04`, `docs/DECISIONS.md` D-009/D-011 |

## 1. Tujuan & nilai bisnis

Menjadi batas keamanan seluruh sistem: siapa pengguna, organisasi mana, boleh melakukan apa. Tanpa modul ini, isolasi data (CR-02) dan akuntabilitas aksi AI (CR-09) tidak mungkin. Melayani G4 dan G6.

## 2. Aktor & hak akses

| Aksi | Pemilik | Admin | Staf | Sistem | AI |
|---|---|---|---|---|---|
| Mengatur organisasi (nama, zona waktu, bahasa, anggaran AI, parameter) | ✅ | ❌ | ❌ | — | ❌ |
| Mengelola pengguna dan peran | ✅ | ✅🔸 | ❌ | — | ❌ |
| Menyetujui aksi keuangan (`act`) | ✅ | ✅ | ❌ | — | ❌ |
| Menautkan Telegram milik sendiri | ✅ | ✅ | ✅ | — | — |
| Melihat jejak audit | ✅ | ✅ | ❌ | — | — |

🔸 = tidak dapat mengubah Pemilik. **Izin AI = irisan izin pengguna yang meminta ∩ tingkat tool** (BR-M01-08). Matriks izin per fitur dirinci di PRD.

## 3. Lingkup

**Termasuk:** pembuatan organisasi dan Pemilik pertama; login/logout dan sesi; peran dan izin (Pemilik, Admin, Staf); pengelolaan pengguna dalam organisasi; konteks tenant dari sesi; pengaturan organisasi (nama, mata uang IDR, zona waktu, bahasa, parameter konfigurasi CR-15, anggaran AI harian, nomor rekening/info pembayaran untuk invoice ⚠️); akun demo seed.

**Tidak termasuk:** SSO/Google login ⚠️; billing dan tier SaaS; panel admin platform; multi-organisasi per pengguna ⚠️; portal klien; MFA ⚠️.

## 4. Proses bisnis

1. **Registrasi:** calon Pemilik mengisi nama organisasi, email, kata sandi → organisasi + Pemilik dibuat dalam satu transaksi → masuk ke dashboard.
2. **Login:** kredensial valid → sesi dengan `user_id` dan `org_id`; semua permintaan berikutnya memakai `org_id` dari sesi.
3. **Undang pengguna:** Pemilik/Admin menambah pengguna (email + peran) ⚠️ cara undangan (tautan/sandi awal) → pengguna mengaktifkan akun.
4. **Ubah peran/nonaktifkan:** efektif segera; sesi pengguna dinonaktifkan dicabut.
5. **Pengaturan organisasi:** Pemilik mengubah parameter; perubahan tercatat di audit.

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M01-01 | Setiap permintaan, tool AI, handler Telegram, dan job berjalan dalam **satu konteks organisasi** (`org_id`) yang berasal dari sesi/tautan terverifikasi, tidak dari input pengguna atau model | Final (CR-02) |
| BR-M01-02 | Satu pengguna milik **tepat satu organisasi** di MVP | Usulan ⚠️ |
| BR-M01-03 | Organisasi baru selalu punya tepat satu Pemilik awal; **Pemilik terakhir tidak dapat dihapus/diturunkan** | Usulan |
| BR-M01-04 | Peran baku: `Pemilik`, `Admin`, `Staf`; izin per fitur ada di matriks PRD dan ditegakkan di **service** (bukan hanya menyembunyikan tombol) | Usulan |
| BR-M01-05 | Kata sandi disimpan sebagai hash kuat (pustaka auth terverifikasi, D-009); tidak pernah dicatat di log | Final |
| BR-M01-06 | Sesi punya masa berlaku dan dapat dicabut; sesi pengguna nonaktif tidak dapat dipakai | Usulan |
| BR-M01-07 | Pengaturan organisasi default: mata uang `IDR`, zona waktu `Asia/Jakarta`, bahasa sesuai D-013, hari tenggang 7, offset pengingat H-7 | Usulan (configurable, CR-15) |
| BR-M01-08 | Aksi oleh AI atau Telegram berjalan **atas nama satu pengguna** dan tidak boleh melebihi izin pengguna itu | Final |
| BR-M01-09 | Kegagalan login tidak membocorkan apakah email terdaftar; percobaan login dibatasi (rate limit) | Usulan |
| BR-M01-10 | Akun demo hanya dibuat oleh seed, menolak berjalan di `production`, dan memakai data palsu | Final (CR-16) |
| BR-M01-11 | Perubahan peran, pengaturan org, dan penonaktifan pengguna tercatat di audit (M15) | Final (CR-09) |

## 6. Entitas bisnis & data kunci

Organisasi (nama, slug, zona waktu, mata uang, bahasa, parameter), Pengguna (email, nama, peran, status aktif), Sesi, Pengaturan Org (anggaran AI harian per fitur, grace days, offset pengingat, info pembayaran). Siklus Pengguna: `Diundang → Aktif → Nonaktif`. Skema di ERD.

## 7. Keterkaitan modul

Dipakai oleh **semua modul** (konteks `org_id`, izin). M15 mencatat perubahannya. M11 memakai tautan pengguna ↔ chat Telegram. M07 membaca anggaran AI.

## 8. Integrasi eksternal

Pustaka auth (D-009, ⚠️ diputuskan di PRD; dukungan Astro diverifikasi lewat Astro Docs MCP/Context7). Tidak ada penyedia identitas eksternal di MVP.

## 9. Notifikasi & dokumen keluaran

Email undangan/reset kata sandi ⚠️ (butuh kanal email; lihat BRD induk §0.5). Alternatif MVP: tautan/sandi awal ditampilkan ke Pemilik.

## 10. Kriteria penerimaan

- [ ] Registrasi membuat organisasi + Pemilik; login membawa ke dashboard.
- [ ] Pengguna org A tidak dapat membaca/mengubah data org B lewat UI, endpoint, tool AI, maupun Telegram (uji dengan dua org seed).
- [ ] Staf tidak dapat menyetujui aksi keuangan; ditolak di service meski endpoint dipanggil langsung.
- [ ] Pemilik terakhir tidak dapat dinonaktifkan.
- [ ] Sesi pengguna yang dinonaktifkan langsung tidak berlaku.
- [ ] Perubahan peran muncul di audit dengan pelaku dan waktu.
- [ ] Seed demo menolak jalan di `NODE_ENV=production`.

## 11. Risiko & pertanyaan terbuka

1. ⚠️ **Metode login**: email + kata sandi saja, atau tambah tautan ajaib/Google?
2. ⚠️ **Undang pengguna** diperlukan di MVP atau cukup satu Pemilik + akun demo?
3. ⚠️ **Multi-organisasi per pengguna** ditunda (default usulan).
4. ⚠️ **MFA** ditunda.
5. ⚠️ RLS Postgres vs filter di repo (D-011), diputuskan di ERD.
