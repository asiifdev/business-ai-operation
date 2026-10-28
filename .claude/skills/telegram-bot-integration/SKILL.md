---
name: telegram-bot-integration
description: Integrasi bot Telegram interaktif di business-ai-operation (webhook, tombol inline untuk persetujuan, pairing akun, voice note dan foto, format pesan, rate limit). Baca sebelum menulis kode modul Telegram atau endpoint webhook.
---

# Telegram Bot API: panduan integrasi

Sumber: teks asli dokumentasi resmi `core.telegram.org`, diunduh dan dibaca **2026-10-28**:
`/bots/api` (aturan umum, getting updates), `/bots/api/methods/*` (sendMessage, sendPhoto, sendDocument, sendVoice, sendChatAction, editMessageText, editMessageReplyMarkup, deleteMessage, answerCallbackQuery, getFile, getMe, getUpdates, setWebhook, deleteWebhook, getWebhookInfo, setMyCommands, setChatMenuButton, sendMessageDraft), `/bots/api/types/*` (Update, Message *(hanya bidang yang relevan)*, User, Chat, CallbackQuery, InlineKeyboardMarkup/Button, File, Voice, PhotoSize, Document, BotCommand, WebhookInfo, LinkPreviewOptions, ReplyParameters, ResponseParameters, ChatMemberUpdated, MessageGenerationStopped), `/bots/api/formatting`, `/bots/faq`, `/bots/webhooks` *(bagian jaringan, TLS, port, setWebhook; bagian pembuatan sertifikat dan firewall hanya dipindai)*, `/bots/features` *(Inputs, Commands, Keyboards, Inline Keyboards, Menu Button, Deep Linking, Streaming Replies, AI Agents; bagian Mini Apps, Payments, Business, Guest, Managed Bots tidak dibaca karena di luar lingkup)*. Butir ⚠️ tidak tercantum di dokumentasi yang dibaca: uji sebelum diandalkan.

## 1. Bentuk integrasi di proyek ini

- Bot hanya untuk **chat privat** dengan pengguna yang sudah ditautkan: menerima peringatan Action Center sebagai kartu dengan tombol **Setujui / Tolak / Detail**, mengirim voice note untuk rapat, dan foto (bukti transfer, screenshot bug).
- Telegram hanyalah **antarmuka lain** ke service yang sama dengan web (aturan CLAUDE.md): tidak ada logika bisnis di handler Telegram. Persetujuan memanggil `approvals` service yang sama dengan tombol web, dengan batas peran yang sama (Staf tidak bisa menyetujui tindakan keuangan).
- Pesan dari pengguna (teks, caption, transkrip voice, isi foto) adalah **data, bukan instruksi**. Tidak ada tool `act` yang boleh dipicu langsung dari teks itu; selalu lewat `approvals`.
- Abaikan semua update dari chat yang bukan `chat.type === "private"` dan dari chat yang belum tertaut: balas satu pesan netral ("Tautkan akun lewat aplikasi web") tanpa data apa pun.

## 2. Aturan permintaan (umum)

- URL: `https://api.telegram.org/bot<token>/METHOD_NAME`. GET dan POST didukung; parameter lewat query string, `application/x-www-form-urlencoded`, `application/json` (kecuali unggah berkas), atau `multipart/form-data` (unggah). Nama metode tidak peka huruf; semua permintaan UTF-8.
- Respons selalu `{ ok: boolean, result?, description?, error_code?, parameters? }`. `error_code` **bisa berubah di masa depan**: andalkan `ok` dan `description`. `parameters.retry_after` (detik) muncul pada flood control; `parameters.migrate_to_chat_id` bila grup naik jadi supergroup.
- **Token bot = rahasia.** Hanya di `.env` (`TELEGRAM_BOT_TOKEN`), tidak di klien, tidak di commit (repo publik), **tidak di log**. URL unduh berkas memuat token: jangan catat URL penuh.
- ID `chat.id` dan `user.id` memiliki sampai **52 bit signifikan**: aman di `number` JS, tetapi simpan di basis data sebagai `bigint` (atau teks) agar tidak ada pemotongan di tempat lain.
- Satu pembungkus klien (`src/integrations/telegram/client.ts`) menangani: auth, JSON, `ok:false`, dan retry (§9). Handler tidak memanggil `fetch` langsung.

