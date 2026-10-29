# BRD-M11 — Telegram Assistant (interaktif)

| | |
|---|---|
| **Status** | ✅ Disetujui owner (2026-10-28), v0.1.0 |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 3 — AI & pengalaman / B |
| **Level usulan** | ✅ target (turun ke ◐ bila jadwal menekan) |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-02, CR-05, CR-06, CR-07, CR-08, CR-12, CR-13 |
| **Prasyarat** | BRD-M01, M07, M08, M09 |
| **Sumber** | permintaan owner (asisten Telegram interaktif, terhubung langsung ke sistem), `docs/03` §7, keputusan D-004 (skill pihak ketiga ditolak); skill `telegram-bot-integration` ⬜ wajib ditulis dari dokumentasi resmi Telegram Bot API |

> **Amandemen 2026-10-29 (M17):** persetujuan dan progres run playbook dapat diikuti di Telegram; foto atau screenshot percakapan klien menjadi draf task (bergantung hasil uji vision, PRD §10).

## 1. Tujuan & nilai bisnis

Pemilik/staf mengelola bisnis dari ponsel: bertanya status, menerima peringatan proaktif, **menyetujui aksi dengan tombol**, mengirim voice note rapat, dan memotret masalah, semuanya terhubung ke sistem dan aturan yang sama dengan web. Bukan chatbot teks: ada **tombol interaktif** dan **aksi nyata**. Melayani G1, G2, G4, G7.

## 2. Aktor & hak akses

| Aksi | Pemilik | Admin | Staf | Sistem | AI |
|---|---|---|---|---|---|
| Menautkan Telegram sendiri | ✅ | ✅ | ✅ | — | — |
| Bertanya status (`read`) | ✅ | ✅ | ✅ (sesuai izin) | — | ✅ |
| Menyetujui/menolak aksi via tombol | ✅ | ✅ | ❌ aksi keuangan | — | ❌ |
| Mengirim voice note/foto | ✅ | ✅ | ✅ | — | — |
| Menerima notifikasi proaktif | ✅ | ✅ | ✅ (sesuai izin) | ✅ (pengirim) | — |

**Izin di Telegram = izin pengguna yang tertaut** (BR-M11-03).

## 3. Lingkup

**Termasuk:** pairing chat ↔ pengguna (kode sekali pakai); perintah (`/start`, `/status`, `/overdue`, `/tugas`, `/briefing`, `/bantuan`, `/putus`) dan **bahasa alami** → tool yang sama dengan web; **inline keyboard** untuk Persetujuan (Setujui/Tolak/Detail) dan pilihan cepat; **voice note → M09**; **foto/screenshot → draft task** ⚠️ (bergantung uji kemampuan gambar); notifikasi proaktif dari M08 (opt-in); pembaruan pesan setelah aksi (tombol berubah jadi hasil); penanganan tombol usang; webhook terverifikasi.

**Tidak termasuk:** grup/channel Telegram; pesan ke **klien** lewat Telegram; pembayaran Telegram; multi-bahasa lanjutan ⚠️; mini-app web; menjalankan aksi keuangan terlarang (BRD-M07 Lampiran A).

## 4. Proses bisnis

