# BRD-M14 — Design System & UI Kit

| | |
|---|---|
| **Status** | 🚧 Komponen form + token dikerjakan (izin eksplisit owner, 2026-10-28); komponen UI lain dan lint penuh menyusul |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 1 — Fondasi / B |
| **Level usulan** | ✅ lebih dulu |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-18, CR-20, CR-21 |
| **Prasyarat** | — (tidak bergantung pada ERD; kandidat dikerjakan lebih awal, butuh izin owner) |
| **Sumber** | `docs/05`; kontrak umum komponen form (**tanpa salin kode**); skill `hallmark`, `tailwind-4-docs` |

## 1. Tujuan & nilai bisnis

Satu identitas visual dan satu pustaka komponen yang konsisten, sehingga seluruh halaman terlihat dirancang (bukan generik) dan pekerjaan antarjalur tidak menduplikasi kontrol. Melayani nilai *Demo* (25%) dan G7.

## 2. Aktor & hak akses

Konsumen: pengembang (menggunakan komponen) dan pengguna akhir (merasakan hasilnya). Tidak ada hak akses bisnis.

## 3. Lingkup

**Termasuk:** token desain (warna, tipografi, spacing, radius), mode terang/gelap dengan toggle, komponen form (FormField, TextInput, NumberInput, MoneyInput, DateInput, SelectMenu, Textarea, Checkbox, Radio/SegmentedChoice, Toggle, FileInput, InputError), komponen UI (Button, Card, Badge, Alert, Modal, Dropdown, Toast, Table + toolbar + pagination, Stat, Tabs, EmptyState, Skeleton, ThemeToggle, ApprovalCard, AuditTimeline), util format (Rupiah, angka, persen, tanggal), i18n, galeri komponen `/dev/komponen`, aturan larangan kontrol mentah.

**Tidak termasuk:** halaman bisnis, ilustrasi/aset marketing, animasi kompleks.

## 4. Proses bisnis

1. Arah visual ditentukan dengan skill `hallmark` (direction), token dikunci dan dicatat di DECISIONS.
2. Komponen dibuat sesuai kontrak `docs/05` §3 dan didaftarkan di galeri dengan semua status (normal, error, disabled, terang/gelap).
3. Halaman bisnis hanya memakai komponen ini; kontrol mentah ditolak oleh lint/tes.
4. Komponen baru hanya ditambah bila belum ada yang setara (cek galeri dulu).

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M14-01 | Semua warna dan font melalui token di `:root`; tidak ada literal warna/font di komponen/halaman | Final (aturan lantai Hallmark) |
| BR-M14-02 | Mode terang dan gelap tersedia di setiap halaman dengan toggle; preferensi diingat | Final |
| BR-M14-03 | **Dilarang kontrol mentah di halaman** (`<select>`, `<input type=checkbox/radio/number/file>`, `<textarea>`); dijaga lint/tes | Final |
| BR-M14-04 | `MoneyInput` menampilkan `Rp` dan format ribuan tetapi **mengirim integer polos**; hanya bilangan bulat; pintasan `500k`/`1,5jt` | Final (CR-04) |
| BR-M14-05 | `FormField` menampilkan keterangan bahasa bisnis **di bawah kontrol** dan error dengan `role=alert`; label terhubung ke kontrol | Final |
| BR-M14-06 | `SelectMenu` mendukung pencarian bila opsi > 7, navigasi keyboard, dan tidak terpotong container | Final |
| BR-M14-07 | `FileInput` memvalidasi tipe berdasarkan **MIME**, batas ukuran, dan menampilkan progres/pratinjau; mendukung audio dan gambar | Final |
| BR-M14-08 | Format tampilan (Rupiah, tanggal, angka) hanya lewat util tunggal; dilarang `toLocaleString` ad-hoc | Final |
| BR-M14-09 | Semua teks UI lewat kamus i18n; bahasa default sesuai D-013 | Final |
| BR-M14-10 | Aksesibilitas: fokus terlihat, kontras memadai, keyboard penuh, hormati `prefers-reduced-motion` | Final |
| BR-M14-11 | Komponen **ditulis ulang di React/Tailwind**; tidak ada kode yang disalin dari repo lain | Final (CR-21) |
| BR-M14-12 | Setiap komponen punya entri galeri dan minimal satu tes dasar | Usulan |
| BR-M14-13 | Hero/halaman utama memenuhi aturan lantai Hallmark (tanpa metrik/testimoni karangan, tanpa eyebrow, dsb.) dan lolos `sloplint` | Final |

## 6. Entitas bisnis & data kunci

Token Desain, Komponen (kontrak props), Kamus i18n. Tidak ada entitas basis data.

## 7. Keterkaitan modul

Dipakai **semua modul ber-UI**. M08 (ApprovalCard), M15 (AuditTimeline), M03 (MoneyInput, DateInput, Table), M09/M10 (FileInput).

## 8. Integrasi eksternal & skill

Skill `hallmark` (✅ terpasang), `tailwind-4-docs` (⬜ snapshot dokumen belum diinisialisasi), Astro Docs MCP (✅). Tailwind v4 belum dipasang ⚠️.

## 9. Notifikasi & dokumen keluaran

Toast untuk umpan balik aksi. Galeri komponen internal.

## 10. Kriteria penerimaan

- [ ] Semua komponen di §3 ada di galeri dengan status normal/error/disabled dalam tema terang dan gelap.
- [ ] Tidak ada kontrol mentah di halaman mana pun (tes/lint hijau).
- [ ] `MoneyInput` mengirim integer: input `1,5jt` menghasilkan `1500000`.
- [ ] `SelectMenu` dapat dioperasikan penuh dengan keyboard dan menampilkan pencarian pada >7 opsi.
- [ ] `FileInput` menolak tipe/ukuran yang salah dengan pesan jelas dan menerima audio + gambar.
- [ ] Halaman utama lolos `hallmark sloplint` tanpa FAIL.
- [ ] Mengganti bahasa tidak meninggalkan teks hardcode.

## 11. Risiko & pertanyaan terbuka

1. ✅ **Bahasa UI** ID/EN dengan pengalih (D-013); komponen mengambil teks lewat `useT`.
2. ✅ **Mengerjakan M14 lebih dulu** (sebelum ERD disetujui): izin eksplisit owner diberikan 2026-10-28.
3. Tailwind v4 terpasang (`tailwindcss`, `@tailwindcss/vite`). ⚠️ Snapshot docs skill: owner menjalankan sinkronisasi dan menerima lisensi.
4. ⚠️ Komponen tambahan (currency-input, custom-select, datepicker, icon-picker): kontraknya dilengkapi saat PRD komponen.
5. ⚠️ Ikon: pustaka apa (lisensi, ukuran)?