## 3. Menerima update: webhook (produksi) dan getUpdates (dev)

Dua cara **saling eksklusif**: `getUpdates` tidak jalan selama webhook terpasang. Update disimpan di server Telegram **maksimal 24 jam**.

**Produksi: webhook** (`POST` ke `https://ai-business.asiifdev.com/api/telegram/webhook`).

`setWebhook` (sekali saat deploy, bukan di tiap permintaan):

| Parameter | Catatan |
|---|---|
| `url` | HTTPS; string kosong menghapus webhook |
| `secret_token` | 1–256 karakter `A-Za-z0-9_-`; dikirim di header `X-Telegram-Bot-Api-Secret-Token` pada **setiap** permintaan |
| `allowed_updates` | `["message","callback_query","my_chat_member"]`. Default (kosong) sudah menyertakan hampir semua tipe kecuali `chat_member`, `message_reaction`, `message_reaction_count`; pilih daftar eksplisit agar kecil. Tidak memengaruhi update yang sudah tercipta |
| `max_connections` | 1–100, default 40. Turunkan agar tidak membebani server |
| `drop_pending_updates` | `true` bila ingin membuang antrean lama |
| `certificate`, `ip_address` | tidak diperlukan (sertifikat tepercaya) |

Persyaratan server (halaman webhooks): **hanya IPv4**; port **443, 80, 88, atau 8443**; **TLS 1.2+** (SSLv2/3, TLS 1.0/1.1 ditolak); CN/SAN sertifikat harus cocok dengan domain; rantai perantara harus dikirim lengkap; **redirect tidak didukung**; wildcard certificate mungkin tidak didukung. Telegram mengirim dari `149.154.160.0/20` dan `91.108.4.0/22` ("mungkin berubah": jangan hanya mengandalkan allowlist IP).

**Verifikasi keaslian (wajib):** bandingkan header `X-Telegram-Bot-Api-Secret-Token` dengan `TELEGRAM_WEBHOOK_SECRET` memakai pembanding waktu-konstan. Gagal → `401` tanpa memproses apa pun. FAQ juga menyarankan jalur URL rahasia sebagai lapisan tambahan.

**Perilaku pengiriman:** bila endpoint membalas non-`2xx`, Telegram mengulang "beberapa kali" lalu menyerah. ⚠️ Jumlah percobaan dan batas waktu respons tidak disebut: balas `200` **cepat** dan kerjakan hal berat (panggilan model, unduh berkas) secara asinkron. ⚠️ Urutan antar-update tidak dijamin dokumentasi; `update_id` naik berurutan dan dokumentasi menyebut gunanya untuk **membuang update ganda dan memulihkan urutan**.

**Idempotensi:** simpan `update_id` yang sudah diproses (tabel dedupe dengan unik pada `update_id`; selaras dengan `automation_runs` dedupe key). Update yang sama tidak boleh menyetujui dua kali atau mengirim dua pesan.

**Balasan inline di respons webhook** didukung (JSON dengan field `method`), tetapi **tidak bisa diketahui berhasil atau tidaknya**. Jangan dipakai untuk persetujuan; panggil API secara normal dan periksa `ok`.

**Dev lokal: `getUpdates`** (webhook butuh HTTPS publik). Panggil `deleteWebhook` dulu. Long polling: `timeout` positif (mis. 30), `limit` 1–100, dan **hitung ulang `offset` = `update_id` terakhir + 1** setiap respons, bila tidak update yang sama datang terus. Satu proses saja yang polling.

