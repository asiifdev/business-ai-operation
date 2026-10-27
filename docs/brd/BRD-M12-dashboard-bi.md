# BRD-M12 — Dashboard & BI

| | |
|---|---|
| **Status** | 📝 Draf v0.1.0, menunggu review owner |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 3 — AI & pengalaman / A |
| **Level usulan** | ◐ |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-01, CR-03, CR-05 |
| **Prasyarat** | BRD-M03, M04, M05 |
| **Sumber** | konsep awal (Modul 7 BI & Profitability, dashboard), `docs/00` §2 (masalah 6) |

## 1. Tujuan & nilai bisnis

Satu gambaran kondisi bisnis yang **konsisten dan dapat dipercaya**: setiap angka dihitung satu service dan dipakai sama di dashboard, briefing, Telegram, dan jawaban AI. Melayani G3.

## 2. Aktor & hak akses

| Aksi | Pemilik | Admin | Staf | Sistem | AI |
|---|---|---|---|---|---|
| Melihat dashboard penuh | ✅ | ✅ | ❌ keuangan ⚠️ | — | ✅ `read` (`get_business_summary`) |
| Melihat ringkasan task | ✅ | ✅ | ✅ | — | ✅ |

## 3. Lingkup

**Termasuk:** kartu KPI **MRR**, **Outstanding**, **Jumlah lewat jatuh tempo (nominal dan jumlah)**, **Nilai pipeline**, **Klien aktif**, **Task terbuka/terlambat**; daftar singkat Action Center (M08); tren sederhana ⚠️ (mis. 6 bulan pendapatan lunas); data briefing harian.

**Tidak termasuk:** forecast, churn, profitabilitas berbasis jam/biaya, kohort, ekspor, dashboard kustom, BI ad-hoc oleh AI (AI hanya membaca angka siap pakai).

## 4. Proses bisnis

1. Pengguna membuka dashboard; **service ringkasan** menghitung KPI dari data M03/M04/M05 (dengan `org_id`).
2. Kartu menautkan ke daftar rinci (mis. outstanding → daftar invoice).
3. Briefing harian (M08) dan Telegram membaca **service yang sama**.

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M12-01 | Semua KPI dihitung oleh **satu service** dan dipakai identik oleh web, PDF, Telegram, briefing, dan tool AI | Final (CR-03) |
| BR-M12-02 | **MRR** = Σ nominal subscription `Aktif` dinormalisasi per bulan (nominal ÷ interval bulan) | Final (glosarium) |
| BR-M12-03 | **Outstanding** = Σ total invoice `Terkirim` − Σ pembayaran terhadapnya | Final |
| BR-M12-04 | **Lewat jatuh tempo** = invoice `Terkirim` dengan jatuh tempo < hari ini (kondisi turunan) | Final |
| BR-M12-05 | **Nilai pipeline** = Σ nilai lead pada tahap terbuka, tidak termasuk draft AI | Final (BR-M04-07) |
| BR-M12-06 | **Klien aktif** = klien dengan ≥ 1 subscription `Aktif` ⚠️ | Usulan |
| BR-M12-07 | Draft (invoice/lead/task) **tidak dihitung** dalam KPI sampai berlaku | Final |
| BR-M12-08 | "Hari ini" dan batas periode memakai **zona waktu organisasi** | Final |
| BR-M12-09 | AI tidak menghitung KPI; hanya menarasikan angka dari service | Final (CR-05) |
| BR-M12-10 | Angka di dashboard menyertakan **waktu perhitungan**; cache hanya bila konsisten dengan sumber ⚠️ | Usulan |

## 6. Entitas bisnis & data kunci

Tidak ada entitas baru; membaca M03/M04/M05. Opsional: snapshot harian untuk tren ⚠️ (dirinci di ERD bila diperlukan).

## 7. Keterkaitan modul

Bergantung pada M03, M04, M05, M01. Dipakai oleh M08 (briefing), M11 (/status), M07 (tool `get_business_summary`).

## 8. Integrasi eksternal

Tidak ada. Pustaka grafik ⚠️ (skill `dataviz` tersedia sebagai panduan desain, tidak dipasang di proyek).

## 9. Notifikasi & dokumen keluaran

Dashboard, kartu KPI, data briefing.

## 10. Kriteria penerimaan

- [ ] Dengan seed yang diketahui, MRR/Outstanding/Pipeline sama dengan hitungan manual.
- [ ] Angka yang sama muncul di dashboard, briefing, Telegram, dan jawaban AI.
- [ ] Mencatat pembayaran mengubah Outstanding seketika (atau sesuai aturan cache).
- [ ] Lead/invoice draft tidak memengaruhi KPI.
- [ ] Pengguna org B tidak melihat angka org A.

## 11. Risiko & pertanyaan terbuka

1. ⚠️ **Definisi Klien aktif** dan MRR untuk subscription tahunan (interval 12).
2. ⚠️ **Tren**: perlu snapshot atau cukup hitung dari pembayaran?
3. ⚠️ Staf boleh melihat angka keuangan?
4. ⚠️ Cache vs hitung langsung (volume demo kecil, usulan hitung langsung).
