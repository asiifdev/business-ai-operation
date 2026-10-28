---
name: meta-model-api-integration
description: Integrasi Meta Model API (Muse Spark, Muse Image, Muse Voice Transcribe) di business-ai-operation. Baca sebelum menulis kode lapisan AI (`AiProvider`, Responses API, tool calling, structured output, gambar masuk dan keluar, STT, file, retry, caching, anggaran biaya).
---

# Meta Model API: panduan integrasi

Sumber: teks asli dokumentasi resmi `dev.meta.ai/docs/*` (diunduh sebagai markdown dan dibaca penuh, **2026-10-28**), ditambah uji nyata di `docs/02-meta-model-api.md` §0.

**Dibaca penuh:** authentication, protocols (pemilih), protocols/responses, protocols/chat-completions, tool-calling, structured-output, reasoning, image-understanding, image-generation, speech-to-text, file-handling, prompt-caching, token-counting, error-handling, sdks, models, pricing-rate-limits, search-grounding.
**Tidak dibaca (di luar lingkup produk):** protocols/messages (format Anthropic), tool-search, video-understanding, media-segmentation/SAM, cookbook, halaman Muse Code dan open-weight, dan halaman API reference per-endpoint (skema lengkap). Bila fitur itu dipakai kelak, baca halamannya dulu.

Butir ⚠️ belum terverifikasi: uji sebelum diandalkan. Harga, daftar model, dan batas STT ada di `docs/02`; jangan disalin ke sini.

## 1. Akses, klien, dan model

- Tiga protokol, model, auth, dan harga per token sama: **Responses** `POST /v1/responses` (default yang disarankan; fitur terlengkap), Chat Completions `POST /v1/chat/completions`, Messages `POST /v1/messages` (tidak kita pakai).
- OpenAI SDK: `baseURL: 'https://api.meta.ai/v1'`. Auth `Authorization: Bearer $MODEL_API_KEY`. Kunci berawalan `LLM_<id>_<secret>`, hanya terlihat sekali. **SDK tidak membaca `MODEL_API_KEY` otomatis** (OpenAI SDK mencari `OPENAI_API_KEY`): oper `apiKey` eksplisit.
- Kunci hanya di server, satu kunci per aplikasi, tidak di klien atau commit (repo publik). Rate limit **per team**, bukan per kunci. Rotasi: buat kunci baru, pindahkan aplikasi, hapus yang lama. Lonjakan 401 bisa tanda kunci bocor.
- Model: `muse-spark-1.3` (**default untuk pekerjaan baru**, konteks 1.048.576 token, input teks/gambar/video/audio/PDF, output teks). `muse-wonder-1.0` preview, lebih mahal, tidak kita butuhkan. `muse-spark-1.3-contributor` hanya untuk data demo palsu (§11). `GET /v1/models` mendaftar model yang aktif untuk team.
- ⚠️ Ketersediaan model bergantung negara (Geographic Use Policy): cek untuk wilayah server dan pengguna.
- **Audio sebagai input ke Muse Spark 1.3 "tidak sepenuhnya didukung"**: untuk suara selalu pakai Muse Voice Transcribe (§7).

```ts
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.MODEL_API_KEY, baseURL: 'https://api.meta.ai/v1' });
const res = await client.responses.create({ model: 'muse-spark-1.3', input: '…' });
res.output_text; // helper SDK untuk teks akhir
```

⚠️ Paket `openai` belum ada di `package.json`: `pnpm add openai` sebelum dipakai. Semua pemanggilan model lewat satu `AiProvider` (CLAUDE.md), bukan dari endpoint atau komponen.

## 2. Responses API: konteks, token, dan reasoning

**Dua mode konteks** (pilih satu per percakapan, jangan campur):

1. **Stateless encrypted replay (disarankan dokumentasi)**: `store:false` + `include:["reasoning.encrypted_content"]`; Anda kirim ulang seluruh riwayat tiap giliran, termasuk item `reasoning`. Tidak ada salinan di server Meta. Cocok untuk data tenant.
2. **`previous_response_id`**: server menyimpan (`store:true`, default) dan Anda hanya kirim input baru. Lebih sederhana. **Tidak boleh digabung** dengan `include:["reasoning.encrypted_content"]` (400).