Diagnosis: `getWebhookInfo` → `url`, `pending_update_count`, `last_error_date`, `last_error_message`, `last_synchronization_error_date`, `max_connections`, `allowed_updates`. Periksa ini bila update tidak datang. `getMe` menguji token (`User` dengan `can_read_all_group_messages` dll.).

Contoh update palsu untuk uji: kirim `POST` JSON ke endpoint dengan `update_id` dan `message` (`chat`, `from`, `text`) beserta header secret.

## 4. Objek yang dibaca

- `Update`: `update_id` + **tepat satu** dari `message`, `callback_query`, `my_chat_member`, dst. Handle yang kita daftarkan; abaikan sisanya dengan `200`.
- `Message`: `message_id`, `chat` (`id`, `type`), `from` (`id`, `is_bot`, `language_code`), `date`, `text`, `entities`, `caption` (+`caption_entities`), `voice`, `photo` (array `PhotoSize`), `document`, `audio`, `media_group_id` (album: beberapa update, satu per foto). `from` bisa kosong di kanal; abaikan pesan tanpa `from`.
- `Voice`: `file_id`, `file_unique_id`, `duration`, `mime_type?`, `file_size?`. `PhotoSize`: `file_id`, `width`, `height`, `file_size?`; pilih ukuran terbesar yang ≤ 20 MB. `Document`: `file_name?`, `mime_type?`, `file_size?`.
- `CallbackQuery`: `id`, `from`, `message?`, `data` (≤ 64 byte).
- `my_chat_member` pada chat privat **hanya datang saat bot diblokir atau dibuka blokirnya** oleh pengguna: tandai tautan `telegram_links.blocked` dan hentikan pengiriman.
- `file_id` bisa dianggap persisten; `file_unique_id` tidak bisa dipakai mengunduh.

## 5. Kirim pesan

`sendMessage`: `chat_id`, `text` (**1–4096 karakter setelah parsing entitas**), `parse_mode`, `entities`, `link_preview_options` (`is_disabled`, dll.), `disable_notification`, `protect_content`, `reply_parameters` (`message_id`, `allow_sending_without_reply`, `quote`), `reply_markup`. `allow_paid_broadcast` jangan dipakai (berbayar Stars).

- Potong atau pecah teks > 4096 karakter. Caption foto/dokumen/voice maksimal **1024**.
- `sendChatAction` (`typing`, `upload_photo`, `record_voice`, `upload_document`, …) berlaku ≤ 5 detik atau sampai pesan tiba: panggil hanya untuk proses yang **terasa lama** (transkrip, panggilan model).
- `editMessageText` / `editMessageReplyMarkup` (butuh `chat_id`+`message_id`): **perbarui kartu yang sama** setelah disetujui atau ditolak (hapus tombol, tampilkan hasil) alih-alih mengirim pesan baru. Dokumentasi menyebut ini lebih cepat dan mulus.
- `deleteMessage`: hanya pesan < 48 jam. Jangan bergantung padanya untuk privasi.
- Streaming ala AI di chat privat: `sendMessageDraft` (`chat_id`, `draft_id` ≠ 0, `text` ≤ 4096; teks kosong menampilkan "Thinking…"; `can_stop` memunculkan tombol Stop). Draf **hanya pratinjau 30 detik**: hasil akhir **wajib** dikirim dengan `sendMessage`. Bila pengguna menekan Stop datang update `stopped_message_generation` (`chat`, `draft_id`): batalkan panggilan model. Opsional; jangan masuk jalur kritis.

### Format teks

Pakai **`parse_mode: "HTML"`** dan escape selalu, karena data kita memuat teks dari pengguna dan model.

