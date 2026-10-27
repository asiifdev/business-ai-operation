# BRD-M04 — Pipeline Lead

| | |
|---|---|
| **Status** | 📝 Draf v0.1.0, menunggu review owner |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 2 — Bisnis inti / A |
| **Level usulan** | ✅ |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-01, CR-02, CR-06, CR-08, CR-09 |
| **Prasyarat** | BRD-M01, M02, M05 (task onboarding) |
| **Sumber** | konsep awal (Modul 3 AI Client Pipeline, Lead-to-Client), `docs/00` §2 (masalah 4) |

## 1. Tujuan & nilai bisnis

Perjalanan calon klien dari lead sampai klien aktif tidak lagi manual dan tercecer. Menjadi tujuan akhir alur multimodal (rekaman rapat → lead → proposal). Melayani G2.

## 2. Aktor & hak akses

| Aksi | Pemilik | Admin | Staf | Sistem | AI |
|---|---|---|---|---|---|
| Melihat pipeline | ✅ | ✅ | ✅ | — | ✅ `read` |
| Membuat/mengubah lead | ✅ | ✅ | ✅ | — | `draft` |
| Memindah tahap lead | ✅ | ✅ | ✅ | — | ❌ (usulan saja) |
| Menandai Menang/Kalah | ✅ | ✅ | ❌ | — | ❌ |
| Mengonversi lead menjadi klien | ✅ | ✅ | ❌ | — | `act` (persetujuan) |

## 3. Lingkup

**Termasuk:** lead (nama, kontak, sumber, ringkasan kebutuhan, nilai estimasi); tahap `Baru → Penjajakan → Proposal → Negosiasi → Menang/Kalah`; papan kanban; alasan kalah; **konversi Menang → Klien** (+ draf subscription/deployment dan checklist onboarding sebagai task); lead stagnan (turunan); lead hasil AI sebagai draft.

**Tidak termasuk:** email sequence/outreach otomatis; penilaian/skor lead oleh AI ⚠️ ditunda; integrasi sumber lead eksternal; multi-pipeline.

## 4. Proses bisnis

1. Lead dibuat manual atau dari **Meeting Intelligence (M09)** sebagai **draft** yang perlu diterima pengguna.
2. Pengguna memindah tahap; tahap `Proposal` menautkan dokumen M06.
3. `Kalah` mewajibkan alasan.
4. `Menang` → pengguna menyetujui **konversi**: dibuat Klien (cek duplikat), draf Subscription (dari paket), dan **checklist onboarding** (task, M05).
5. Lead stagnan (tanpa aktivitas > N hari) menjadi temuan di M08.

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M04-01 | Tahap baku: `Baru`, `Penjajakan`, `Proposal`, `Negosiasi`, `Menang`, `Kalah`; `Menang` dan `Kalah` final (dapat dibuka kembali hanya oleh Pemilik/Admin dengan catatan) ⚠️ | Usulan |
| BR-M04-02 | Transisi tahap divalidasi service (tidak boleh melompat ke `Menang` dari `Baru` kecuali diizinkan) ⚠️ | Usulan |
| BR-M04-03 | `Kalah` **wajib alasan** (teks/pilihan) | Final |
| BR-M04-04 | **Konversi lead menjadi klien butuh persetujuan manusia**; sebelum itu tidak ada Klien/Subscription yang dibuat | Final (CR-06/07) |
| BR-M04-05 | Konversi memeriksa **duplikat klien** (nama tidak peka huruf) dan menawarkan menautkan ke klien yang ada | Usulan |
| BR-M04-06 | Lead dari AI/rekaman bersifat **draft** (`Draf AI`) dan tidak masuk hitungan nilai pipeline sampai diterima | Usulan |
| BR-M04-07 | Nilai estimasi lead integer Rupiah; **nilai pipeline** = Σ nilai lead tahap terbuka (bukan Menang/Kalah), dihitung satu service | Final (CR-03) |
| BR-M04-08 | **Lead stagnan** adalah kondisi turunan: tidak ada aktivitas > ambang (default 14 hari, configurable) pada tahap terbuka | Usulan (CR-15) |
| BR-M04-09 | Checklist onboarding standar (setup deployment, buat subscription, invoice pertama, serah terima) dibuat sebagai task terhubung klien | Usulan |
| BR-M04-10 | Perubahan tahap, konversi, dan penutupan tercatat di audit | Final (CR-09) |

## 6. Entitas bisnis & data kunci

Lead (tahap, nilai, sumber, alasan kalah, asal `Manual`/`Rekaman`/`Telegram`, status draft), Aktivitas Lead (catatan, perubahan tahap). Skema di ERD.

## 7. Keterkaitan modul

Bergantung pada M01, M02 (klien/paket), M05 (onboarding). Dipakai oleh M06 (proposal dari lead), M09 (sumber lead), M08 (lead stagnan), M12 (nilai pipeline), M11.

## 8. Integrasi eksternal

Tidak ada.

## 9. Notifikasi & dokumen keluaran

Event `lead.stale` ke M08. Draft proposal dari M06.

## 10. Kriteria penerimaan

- [ ] Lead berpindah antar tahap di kanban; transisi tidak valid ditolak.
- [ ] Menandai `Kalah` tanpa alasan ditolak.
- [ ] Konversi `Menang` membuat Klien, draf Subscription, dan task onboarding **hanya setelah persetujuan**.
- [ ] Konversi dengan nama klien yang sudah ada menawarkan penautan, bukan duplikat.
- [ ] Lead draf AI tidak muncul di nilai pipeline sebelum diterima.
- [ ] Lead stagnan memunculkan temuan di Action Center.

## 11. Risiko & pertanyaan terbuka

1. ⚠️ Boleh membuka kembali `Menang`/`Kalah`?
2. ⚠️ Lead dari AI: draf terpisah (usulan) atau langsung `Baru` dengan label?
3. ⚠️ Ambang stagnan 14 hari?
4. ⚠️ Skor/prioritas lead oleh AI ditunda.
5. ⚠️ Satu lead banyak produk/paket?
