# 05 — UI/UX dan Komponen Reusable

Status: draf, menunggu review owner. Sumber pola: kontrak komponen form reusable (form-field, text-input, select-menu, textarea, checkbox, file-input, money-input, toggle, input-label, input-error). **Hanya kontrak (props, perilaku, aksesibilitas) yang diadopsi; tidak ada kode yang disalin.**

## 1. Aturan hackathon untuk komponen

Pola dan kontrak boleh diadopsi, **kode tidak boleh disalin** dari repo mana pun (`CLAUDE.md` aturan 1). Komponen diimplementasikan ulang di React + Tailwind, dengan desain visual **dibuat dengan skill `hallmark`** sebagai identitas produk ini, bukan meniru repo lama.

## 2. Design system

- Token (warna, tipografi, spacing, radius, bayangan) dideklarasikan di `:root` dan dipakai semua komponen. Tidak ada warna/font literal di luar token (aturan lantai Hallmark).
- Mode terang dan gelap wajib di setiap halaman; toggle tema tersedia, tidak hanya `prefers-color-scheme`.
- Arah visual ditentukan lewat `hallmark` pada tahap UI; hasilnya dicatat di DECISIONS dan token dikunci sebelum halaman kedua dibangun.
- Bahasa UI: **ID dan EN** dengan pengalih (`LocaleSwitch`), semua teks lewat kamus i18n dan hook `useT` (D-013). Bahasa awal: pilihan tersimpan, lalu bahasa browser, lalu Indonesia.

## 3. Kontrak komponen form (kontrak umum komponen form reusable)

Aturan: **dilarang kontrol mentah di halaman** (`<select>`, `<input type=checkbox|radio|number|file>`, `<textarea>`). Semua lewat komponen berikut di `src/components/forms/`.

| Komponen | Kontrak minimum (props/perilaku) |
|---|---|
| `FormField` | `label`, `name`, `help` (keterangan selalu terlihat **di bawah kontrol**), `tip` (penjelasan panjang lewat tombol "?"), `required` (tanda * + teks aksesibel), `error`. Menautkan label ke kontrol (`for`/`id`) dan `aria-describedby` |
| `TextInput` | `size` (md 40px / sm 32px), `prefix`, `suffix`, `icon`, `clearable`, `error`, `valid`, `disabled`; state `aria-invalid` otomatis |
| `NumberInput` | Angka dengan min/max/step; menolak huruf; tidak memakai `type=number` mentah |
| `MoneyInput` | Tampil `Rp 1.500.000`, **nilai yang dikirim integer polos**; hanya bilangan bulat; pintasan `500k`/`2rb`/`1,5jt` + Enter; min/max dengan pesan jelas; dua arah (`value`/`onChange`) |
| `DateInput` | Tanggal; nilai server `YYYY-MM-DD`; tampilan dari util format; mendukung min/max |
| `SelectMenu` | Pengganti `<select>`: `options {value,label,description?}`, `placeholder`, opsi "Semua", pencarian otomatis bila opsi > 7, navigasi keyboard penuh, `aria-haspopup=listbox`, dropdown tidak terpotong container, nilai terkirim ke form |
| `Textarea` | Tinggi otomatis (batas ±480px), `counter` "n / maxlength" |
| `Checkbox` | Seluruh baris bisa diklik, `label` + `description`, mendukung kumpulan pilihan, fokus keyboard terlihat |
| `Radio` / `SegmentedChoice` | Pilihan tunggal; varian segmen untuk 2–4 opsi |
| `Toggle` | `role=switch`, `label` + `description` bahasa bisnis (apa akibatnya bila dinyalakan), nilai off ikut terkirim |
| `FileInput` | Drag-and-drop + klik, validasi tipe via **MIME** (bukan hanya ekstensi), batas ukuran, pratinjau, progres, pesan error jelas; mendukung audio (rekaman rapat) dan gambar |
| `InputError` | Daftar pesan dengan `role=alert` |

Komponen UI umum (`src/components/ui/`): `Button` (primary/secondary/danger/link, `size`), `Card`, `Badge`, `Alert`, `Modal`, `Dropdown`, `Toast`, `Table` + toolbar (pencarian, filter, baris per halaman) + pagination, `Stat`, `Tabs`/`StepTabs`, `EmptyState`, `Skeleton`, `ThemeToggle`, `ApprovalCard` (khusus Action Center).

## 4. Konvensi

- Format tampilan lewat util tunggal `src/lib/format.ts` (Rupiah, angka, persen, tanggal). Dilarang `toLocaleString`/`Intl` ad-hoc di komponen.
- Semua teks lewat i18n. Keterangan **bahasa bisnis**, bukan istilah teknis.
- Status dan istilah satu makna di semua tempat (glosarium di BRD).
- Aksesibilitas: label terhubung, fokus terlihat, kontras, `prefers-reduced-motion`, keyboard penuh.
- Hydration: island React hanya untuk bagian interaktif (`client:load`/`client:visible`); halaman statis tetap `.astro`.
- Setiap komponen baru punya entri di galeri `/dev/komponen` (hanya development) dan satu tes dasar.

## 5. Pola UI khas produk ini

- **Action Center:** kartu temuan (konteks, alasan, nominal dari data, draft aksi) dengan tombol Setujui/Tolak/Edit. Setiap kartu menampilkan sumber data dan biaya AI.
- **Approval:** selalu menampilkan **apa tepatnya** yang akan dijalankan (tool + argumen terformat), bukan hanya teks AI.
- **Draft dokumen:** pratinjau PDF/HTML sebelum "Finalisasi".
- **Audit trail:** garis waktu per entitas (siapa/apa, kapan, hasil, biaya).
- **Unggah rekaman:** progres STT, hasil per pembicara, tombol "buat lead/proposal/task" (semua draft).

## 6. Daftar yang belum dibaca

Komponen tambahan (currency-input, custom-select, datepicker, icon-picker) dirinci saat menulis PRD komponen.