- HTML: ganti `<` → `&lt;`, `>` → `&gt;`, `&` → `&amp;` pada semua teks yang bukan tag. Hanya tag yang didukung (`b strong i em u ins s strike del tg-spoiler code pre a blockquote`); tag lain gagal.
- MarkdownV2 (bila terpaksa): karakter `_ * [ ] ( ) ~ ` > # + - = | { } . !` harus di-escape dengan `\` di luar entitas; di dalam `code`/`pre` hanya `` ` `` dan `\`. Salah satu karakter lupa di-escape → seluruh pesan ditolak (400).
- Telegram menampilkan peringatan sebelum membuka tautan inline.
- Jangan menaruh `tg://user?id=…` di teks biasa (hanya jalan di tautan inline atau tombol).
- Teks buatan model **tidak boleh** dikirim mentah dengan `parse_mode`: escape dulu atau kirim sebagai teks polos tanpa `parse_mode`.

## 6. Tombol inline dan persetujuan (inti produk)

```json
{ "inline_keyboard": [[
  { "text": "Setujui", "callback_data": "ap:1f3a9c:y", "style": "success" },
  { "text": "Tolak",   "callback_data": "ap:1f3a9c:n", "style": "danger" }
], [
  { "text": "Detail",  "url": "https://ai-business.asiifdev.com/app/actions/1f3a9c" }
]] }
```

- Tepat **satu** tipe per tombol (di luar `text`, `style`, `icon_custom_emoji_id`). `style` opsional (`primary|success|danger`). `callback_data` **1–64 byte**: simpan hanya ID pendek acak/opak ke baris `approvals` (mis. `ap:<id>:<y|n>`), **bukan** payload, jumlah uang, atau data pribadi.
- **Jangan percaya `callback_data`.** Setiap callback: (1) cari `approvals` berdasarkan ID; (2) pastikan `callback_query.from.id` adalah pengguna tertaut ke organisasi pemilik approval; (3) periksa peran dan izin (Staf tidak bisa menyetujui tindakan keuangan); (4) pastikan status masih `pending`; (5) jalankan lewat service yang sama dengan web, dalam transaksi dengan penguncian baris, agar **dobel tekan atau web+Telegram bersamaan hanya menjalankan sekali**.
- **Wajib memanggil `answerCallbackQuery` untuk setiap callback**, walau tanpa notifikasi: klien menampilkan indikator loading sampai dijawab. Parameter: `callback_query_id`, `text` (0–200 karakter), `show_alert`, `cache_time`. Jawab **segera** (sebelum pekerjaan berat), lalu `editMessageText`/`editMessageReplyMarkup` untuk hasil.
- Pesan yang memuat tombol bisa sudah lama: callback bisa datang untuk approval yang sudah kedaluwarsa atau diputuskan di web. Tampilkan hasil sebenarnya ("Sudah disetujui oleh …"), jangan error.
- `CallbackQuery.message` bisa berjenis "maybe inaccessible"; simpan `chat_id` dan `message_id` kartu di tabel notifikasi kita untuk menyunting nanti.
- Keyboard balasan (`ReplyKeyboardMarkup`) hanya untuk input cepat; tidak dipakai untuk persetujuan.

## 7. Perintah, menu, dan pairing

**Perintah global** (diminta Telegram dari semua bot): `/start`, `/help`, `/settings` (bila ada). Perintah: huruf kecil Latin, angka, garis bawah, **1–32 karakter**; deskripsi 1–256; `setMyCommands` maksimum 100, `scope` dan `language_code` opsional. Daftarkan dengan `setMyCommands` saat deploy (mis. `start`, `help`, `status`, `pending`, `unlink`).

⚠️ Pembaruan Telegram: update **tidak memuat informasi scope** perintah; pesan bisa berisi perintah yang tidak ada. **Validasi sendiri** perintah dan otorisasi pengguna.

**Pairing (satu pengguna ↔ satu chat) memakai deep link:** `https://t.me/<bot_username>?start=<kode>`; Telegram mengirim `/start <kode>` ke bot. Parameter **maks 64 karakter**, hanya `A-Z a-z 0-9 _ -` (disarankan base64url).

