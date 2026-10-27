# BRD-M05 — Tasks & Maintenance

| | |
|---|---|
| **Status** | ✅ Disetujui owner (2026-10-28), v0.1.0 |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 2 — Bisnis inti / A |
| **Level usulan** | ◐ |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-01, CR-02, CR-06, CR-09, CR-15 |
| **Prasyarat** | BRD-M01, M02 |
| **Sumber** | konsep awal (Modul 5 Maintenance & Issue Manager), `docs/00` §2 (masalah 3) |

## 1. Tujuan & nilai bisnis

Permintaan klien (bug, fitur, maintenance) dan pekerjaan internal tidak lagi tercecer; ada prioritas, tenggat, dan relasi ke klien/produk/deployment. Menjadi tempat mendarat task dari rekaman rapat dan Telegram. Melayani G1 dan G2.

## 2. Aktor & hak akses

| Aksi | Pemilik | Admin | Staf | Sistem | AI |
|---|---|---|---|---|---|
| Melihat task | ✅ | ✅ | ✅ | — | ✅ `read` |
| Membuat/mengubah task | ✅ | ✅ | ✅ | — | `draft` |
| Menutup task | ✅ | ✅ | ✅ (milik sendiri) | — | ❌ |
| Mengelompokkan task serupa | ✅ | ✅ | ✅ | — | `draft` (saran) |

## 3. Lingkup

**Termasuk:** task dengan jenis `Tugas`/`Bug`/`Fitur`/`Maintenance`; status `Terbuka`, `Dikerjakan`, `Selesai`; prioritas; tenggat; penanggung jawab; relasi opsional ke klien/produk/deployment/lead; **saran pengelompokan task serupa** oleh AI; tampilan daftar dan papan; task dari rekaman/Telegram sebagai draft.

**Tidak termasuk:** SLA kontraktual per paket ⚠️; pelacakan jam kerja; integrasi issue tracker/GitHub; subtask dan dependensi; sprint.

## 4. Proses bisnis

1. Task dibuat manual, dari checklist onboarding (M04), rekaman (M09), foto/pesan Telegram (M11), atau saran Action Center.
2. Pengguna menetapkan prioritas, tenggat, penanggung jawab.
3. Status berpindah `Terbuka → Dikerjakan → Selesai`.
4. Task melewati tenggat menjadi **terlambat** (turunan) dan masuk Action Center.
5. AI dapat menyarankan beberapa task serupa dihubungkan; pengguna menerima atau menolak.

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M05-01 | Jenis baku: `Tugas`, `Bug`, `Fitur`, `Maintenance`; status baku: `Terbuka`, `Dikerjakan`, `Selesai` | Usulan |
| BR-M05-02 | Prioritas baku: `Rendah`, `Sedang`, `Tinggi`, `Mendesak` | Usulan |
| BR-M05-03 | **"Terlambat"** adalah kondisi turunan: tenggat < hari ini dan status bukan `Selesai`; tidak disimpan (CR-01) | Final |
| BR-M05-04 | Task `Bug`/`Maintenance` tanpa tenggat mendapat **tenggat bawaan** menurut prioritas (default: Mendesak 1 hari, Tinggi 3, Sedang 7, Rendah 14), configurable | Usulan (CR-15) |
| BR-M05-05 | Task yang dibuat AI/rekaman/Telegram berstatus **draft** sampai diterima pengguna; draft tidak dihitung di "task terbuka" | Usulan |
| BR-M05-06 | Pengelompokan task serupa hanya **menautkan** (relasi `terkait`); tidak menggabungkan/menghapus task | Usulan |
| BR-M05-07 | Staf hanya menutup task yang ditugaskan kepadanya; Admin/Pemilik dapat menutup semua | Usulan |
| BR-M05-08 | Task yang berelasi ke klien/produk memakai entitas milik organisasi yang sama (divalidasi service) | Final (CR-02) |
| BR-M05-09 | Perubahan status dan penugasan tercatat di audit | Final (CR-09) |

## 6. Entitas bisnis & data kunci

Task (jenis, status, prioritas, tenggat, penanggung jawab, relasi, asal, status draft), Relasi Task (terkait). Skema di ERD.

## 7. Keterkaitan modul

Bergantung pada M01, M02. Dipakai oleh M04 (checklist onboarding), M08 (task terlambat), M09, M11, M12 (task terbuka), M07 (tool).

## 8. Integrasi eksternal

Tidak ada.

## 9. Notifikasi & dokumen keluaran

Event `task.overdue` ke M08. Telegram: notifikasi task terlambat dengan tombol aksi (M11).

## 10. Kriteria penerimaan

- [ ] Task `Bug` untuk klien/produk tertentu dapat dibuat dengan prioritas dan mendapat tenggat bawaan.
- [ ] Task lewat tenggat tampil "terlambat" tanpa kolom status yang ditulis job.
- [ ] Task draf dari rekaman tidak dihitung sebagai task terbuka sampai diterima.
- [ ] Dua task serupa dapat ditautkan atas saran AI tanpa kehilangan data.
- [ ] Staf tidak dapat menutup task orang lain.

## 11. Risiko & pertanyaan terbuka

1. ⚠️ **SLA** per paket/klien di MVP atau cukup tenggat bawaan?
2. ⚠️ Status tambahan (`Menunggu klien`/`Diblokir`)?
3. ⚠️ Boleh satu task banyak penanggung jawab?
4. ⚠️ Lampiran (screenshot) pada task: dari Telegram/web, disimpan di Storage.
