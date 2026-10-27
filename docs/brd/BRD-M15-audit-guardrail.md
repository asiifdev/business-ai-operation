# BRD-M15 — Audit & Guardrail Data

| | |
|---|---|
| **Status** | ✅ Disetujui owner (2026-10-28), v0.1.0 |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 1 — Fondasi / A |
| **Level usulan** | ✅ |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-04, CR-09, CR-10, CR-11, CR-12 |
| **Prasyarat** | BRD-M01 |
| **Sumber** | `docs/00` §4, `docs/03` §5–6 |

## 1. Tujuan & nilai bisnis

Menyediakan **jejak yang dapat dipercaya** atas semua aksi bermakna, penyimpanan persetujuan, dan mekanisme idempotensi untuk otomatisasi. Inilah yang membuat AI "terkendali": setiap tindakan dapat ditelusuri, dan event yang sama tidak menghasilkan efek ganda. Melayani G4 dan nilai juri (*Technical depth*, *Best Agentic Use-Case*).

## 2. Aktor & hak akses

| Aksi | Pemilik | Admin | Staf | Sistem | AI |
|---|---|---|---|---|---|
| Melihat audit organisasi | ✅ | ✅ | ❌ | — | ❌ |
| Melihat jejak run AI | ✅ | ✅ | ✅ (milik sendiri) | — | — |
| Menulis entri audit | — | — | — | ✅ (melalui service) | ✅ (melalui service) |
| Mengubah/menghapus entri | ❌ | ❌ | ❌ | ❌ | ❌ |

## 3. Lingkup

**Termasuk:** audit log append-only; **catatan run AI** (`ai_runs`: model, token, biaya, tool dipanggil); **persetujuan** (`approvals`: penyimpanan status dan keputusan; logika UI di M08); **catatan otomatisasi** (`automation_runs` dengan kunci dedupe); tampilan jejak per entitas dan per run.

**Tidak termasuk:** SIEM/ekspor ke sistem eksternal; analitik penggunaan; retensi lanjutan ⚠️.

## 4. Proses bisnis

1. Service yang mengubah data bermakna menulis satu entri audit dalam transaksi yang sama.
2. Rule otomatis mencoba menulis `automation_run(org, rule, dedupe_key)`; bila kunci sudah ada, rule **tidak** dijalankan lagi.
3. Setiap panggilan model menulis `ai_run` (fitur, model, token masuk/keluar, biaya, tool, ringkasan).
4. Tool `act` membuat `approval` berstatus `Menunggu`; keputusan manusia menyimpan pengambil keputusan dan waktu.
5. Pemilik membuka jejak per entitas (garis waktu) atau per run AI.

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M15-01 | Audit log **append-only**: tidak ada ubah/hapus lewat aplikasi; koreksi = entri baru | Final (CR-04, CR-09) |
| BR-M15-02 | Setiap entri memuat: organisasi, **pelaku** (`user:<id>` / `ai:<run>` / `system:<rule>`), aksi, entitas dan id, ringkasan perubahan, waktu | Final |
| BR-M15-03 | Entri audit ditulis **dalam transaksi yang sama** dengan perubahan datanya; gagal tulis audit = perubahan dibatalkan | Usulan |
| BR-M15-04 | **Kunci dedupe unik per (org, rule, kunci)** pada `automation_runs`; percobaan kedua tidak menghasilkan efek | Final (CR-10) |
| BR-M15-05 | `ai_run` mencatat model, token, **biaya yang dihitung**, tool dan statusnya, dan ringkasan input/output; **bukan** isi lengkap dokumen sensitif | Final (CR-11) |
| BR-M15-06 | Rahasia (API key, token Telegram, kata sandi) dan isi dokumen penuh **tidak pernah** masuk audit/log | Final |
| BR-M15-07 | `approval` menyimpan tool, **argumen persis**, rasional, pemohon, keputusan, pengambil keputusan, waktu; status baku `Menunggu`/`Disetujui`/`Ditolak`/`Kedaluwarsa` | Final |
| BR-M15-08 | Persetujuan hanya boleh diputuskan sekali (idempoten); keputusan kedua ditolak | Final |
| BR-M15-09 | Anggaran AI harian per fitur dihitung dari `ai_runs`; melewati anggaran memblokir panggilan baru | Final (CR-11) |
| BR-M15-10 | Entri audit diperlihatkan sesuai izin (staf tidak melihat audit keuangan org) | Usulan |

## 6. Entitas bisnis & data kunci

Entri Audit, Run AI, Persetujuan, Catatan Otomatisasi. Siklus Persetujuan: `Menunggu → Disetujui | Ditolak | Kedaluwarsa`. Skema di ERD.

## 7. Keterkaitan modul

Dipakai **semua modul** (menulis audit). M07 menulis `ai_run`; M08 mengelola UI persetujuan; M03/M05 scheduler memakai dedupe; M11 mengeksekusi persetujuan dari Telegram.

## 8. Integrasi eksternal

Tidak ada.

## 9. Notifikasi & dokumen keluaran

Tampilan garis waktu audit per entitas dan per run AI. Ekspor CSV ⚠️ tidak di MVP.

## 10. Kriteria penerimaan

- [ ] Perubahan status invoice, persetujuan, dan pengaturan org menghasilkan entri audit dengan pelaku yang benar (`user`/`ai`/`system`).
- [ ] Tidak ada jalur aplikasi yang dapat mengubah/menghapus entri audit (uji).
- [ ] Menjalankan rule overdue dua kali untuk invoice yang sama menghasilkan **satu** temuan/efek.
- [ ] Setiap panggilan model dalam demo muncul di `ai_runs` dengan token dan biaya.
- [ ] Persetujuan yang sama tidak dapat diputuskan dua kali (termasuk dari web dan Telegram bersamaan).
- [ ] Melewati anggaran harian memblokir panggilan AI berikutnya dengan pesan jelas.

## 11. Risiko & pertanyaan terbuka

1. ⚠️ Retensi dan pembersihan audit/ai_runs (ukuran tabel) tidak dirancang untuk MVP.
2. ⚠️ Kedaluwarsa persetujuan: berapa lama (usulan 24 jam)? Dirinci di BRD-M08.
3. ⚠️ Tingkat detail ringkasan input/output di `ai_runs` vs privasi.