1. Pengguna menekan "Tautkan Telegram" di web → server membuat kode acak ≥ 128 bit (base64url, ≤ 64 karakter), simpan **hash**-nya dengan `user_id`, `org_id`, kedaluwarsa pendek (mis. 10 menit), sekali pakai.
2. Bot menerima `/start <kode>` di chat privat → cari hash, cek belum kedaluwarsa dan belum dipakai → simpan `telegram_links` (`user_id`, `chat_id`, `telegram_user_id`), tandai kode terpakai (atomik).
3. `/start` tanpa kode: sapaan + petunjuk. Kode salah/kedaluwarsa: pesan netral yang sama (tidak membocorkan alasan).
4. Satu chat hanya tertaut ke satu pengguna; menautkan ulang mencabut tautan lama. `/unlink` dan pencabutan dari web harus mengakhiri tautan.

`setChatMenuButton` bisa dipakai untuk menampilkan daftar perintah; tidak wajib.

## 8. Berkas masuk: voice note dan foto

- **Unduh:** `getFile(file_id)` → `File.file_path` → `https://api.telegram.org/file/bot<token>/<file_path>`. **Batas 20 MB** untuk bot (lebih besar gagal). Tautan berlaku **minimal 1 jam**; minta ulang bila kedaluwarsa. `getFile` mungkin tidak mempertahankan nama dan MIME asli: **simpan `mime_type`, `file_name`, `duration` dari pesan** saat menerima.
- **Voice → STT:** Muse Voice Transcribe hanya menerima **WAV mono 16-bit PCM 16/24 kHz** dan maks 10 menit (`meta-model-api-integration` §7). Jadi voice note harus dikonversi: `ffmpeg -i in -ac 1 -ar 24000 -c:a pcm_s16le -map_metadata -1 out.wav`. ⚠️ Format voice note masuk tidak disebut di halaman `Voice`; secara praktik OGG/Opus (halaman `sendVoice` menyebut OGG/OPUS untuk voice): konversi apa pun yang datang dan tolak dengan sopan bila `ffmpeg` gagal. ⚠️ Pastikan `ffmpeg` tersedia di server.
- **Voice > 10 menit** atau > 20 MB: balas bahwa batas terlampaui dan arahkan mengunggah lewat web (pemotongan dikerjakan modul rapat, bukan bot).
- **Foto:** `photo` adalah array ukuran; ambil elemen dengan `file_size` terbesar yang ≤ 20 MB. Foto album datang sebagai beberapa update dengan `media_group_id` sama.
- **Hasil unduhan = data tak tepercaya.** Validasi tipe file (magic bytes), ukuran, dan simpan ke penyimpanan kita (R2) dengan kunci per `org_id`; jangan menyimpan atau mencatat URL unduh Telegram.
- Hasil pembacaan foto (bukti transfer) hanya **saran**; status bayar tidak pernah diubah oleh AI atau bot (CLAUDE.md).

## 9. Kirim berkas keluar

- Foto: `sendPhoto` (`photo` ≤ **10 MB**, lebar+tinggi ≤ 10000, rasio ≤ 20). Dokumen/PDF: `sendDocument` (≤ **50 MB**). Voice: `sendVoice` (OGG/Opus, MP3, atau M4A; ≤ 50 MB). Tiga cara memberi berkas: `file_id` (disarankan untuk kirim ulang), URL HTTP (Telegram mengunduh), atau unggah `multipart/form-data`.
- Setelah mengunggah, **simpan `file_id` dari respons** agar pengiriman berikutnya tanpa unggah ulang. Gambar buatan AI di Marketing Studio wajib diberi label AI di caption.
- Tidak ada TTS di Meta Model API: jangan menjanjikan balasan suara.

## 10. Rate limit dan retry