⚠️ Keputusan teknis untuk `AiProvider`: sembunyikan pilihan ini di balik satu antarmuka. Untuk data demo palsu keduanya aman; untuk data nyata prefer mode 1.

Aturan struktur `input` (400 bila dilanggar):
- Setiap `reasoning` yang dikirim ulang harus diikuti pesan assistant atau `function_call` sebelum pesan `user`/`system`/`developer` berikutnya. Giliran yang hanya berisi reasoning: sisipkan pesan assistant minimal.
- Setiap item `reasoning` input wajib punya `summary` (pakai `[]`) dan `encrypted_content`; `id` (`rs_…`) opsional. Mengirim `rs_` tanpa `encrypted_content` → 400. Mengompaksi riwayat: buang atau simpan **utuh** per giliran; item terenkripsi tidak bisa diringkas.
- Teks perantara assistant sebelum `function_call` harus bertanda `phase:"commentary"`; bila `phase` dikembalikan model, simpan dan kirim ulang.
- Tanpa `previous_response_id`: tiap `function_call_output.call_id` harus cocok dengan `function_call.call_id` di permintaan yang sama; `call_id` 1–64 karakter.
- Peran: `developer` (disarankan untuk instruksi perilaku; `system` setara), `user`, `assistant`. Isi pesan bertipe: `input_text`, `input_image`, `input_file`, `input_video`, `output_text` (untuk giliran assistant yang diputar ulang).
- `instructions`, `tools`, dan `reasoning.effort` **tidak ikut** `previous_response_id`: kirim ulang tiap permintaan.

**Token dan batas**
- Reasoning memakan batas keluaran. Responses: `max_output_tokens` (minimum 16). **Chat Completions: `max_completion_tokens`** (`max_tokens` alias lama; `max_output_tokens` ditolak di Chat). Uji nyata: batas 40 → isi `null`, `finish_reason:length`. Beri batas lapang (≥ 1.000; lebih besar untuk effort tinggi).
- `input_tokens + max_output_tokens` harus muat di 1.048.576 token; jangan set keluaran sebesar jendela konteks. Konteks meluap → 400 (bukan dipotong otomatis; `truncation:"auto"` → 400).
- Effort: Responses `reasoning:{effort}`, Chat `reasoning_effort`. Nilai `minimal|low|medium|high|xhigh|max`. **`none` → 400.** `max` hanya `muse-spark-1.3` dan Wonder (bukan `-contributor`). Pakai effort serendah yang cukup: `low` untuk ringkasan, format, terjemahan, ekstraksi.
- Reasoning ditagih seperti token keluaran; baca `output_tokens_details.reasoning_tokens` (Responses) / `completion_tokens_details.reasoning_tokens` (Chat). Raw chain of thought tidak dikembalikan; ringkasan opsional `reasoning.summary` (`auto|concise|detailed`) hanya di Responses dan bisa `[]`.
- **Tidak didukung (400 atau tak berefek):** `logprobs`, `frequency_penalty`, `presence_penalty`, `stop`, `logit_bias`, `n > 1`, `verbosity`, `prediction`, `modalities`, `web_search_options`. `seed` deprecated. Atur `temperature` **atau** `top_p` (default 1.0; `top_p:0` → 400), idealnya tidak keduanya.
- `safety_identifier` (≤ 64 karakter, hash ID pengguna; menggantikan `user`) dan `prompt_cache_key` (§10) dianjurkan.

**Streaming** (`stream:true`): disarankan untuk keluaran panjang (non-streaming bisa 504). Event: `response.created`, `response.output_item.added/done`, `response.output_text.delta`, `response.function_call_arguments.delta/done`, `response.reasoning_summary_text.*` (hanya bila diminta), terminal `response.completed | response.failed | response.incomplete`, akhir `[DONE]`. Jangan membuang item sebelum `status:"completed"`. Respons streaming tetap tersimpan walau klien putus (bila `store:true`). **Background** (`background:true`): tidak bisa digabung dengan `stream`; badan ≤ 1 MiB; 600 pengiriman per menit per team; ambil lewat `GET /v1/responses/{id}` (`?stream=true` hanya mengirim event siklus hidup).

## 3. Tool calling (tingkat `read`, `draft`, `act`)

Definisi tool Responses (datar) dan Chat (bersarang di `function`):