1. **Pairing:** pengguna web membuat **kode tautan** sekali pakai (masa berlaku singkat) → mengirim `/start <kode>` ke bot → chat tertaut ke pengguna dan organisasinya.
2. **Tanya:** pengguna menulis "invoice apa yang telat?" → agen (M07) memanggil tool `read` → jawaban + tombol relevan.
3. **Notifikasi proaktif:** temuan baru (M08) dikirim sebagai kartu dengan **[Setujui] [Tolak] [Detail]**.
4. **Persetujuan:** menekan tombol → server memvalidasi pengguna, persetujuan masih `Menunggu`, dan izin → mengeksekusi lewat service → **mengedit pesan** menjadi hasil.
5. **Voice note:** diunduh dari Telegram → M09 → hasil ringkas dan tombol "Terima task/lead".
6. **Foto:** diteruskan ke pembacaan gambar → draft task dengan tombol "Buat task".

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M11-01 | Chat yang **belum tertaut** hanya dapat menerima instruksi pairing; semua perintah lain ditolak tanpa membocorkan data | Final |
| BR-M11-02 | Kode pairing **sekali pakai**, kedaluwarsa singkat (default 10 menit), terikat satu pengguna | Final |
| BR-M11-03 | Setiap aksi Telegram berjalan **atas nama pengguna tertaut** dengan **izin yang sama** (BR-M01-08); tidak ada hak tambahan karena lewat Telegram | Final |
| BR-M11-04 | Telegram memakai **tool dan service yang sama** dengan web (satu sumber kebenaran, CR-01/07); tidak ada logika bisnis di handler bot | Final |
| BR-M11-05 | Tombol Persetujuan membawa **id persetujuan terikat sesi** (bukan data aksi), memvalidasi ulang pengguna, status `Menunggu`, masa berlaku, dan izin saat ditekan; tombol usang ditangani dengan pesan jelas | Final |
| BR-M11-06 | Persetujuan **idempoten** lintas kanal; menekan dua kali atau dari web dan Telegram bersamaan hanya berhasil sekali | Final (BR-M15-08) |
| BR-M11-07 | Webhook diverifikasi dengan **secret token** dan hanya menerima pembaruan dari Telegram; permintaan tak terverifikasi ditolak | Final |
| BR-M11-08 | **Isi pesan, voice note, dan foto = data tak tepercaya**; instruksi di dalamnya tidak memicu tool `act` | Final (CR-12) |
| BR-M11-09 | Bot **tidak pernah mengirim pesan ke klien** atau pihak luar; hanya ke pengguna tertaut | Final (CR-08) |
| BR-M11-10 | Notifikasi proaktif **opt-in per pengguna**, dengan jam tenang dan pembatasan frekuensi (anti spam) | Usulan |
| BR-M11-11 | Rate limit per pengguna dan per chat; anggaran AI dari M07 berlaku | Final (CR-11) |
| BR-M11-12 | Jawaban AI berlabel "dibantu AI"; saat gagal: "ini bukan hasil AI" dan perintah dasar non-AI (`/overdue`) tetap bekerja | Final (CR-13) |
| BR-M11-13 | Voice note dibatasi **≤ 10 menit** (batas STT); lebih panjang ditolak/dipotong sesuai M09 | Final |
| BR-M11-14 | Token bot hanya di environment; tidak dicatat di log/audit | Final |
| BR-M11-15 | Pengguna dapat **memutus tautan** kapan saja; pemutusan oleh Pemilik/Admin untuk pengguna lain tercatat di audit | Final |
| BR-M11-16 | Pesan yang berisi nominal memakai format Rupiah yang sama (util format tunggal) | Final (CR-03) |

## 6. Entitas bisnis & data kunci

Tautan Telegram (pengguna ↔ chat id, status, preferensi notifikasi), Kode Pairing, Sesi Percakapan (konteks singkat), Pesan Terkirim (rujukan temuan/persetujuan untuk pembaruan). Skema di ERD.

## 7. Keterkaitan modul

Bergantung pada M01 (pengguna, izin), M07 (agen, anggaran), M08 (kartu, persetujuan), M09 (voice note), M05 (task dari foto). Dipakai sebagai permukaan alternatif M08/M12.

## 8. Integrasi eksternal & skill

Telegram Bot API (webhook, `inline_keyboard`, `callback_query`, `editMessageText`, unduh berkas). Pustaka bot (⚠️ kandidat grammY, D-010). Skill `telegram-bot-integration` ⬜ **wajib ditulis lebih dulu**: batas ukuran berkas bot, batas panjang `callback_data`, format webhook, rate limit, dan hal yang belum jelas ditandai ⚠️. Webhook butuh URL publik HTTPS (server live tersedia, D-007).

## 9. Notifikasi & dokumen keluaran

Kartu temuan, hasil aksi, briefing harian (opt-in), ringkasan rapat.

## 10. Kriteria penerimaan

- [ ] Pairing berhasil dengan kode valid; kode kedua kali/kedaluwarsa ditolak.
- [ ] Chat tak tertaut tidak mendapat data apa pun.
- [ ] "Invoice apa yang telat?" menghasilkan jawaban dengan nominal **identik** dengan web.
- [ ] Notifikasi overdue tiba dengan tombol; **Setujui** mengeksekusi lewat service yang sama, pesan berubah menjadi hasil, audit mencatat pengguna + run.
- [ ] Menekan **Setujui** dua kali / dari web dan Telegram: hanya satu berhasil.
- [ ] Tombol dari persetujuan kedaluwarsa menampilkan pesan jelas dan tidak mengeksekusi.
- [ ] Staf tidak dapat menyetujui aksi keuangan lewat Telegram.
- [ ] Voice note ≤ 10 menit menghasilkan notulen/draft sama seperti unggahan web.
- [ ] Teks di pesan/voice note yang menyuruh "setujui semua" tidak memicu apa pun.
- [ ] Webhook tanpa secret token ditolak.

## 11. Risiko & pertanyaan terbuka

1. ⚠️ **Pustaka bot** (grammY?) dan cara pengujian lokal (tunnel).
2. ⚠️ **Pembacaan foto** bergantung pada uji multimodal Meta.
3. ✅ **Bahasa pesan bot** mengikuti preferensi bahasa tiap pengguna (ID/EN) yang diatur di profil; default sama dengan UI (D-013). Diputuskan owner 2026-10-28.
4. ⚠️ **Staf**: boleh memakai Telegram di MVP atau hanya Pemilik/Admin?
5. ⚠️ **Jam tenang dan frekuensi** notifikasi default.
6. ⚠️ Risiko jadwal: bila menekan, M11 turun ke ◐ (notifikasi + tombol Persetujuan saja).