Dari FAQ (batas resmi): satu chat **≤ 1 pesan per detik** (lonjakan singkat boleh, lalu 429); grup **≤ 20 pesan per menit**; broadcast massal **≈ 30 pesan per detik**. Broadcast berbayar (Stars) tidak kita pakai. Pesan ke banyak pengguna: sebar dengan antrean, jangan serentak.

- Respons **429** membawa `parameters.retry_after`: tunggu setidaknya sebanyak itu lalu ulangi; maksimum beberapa percobaan.
- ⚠️ Teks galat untuk bot diblokir pengguna (HTTP 403) **tidak disebut** di halaman yang dibaca; tangani `ok:false` dengan `error_code` 403 sebagai "tidak bisa dikirim", tandai tautan terblokir, **jangan retry**. Sinyal resmi yang terdokumentasi adalah update `my_chat_member`.
- Galat 400 (`parse error`, teks terlalu panjang, pesan tak ditemukan untuk diedit): jangan retry; log `description` (tanpa token) dan turunkan ke teks polos bila gagal parse.
- Pengiriman keluar lewat antrean dengan kunci idempotensi per notifikasi (`automation_runs`): satu peringatan tidak mengirim dua kartu.
- Setiap pengiriman dicatat (tanpa isi sensitif) agar bisa ditelusuri; panggilan model di balik balasan tetap tercatat di `ai_runs`.

## 11. Pesan yang diterima bot

Chat privat: semua pesan sampai. Grup dengan *privacy mode* aktif (default): hanya perintah yang ditujukan ke bot, `/start` bila bot terakhir yang membalas, pesan lewat bot, dan balasan ke bot. Bot **tidak pernah melihat pesan bot lain**. Karena fitur kita hanya chat privat, tidak perlu mengubah privacy mode lewat BotFather. Bot tidak bisa memulai percakapan: pengguna harus menekan `/start` dulu (`chat_id` pengguna baru diketahui setelah itu; ⚠️ halaman FAQ tidak menjelaskan ini, tetapi inilah mengapa pairing lewat deep link).

## 12. Kontrak internal (dari CLAUDE.md)

1. Bot memanggil **service** yang sama dengan web; tidak ada jalur persetujuan yang hanya ada di Telegram.
2. Tool AI bertingkat `read`/`draft`/`act`: tindakan `act` yang diusulkan AI menjadi baris `approvals` + kartu Telegram; tidak pernah dieksekusi dari pesan masuk.
3. Isolasi tenant di kode: pencarian tautan, approval, dan berkas selalu memfilter `org_id`; chat tak tertaut tidak menerima data apa pun.
4. Audit: setiap persetujuan lewat Telegram mencatat pelaku (`user_id`), kanal (`telegram`), `update_id`, dan waktu di `audit_log`.
5. Uang, tanggal, status ditentukan kode: kartu hanya menampilkan angka yang dibaca dari data, bukan hasil karangan model.
6. Token dan secret hanya di `.env`; repo publik tidak boleh memuatnya; log tidak boleh memuat URL unduh atau token.

## 13. Hal yang belum diverifikasi (uji sebelum bergantung)

- Jumlah percobaan ulang Telegram dan batas waktu respons webhook; urutan antar-update.
- Format audio voice note yang sebenarnya diterima dari klien Telegram (diasumsikan OGG/Opus).
- Teks dan bentuk galat 403 saat pengguna memblokir bot.
- Perilaku `sendMessageDraft` dan tombol Stop pada klien nyata (fitur baru).
- Bidang `Message` lain di luar yang tercantum di §4 (tipe ini hanya dibaca bidang relevannya) dan bagian pembuatan sertifikat pada halaman webhooks.
- Pembuatan bot dan token di @BotFather (`/newbot`, `/revoke`, `/setprivacy`) belum dibaca di dokumentasi; owner menyatakan bot sudah siap, jangan dibuat ulang.