```json
{ "type": "function", "name": "get_overdue_invoices", "description": "…",
  "parameters": { "type": "object", "properties": { "limit": { "type": "integer" } },
                  "required": ["limit"], "additionalProperties": false } }
```

- Hasil panggilan: Responses → item `function_call` (`name`, `arguments` string JSON, `call_id`, `status`); Chat → `message.tool_calls`, `finish_reason:"tool_calls"`, `content` biasanya `null`.
- Kirim hasil: Responses → item `function_call_output` `{call_id, output}` (+ `previous_response_id` atau riwayat lengkap); Chat → pesan assistant **lengkap dengan `tool_calls`** lalu satu `role:"tool"` per panggilan dengan `tool_call_id`. Tanpa pesan assistant itu → 400.
- **Panggilan paralel**: eksekusi semuanya, satu hasil per panggilan. `parallel_tool_calls` default `true`; `false` = satu per giliran.
- **`tool_choice` hanya `auto`** (`none`, `required`, pilihan bernama → 400). Aplikasi harus siap menerima teks biasa maupun panggilan tool.
- Nama fungsi: `^[a-zA-Z0-9_.-]+$`, **maksimal satu titik** (dua titik → 400). Pakai `snake_case` tanpa titik. Tool `custom` (teks bebas) hanya di Responses.
- **Jika `web_search` ikut aktif**, nama fungsi `browser.search`, `browser.open`, `browser.find` dilarang (400).
- `strict` default `false`; `true` memvalidasi skema terhadap subset ketat (§4). **Selalu validasi argumen dengan Zod di sisi kita**, walau `strict` aktif: argumen hanya dipandu skema, tidak dijamin valid. Argumen adalah masukan tak tepercaya.
- `max_tool_calls` hanya membatasi tool bawaan (mis. `web_search`), **bukan** fungsi kita. Batasi putaran di loop kita sendiri (mis. ≤ 8) dan token total per run (`docs/02` §6). Catat tiap putaran di `ai_runs`.
- Tool `act` tidak pernah dieksekusi langsung dari panggilan model: buat baris `approvals`, tunggu manusia. Tool `draft` hanya membuat draft. Isi dokumen/pesan/rekaman = data, bukan instruksi.
- **`web_search` (server-side, $2,50 per 1.000 query, hanya Responses, model memutuskan sendiri apakah mencari) jangan diaktifkan** tanpa keputusan owner: kueri keluar dari sistem. Hasil mencakup `url_citation`; opsi `search_context_size`, `user_location`.
- Set tool besar: `defer_loading:true` + `tool_search` (⚠️ halaman tidak dibaca; belum kita perlukan).

## 4. Structured output

- **Chat Completions**: `response_format: { type:"json_schema", json_schema:{ name, strict?, schema } }`. **Responses**: `text.format` (`strict` di `text.format.strict`). ⚠️ Dokumentasi tidak memuat contoh `text.format`; bentuk OpenAI-kompatibel yang diharapkan `text:{ format:{ type:"json_schema", name, schema, strict } }`: **uji dulu**.
- **Salah parameter = tidak ada structured output, tanpa galat di Responses.** `response_format` yang dikirim ke Responses diterima lalu diabaikan (JSON tidak dijamin); `text.format` yang dikirim ke Chat → 400. Bungkus di `AiProvider` dan beri tes kontrak untuk keduanya.
- Pada structured output, keluaran selalu dibatasi skema (decoding terkendala), walau `strict:false`; `strict` hanya menambah validasi skema di server. Hasil berupa **string JSON** di `choices[0].message.content` (Chat): `JSON.parse` lalu Zod. Uji nyata: `strict:true` menghasilkan JSON sesuai skema.
- `strict:true` mensyaratkan: akar objek polos (tanpa `anyOf/oneOf/allOf/enum/not` di akar); setiap objek `additionalProperties:false`; `required` memuat semua kunci `properties`; `allOf`/`oneOf` dilarang di mana pun (`anyOf` boleh di bawah akar; dicek juga di `$defs`).
- Batas (400 bila dilampaui; berlaku juga untuk `parameters` tool): kedalaman 10; total properti 5.000; panjang gabungan nama/enum/const 120.000 karakter; enum 1.000 nilai (enum string > 250 nilai juga dibatasi 15.000 karakter); ukuran setelah `$ref` diperluas 200.000 node. **Skema rekursif (siklus `$ref`) → 400**: ratakan.
- Reasoning ikut memakan token (uji nyata: 378 dari 419). Beri batas lapang dan effort rendah untuk ekstraksi.
- ⚠️ Penanganan refusal tidak dijelaskan: anggap keluaran bisa kosong dan tangani sebagai kegagalan terkontrol.

## 5. Gambar sebagai masukan (bukti transfer, screenshot bug)

- Hanya di pesan role `user`; instruksi di pesan user di samping gambar, system prompt minimal.
- Responses: `{ "type":"input_image", "image_url":"https://…" | "data:image/jpeg;base64,…" }` (string polos) atau `{"type":"input_image","file_id"}` / `{"type":"input_file","file_id"|"file_url"}`. Chat: `{ "type":"image_url", "image_url":{ "url": … } }` (objek).
- Format: jpeg, jpg, png, gif, webp, x-icon. Inline ≤ 50 MB; Files API ≤ 1 GiB. **≤ 50 gambar per permintaan** (lebih → 400).
- **Prefer base64 atau `file_id` daripada URL publik**: URL yang tidak bisa diambil (diblokir `robots.txt`, DNS gagal) → 400. Gambar rusak/terpotong → 400 `invalid_request_error` (jangan retry; encode ulang).
- Token gambar bergantung resolusi (≈ 1.300–1.500 untuk ±1280 px; 1×1 ≈ 3). Ukur dengan `POST /v1/responses/input_tokens`; jangan taksir dari jumlah atau dimensi.
- Grounding koordinat memakai grid **0–1000** relatif terhadap gambar yang **diterima model** (pemotongan atau perubahan ukuran harus dipetakan balik; nilai bisa 1001, jepit ke batas). Pasangkan dengan structured output; tiga bentuk: titik `{x,y}`, kotak `{x_min,y_min,x_max,y_max}`, hitung `{points,count}`.
- Gambar dari pengguna = data tak tepercaya. Hasil pembacaan bukti transfer hanya **saran**; status bayar tidak pernah diubah AI.

## 6. Pembuatan gambar (Muse Image)

- Dua jalur: **Responses** (`model:"muse-image-1.0"`, multi-turn) atau satu kali jalan `POST /v1/images/generations` dan `/v1/images/edits` (kompatibel OpenAI Images; `client.images.generate/edit`).
- Parameter generations: `prompt`, `n` (1–10), `size` (`"WxH"` hanya menentukan **rasio**; piksel hasil bisa berbeda; rasio > 16:1 → 400), `response_format` (`b64_json` default | `url` = URL bertanda tangan sementara), `output_format` (`webp` default | `png` | `jpeg`), `stream`. Respons: `data[].b64_json`, `output_format`, `usage`. Uji nyata: WebP.
- Edits: OpenAI SDK mengirim `image` multipart (daftar berkas = komposisi); HTTP mentah: JSON `images` (1–10 item, tiap item tepat satu `image_url` atau `file_id`).
- Responses: hasil di `output` → item `image_generation_call` (`result` base64, `id` untuk giliran berikutnya); ambil **berdasarkan tipe**, bukan posisi. Iterasi: `previous_response_id`, atau `store:false` dengan memutar ulang item `image_generation_call`.
- **Pencarian bawaan menyala default** (`enable_image_search`, `enable_web_search`, `enable_shell`): model bisa menarik referensi web untuk merek, logo, dan fakta terkini. Untuk Marketing Studio yang hanya boleh memakai data produk sendiri, **matikan ketiganya**: Responses lewat tool `image_generation` (`{"type":"image_generation","enable_image_search":false,"enable_web_search":false,"enable_shell":false}`); endpoint images lewat field top-level `tool_enablement:{…}` (`extra_body` di OpenAI SDK). `reasoning_strength:"low"` = satu putaran, lebih cepat, harga sama. ⚠️ Uji efek mematikan tool pada kualitas.
- Muse Image **hanya** menerima tool `image_generation` (tool lain → 400). **Jangan kirim:** `moderation` (nilai apa pun → 400), `seed` atau field top-level asing (→ 400), `mask`/`input_fidelity`/`partial_images` pada multipart; jangan kirim `image` dan `image[N]` bersamaan. Kunci bersarang yang tidak dikenal diabaikan diam-diam. Gunakan `safety_identifier` (Responses/Chat) atau `user` (endpoint images).
- Galat: 400 `content_policy_violation` (diblokir keamanan; pesan ramah, tidak retry), 415 bila tanpa `application/json`, **503 `server_error` retryable**, **500 tidak diklasifikasi retryable untuk gambar: jangan retry** (halaman error umum menyebut 500 retryable, tetapi halaman gambar menyatakan sebaliknya; ikuti yang lebih hati-hati). Gambar yang diblokir atau gagal tidak ditagih.
- $0,01 per gambar berhasil; 150 RPM per team. Gambar AI wajib diberi label di UI. ⚠️ Panjang prompt maksimum, parameter `quality`, dan akurasi teks di dalam gambar tidak didokumentasikan: uji sebelum menjanjikan.

## 7. Speech-to-text (Muse Voice Transcribe)

Detail uji ada di `docs/02` §0 dan §3. Dari dokumentasi:

- File: `POST /v1/asr/transcribe` (`?sessionId=…` opsional), `multipart/form-data`: bagian `request` (JSON `{"mode","model":"muse-voice-transcribe-1.0","audioEncoding":"WAV","languageBias"?,"keywords"?}` dengan `type=application/json`) dan bagian `audio`. Header `Authorization` biasa. Realtime WebSocket (`wss://api.meta.ai/v1/asr/realtime`, auth di frame handshake, bukan header) **dipakai untuk rapat langsung (D-051, `src/server/live-meeting.ts`)**: handshake `{authorization:{accessToken:"Bearer <key>"}, audioEncoding:"PCM_24KHZ", model, mode:"DIARIZATION", partialMode:"CUMULATIVE", emitAudioProgress, languageBias}` dalam 10 detik, balasan pertama `{sessionId}` tanpa `type`, lalu audio PCM 16-bit mono sebagai bingkai biner sekitar waktu nyata (jangan lebih dari 5 detik di depan), `{"type":"endStream"}` untuk menutup masukan dan terus membaca sampai server menutup dengan 1000. Event: `speechStart`, `transcript` (partial kumulatif, tanpa `turnId`), `speaker`, `speechEnd`, `speechComplete` (teks akhir), `audioProgress`, `error`. Sesi maksimal 60 menit; 1008 = pacing/konfigurasi, 1011 = coba lagi, 1013 = batas laju. Diuji nyata 2026-10-29: `turnId` pertama bernilai 0.
- **Audio wajib WAV mono 16-bit PCM 16 atau 24 kHz.** Konversi: `ffmpeg -i in -ac 1 -ar 24000 -c:a pcm_s16le -map_metadata -1 out.wav`. Berkas non-WAV → 400.
- Batas: badan ≤ 32 MB (413), audio ≤ 10 menit (400). Potong lalu gabung transkrip. 429 → backoff. 500 saat pemrosesan melampaui anggaran server → **ulang sekali**, bila gagal lagi hubungi dukungan dengan session ID.
- Mode: `PUSH_TO_TALK` (default; satu giliran; `turns` kosong), `ENDPOINTING` (batas giliran oleh model), `DIARIZATION` (label pembicara `A`, `B`, **hanya berlaku dalam satu transkripsi**, bukan identitas). Bahasa Indonesia didukung (25 bahasa + code-switching). `languageBias` = daftar nama bahasa (petunjuk, bukan paksaan); `keywords` hemat saja (uji nyata: menambah derau; ejaan tidak dijamin).
- Respons JSON default: `transcript`, `audioDurationMs`, `turns[]` (`turnId`, `startMs`, `endMs`, `transcript`, `speaker?`). Hanya timestamp per giliran, **tanpa** per kata, confidence, emosi, atau reformatting. `Accept: text/plain` → teks (`A:Halo` per baris pada diarization); `Accept: text/event-stream` → event ala realtime; `Accept` lain → 406. `partialMode` dan `emitAudioProgress` hanya untuk SSE.
- Harga $0,18 per jam, dibulatkan ke bawah per detik; permintaan gagal dan 429 tidak ditagih. Tidak ada header `x-ratelimit-*` pada STT. 256 stream bersamaan dan 16.000 stream per jam per team.
- Tidak ada TTS: jangan menjanjikan balasan suara.

## 8. File dan dokumen

- Files API: `POST /v1/files` (`purpose=user_data`; kirim `purpose` dan `expires_after` **sebelum** bagian `file`, dan `file` terakhir), `GET /v1/files[?purpose=]`, `GET`/`DELETE /v1/files/{id}`. ID berawalan `file-`.
- Tipe: gambar (png, jpeg, gif, webp, x-icon), `video/mp4`, `audio/mpeg`, `audio/wav`, `application/pdf`, teks/JSON/JSONL (JSONL untuk `purpose=batch`). Inline ≤ 50 MB; unggah ≤ 1 GiB.
- Tidak kedaluwarsa kecuali `expires_after` (`anchor:"created_at"`, `seconds` 3.600–2.592.000, keduanya wajib). **Penyimpanan 100 GiB per team**; penuh → 400 pada unggahan. Hapus berkas yang sudah tidak dipakai (kita juga menyimpan sendiri di R2).
- Rujukan: Responses `input_file` dengan `file_id` | `file_url` (hanya `http`/`https`, server mengambil) | `file_data`(+`filename`); `input_image`/`input_video` dengan `file_id`. Chat hanya mendokumentasikan blok `file` inline (`file_data` + `filename`).
- **PDF terpotong**: teks dari 100 halaman pertama, gambar halaman dari 50 pertama (ikut jatah 50 gambar).
- Isolasi tenant: kunci Meta berbagi satu team, jadi `file_id` tidak punya batas tenant. Simpan pemetaan `file_id` → `org_id` di basis data kita, filter di query, dan jangan pernah menerima `file_id` dari klien tanpa memeriksa kepemilikan. Kebocoran kunci memberi akses ke semua berkas yang diunggah.
- Untuk `store:true`, base64 besar bisa membuat respons gagal disimpan (413 `payload_too_large`): unggah lewat Files API atau `store:false`.

## 9. Error, retry, dan batas

Galat: `{ "error": { "message", "type", "param", "code" } }`; `type` ∈ `invalid_request_error | authentication_error | billing_error | rate_limit_error | server_error`; `code` sering `null` pada validasi, jadi cabangkan lewat status dan `type`. Jalur tak dikenal → 404 **tanpa isi**; validasi `GET /v1/files` bisa mengembalikan teks polos.

| Status | Arti | Retry |
|---|---|---|
| 400 | parameter salah, konteks meluap, struktur percakapan salah, media rusak atau tak terambil, `content_policy_violation` | tidak |
| 401 | kunci hilang/salah/dicabut (`invalid_api_key`) | tidak |
| 402 | billing (`billing_not_configured`) | tidak |
| 403 | tanpa akses ke model atau fitur | tidak |
| 404 | model/berkas tak ada (`model_not_found`, `file_not_found`) | tidak (tetapi 503 saat mencari model = coba lagi) |
| 413 | badan terlalu besar (background > 1 MiB; `store:true` terlalu besar) | tidak; perkecil, pakai `file_id`, atau `store:false` |
| 429 | RPM/TPM terlampaui (`rate_limit_exceeded`) | ya |
| 500 | galat server, termasuk keluaran model tak terparse (aman diulang) | ya (kecuali gambar, §6) |
| 503 | `server_shutting_down`, `service_overloaded`, `backend_unavailable` | selalu |
| 504 | non-streaming melewati batas waktu; streaming: event pertama terlambat (prompt panjang tanpa cache) | **jangan ulangi apa adanya**: stream, `background:true`, atau kerja lebih kecil |

- Retry hanya 429/500/503: backoff eksponensial mulai 0,5–1 detik, dua kali lipat, jitter 0–1 detik, 3–5 percobaan, dan **hormati `Retry-After`** (503 `service_overloaded` dan `backend_unavailable` = 60 detik; shutting down = beberapa detik).
- Header sisa kuota pada respons berbasis token: `x-ratelimit-{limit,remaining}-{tokens,requests}`. Perlambat sebelum kena 429.
- Streaming: kegagalan di tengah aliran datang sebagai event `response.failed` atau `error` (mis. `server_shutting_down` → ulangi seluruh permintaan), bukan status HTTP. Tangani juga `response.incomplete`.
- Responses tersimpan bisa sesaat 404 setelah selesai (atau 400 saat dirantai): ulangi dengan backoff pendek.
- Membatalkan respons yang sudah selesai mengembalikan `status:"completed"` dengan `output` kosong: ambil lewat `GET`. `DELETE` bersifat soft-delete dan tidak idempoten (kedua kali → 404).
- Header `x-request-id` (UUID) **ada** pada respons (teramati 2026-10-28, tidak tertulis di dokumentasi); `MetaProvider` mengembalikannya di `meta.requestId`. Sebut ID itu saat menghubungi dukungan.

## 10. Caching dan hitung token

- Prompt caching **otomatis** (prefiks). Susun: system/developer prompt, instruksi, contoh, dan definisi tool yang stabil **di awal**; pesan pengguna dan data variabel **di akhir**. Cap waktu atau data per-pengguna di awal memutus prefiks. Perubahan di tengah prompt memotong kecocokan di titik itu.
- Opsional: `prompt_cache_key` stabil per kasus pakai (bukan per pengguna atau sesi; kunci unik menurunkan hit rate) dan `prompt_cache_retention` `"in_memory"` | `"24h"` (Responses; hanya petunjuk).
- Baca `usage.input_tokens_details.cached_tokens` (Responses) atau `usage.prompt_tokens_details.cached_tokens` (Chat); subset dari input, ditagih lebih murah. Dengan `previous_response_id`, hanya token giliran baru yang dilaporkan. `store:false` **tidak** mematikan caching.
- `POST /v1/responses/input_tokens` menghitung token masukan lengkap (termasuk prompt tersembunyi dan scaffolding tool): untuk memeriksa muat konteks, **bukan estimasi tagihan**; hitungan spesifik per model; validasinya sama dengan `/v1/responses`. Token yang disuntik Meta tidak ditagih dan tidak masuk `usage`. Chat streaming: minta `stream_options:{include_usage:true}`; Responses: baca `usage` di respons akhir.

## 11. Kontrak internal (dari CLAUDE.md)

1. Satu antarmuka `AiProvider`; Meta implementasi utama, provider lain hanya cadangan.
2. Setiap panggilan model dicatat di `ai_runs`: tool, ringkasan input/output, token masuk/keluar/reasoning/cached, biaya, durasi, status, ID respons, header kuota.
3. **Anggaran harian per fitur diperiksa sebelum panggilan**; tolak dengan pesan ramah bila habis.
4. Query tool dan RAG selalu memfilter `org_id` di kode, bukan di prompt.
5. Uang, tanggal, status ditentukan kode; tool AI tidak punya jalan untuk mengubahnya.
6. **Mode `-contributor`** (`muse-spark-1.3-contributor`, `muse-spark-1.2-contributor`) memakai konten kita (prompt, berkas, respons) untuk melatih model Meta: **hanya data demo palsu**, tidak pernah data nyata. Batas lebih rendah (150 RPM, 3M TPM), tanpa `max` reasoning, harga jauh lebih murah. Beralih lewat ID model. Mode Standard tidak dipakai untuk pelatihan. ⚠️ Tidak tersedia di semua negara.
7. Tidak ada embedding, TTS, atau pembuatan video di Meta Model API: jangan dijanjikan di UI atau demo (`docs/02` §4).

## 12. Hal yang belum diverifikasi (uji sebelum bergantung)

- Bentuk persis `text.format` di Responses dan penanganan refusal.
- STT dengan dua pembicara, rekaman berderau/code-switching, dan rekaman > 1 menit (multipart dan WAV 8 detik sudah teruji lewat `MetaProvider`).
- Kualitas gambar dengan pencarian bawaan dimatikan (parameternya sudah teruji diterima, 2026-10-28), serta batas panjang prompt gambar dan akurasi teks di gambar.
- Stateless encrypted replay end-to-end (urutan item reasoning, `phase`, kompaksi) dengan loop tool kita.
- Streaming end-to-end dari Astro SSR ke browser dan ke Telegram (`sendMessageDraft`).
- Jumlah maksimum tool per permintaan dan perilaku model dengan set tool besar.
- Ketersediaan per negara (server dan pengguna), serta SAM (`sam-3.1`) dan video/audio understanding (tidak dibaca).
