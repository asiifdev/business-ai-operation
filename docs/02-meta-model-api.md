# 02 — Meta Model API (ringkasan terverifikasi)

Sumber: `dev.meta.ai/platform/models`, `/docs/overview`, `/docs/pricing-rate-limits`, `/docs/speech-to-text` (dibaca 2026-10-28). Halaman lain (tool calling, structured output, image generation, image understanding, Responses API, reasoning, files, error handling, SDK) sudah dibaca dan dirangkum di skill `meta-model-api-integration` (`.claude/skills/`, ✅ 2026-10-28). Search grounding juga sudah dibaca. Video/audio understanding, tool search, Messages API, SAM, dan halaman API reference per-endpoint belum dibaca.

## 0. Hasil uji nyata (2026-10-28, `muse-spark-1.3`/`muse-image-1.0`, key owner di `.env`)

| Uji | Hasil |
|---|---|
| Chat Completions (`/chat/completions`) | HTTP 200. Berhasil dipanggil dengan API key proyek |
| **Token reasoning memakan `max_tokens`** | Dengan `max_tokens:40` isi jawaban `null` (38 token habis untuk reasoning, `finish_reason:length`). **Selalu beri batas lapang (≥1.000) dan atur `reasoning_effort`** (`low` diterima) |
| Tool calling | ✅ `finish_reason:"tool_calls"`, `tool_calls[0].function.arguments` JSON valid (`{"org":"acme"}`). Model juga menulis teks pembuka sebelum tool |
| Structured output `response_format: json_schema` (`strict:true`) | ✅ JSON sesuai skema (`{"branches":2,"budget_idr":15000000,"client":"Budi","deadline_weeks":6}`); 378 dari 419 token adalah reasoning |
| Prompt | `prompt_tokens` ≈ 548 untuk permintaan kecil (ada konteks steering dari Meta; per dokumentasi tidak ditagih) |
| **STT `POST /v1/asr/transcribe`** (`muse-voice-transcribe-1.0`) | ✅ Rekaman suara Indonesia nyata (22 dtk, satu pembicara). **HTTP 200 dalam ±5 dtk** (≈ 0,2× durasi). Teks benar dan terbaca utuh; `mode:"DIARIZATION"` mengembalikan `turns[]` dengan `speaker:"A"`, `startMs`, `endMs` per giliran. Bahasa terdeteksi otomatis tanpa `languageBias` |
| **Format audio STT** | ⚠️ **m4a/AAC ditolak**: HTTP 400 `The 'audio' part must be a mono 16-bit PCM WAV at 16 or 24 kHz`. Wajib dikonversi: `ffmpeg -i in -ac 1 -ar 24000 -c:a pcm_s16le -map_metadata -1 out.wav` (rekaman 22 dtk = 1 MB WAV). Voice note Telegram (OGG/Opus) dan rekaman ponsel (m4a) sama-sama butuh langkah ini |
| **Biasing kosakata** (`keywords`, `languageBias`) | Memperbaiki nama (`AsiifDev` dieja benar), tetapi **menambah derau**: muncul kata sisipan ("oh"), "agensi" menjadi "agency", dan satu kata terulang. **Pakai hemat**: hanya nama produk/klien, bukan istilah umum; `languageBias` tidak diperlukan untuk Indonesia |
| Muse Image `/images/generations` | ✅ HTTP 200, respons `data[0].b64_json` (WebP, `output_format:"webp"`, `background:"opaque"`), `usage` memuat token. Satu gambar ≈ $0,01 per dokumentasi |

### 0a. Uji nyata lewat `MetaProvider` (2026-10-28, `pnpm ai:smoke --image --stt`)

| Uji | Hasil |
|---|---|
| Chat polos, effort `low` | ✅ jawaban "siap"; `prompt_tokens` hanya 16 (konteks steering tidak dihitung), tetapi **76 sampai 105 token reasoning** untuk prompt sepele: ±$0,002 per panggilan. Anggaran agen USD 2 per hari ≈ 1.000 panggilan sepele |
| Tool calling + hasil tool | ✅ argumen `{"invoiceNumber":"INV-1"}`; setelah hasil tool dikirim, jawaban akhir memuat angka dari tool |
| Structured output `strict:true` lewat `response_format` | ✅ JSON sesuai skema (`budgetIdr` 15000000, `weeks` 6) |
| Header respons | `x-request-id` **ada** (UUID); empat header `x-ratelimit-*` ada |
| Gambar dengan `tool_enablement` semua `false`, `reasoning_strength:"low"`, `size:"1024x1024"` | ✅ diterima API; WebP 374 KB dalam ±9 dtk |
| STT lewat multipart (`audioEncoding:"WAV"`, `mode:"DIARIZATION"`), suara sintetis Indonesia 8 dtk | ✅ HTTP 200 dalam ±3 dtk; 1 giliran; teks benar, tetapi "Orbyte" ditulis "Orbite" (tanpa `keywords`) |

**Belum diuji:** STT dengan **dua pembicara** dan rekaman berderau/code-switching, STT > 1 menit, image/video understanding, Responses API, streaming, `-contributor`, SAM, edit gambar multi-turn, kualitas gambar dengan pencarian dimatikan, akurasi teks dalam gambar.

## 1. Akses

- Base URL `https://api.meta.ai/v1`, auth Bearer `MODEL_API_KEY`.
- Menurut dokumentasi: drop-in kompatibel dengan OpenAI SDK dan Anthropic SDK; protokol Responses API, Chat Completions, Messages. ⚠️ Perilaku nyata (field yang didukung) diuji saat membuat skill.
- Rate limit per **team**, bukan per key: Spark/Wonder 3.000 RPM + 4M TPM; contributor 150 RPM; Muse Image 150 RPM; SAM 3.000 RPM; STT 256 stream bersamaan, 16.000 stream/jam. Retry 429 dengan exponential backoff + jitter dan hormati `Retry-After`.

## 2. Model dan harga (Standard mode)

| Kebutuhan | Model ID | Harga | Catatan |
|---|---|---|---|
| Agen, tool calling, ringkasan, proposal | `muse-spark-1.3` | $1,25 in / $4,25 out per 1M token (cached in $0,15) | Konteks 1M. Tool calling paralel + streaming argumen, reasoning effort |
| Tugas panjang/sub-agent | `muse-wonder-1.0` (preview) | $4 / $20 per 1M | **Model chat, bukan video** |
| Murah, data dilatih Meta | `muse-spark-1.3-contributor` | $0,10 / $0,20 per 1M | **Hanya data demo palsu.** Dokumentasi: tidak tersedia di semua negara ("select countries") ⚠️ |
| Gambar | `muse-image-1.0` | $0,01/gambar | `/v1/images/generations`, `/v1/images/edits`; multi-turn lewat Responses API |
| Speech-to-text | `muse-voice-transcribe-1.0` | $0,18/jam | `POST /v1/asr/transcribe` (file), `wss://api.meta.ai/v1/asr/realtime` |
| Segmentasi gambar/video | `sam-3.1` | $2,50/1.000 gambar; $0,20/1.000 frame | Kotak + mask, bukan OCR |
| Web search grounding | tool `web_search` pada Spark/Wonder | $2,50/1.000 query | |
| Open-weight | Muse Spark Open (816B MoE), Muse Glimmer (30B, Apache 2.0) | self-host / partner | Opsional, untuk bonus open-weight |

## 3. Batas Muse Voice Transcribe (relevan untuk modul rapat)

- Bahasa Indonesia **didukung** (25 bahasa + code-switching), diarization (pembicara A/B), biasing kosakata, deteksi giliran bicara.
- **File maks 10 menit** (HTTP 400 jika lebih) dan **32 MB** (HTTP 413). Rekaman lebih panjang harus dipotong dan transkripnya digabung di aplikasi.
- **Format masukan: WAV mono 16-bit PCM 16 atau 24 kHz saja** (lihat §0). Parameter permintaan: `mode` (`PUSH_TO_TALK`/`ENDPOINTING`/`DIARIZATION`), `languageBias`, `keywords`, `audioEncoding`; hasil `application/json` (`transcript`, `turns[]`) atau `text/plain` lewat header `Accept`. Dikirim `multipart/form-data` dengan bagian `request` (JSON) dan `audio`.
- Timestamp per giliran, **bukan per kata**. Tanpa confidence score, emosi, atau reformatting.
- Hanya STT: tidak ada sintesis suara.

## 4. Yang TIDAK ada (jangan dijanjikan)

- **Video generation**, **TTS**, **embedding** tidak tercantum di Model API.
- Konsekuensi: RAG vektor tidak jadi fitur inti. Pengambilan paket harga untuk proposal dilakukan lewat tool query terstruktur (SQL), bukan vektor. Jika embedding dibutuhkan kelak: ⚠️ PERLU KEPUTUSAN OWNER (provider non-Meta atau model open-weight self-host).

## 5. Pemetaan ke fitur

| Fitur | Model | Tingkat tool |
|---|---|---|
| Action Center, briefing, follow-up | Spark | read + draft + act (approval) |
| Meeting → notulen, lead, proposal, task | Voice Transcribe + Spark | draft |
| Marketing Studio | Image (+ Spark untuk prompt dan caption) | draft |
| Baca screenshot bug / bukti transfer | Spark multimodal ("image understanding") ⚠️ diverifikasi di skill | draft (saran, bukan status bayar) |
| Bot Telegram | Spark + Voice Transcribe (voice note) | sama dengan web |

## 6. Anggaran biaya

Anggaran harian per fitur disimpan di konfigurasi org dan diperiksa **sebelum** panggilan model. Estimasi kasar (indikatif): 1 siklus Action Center ≈ ribuan token (sen), rapat 10 menit ≈ $0,03 STT, satu gambar $0,01. Total demo wajar jauh di bawah $150; risiko biaya ada pada loop agen yang tidak dibatasi, jadi **batas putaran tool dan token per run wajib**.

**Uji 2026-10-31 (D-083):** PDF terbaca lewat Chat Completions (blok `file`); `video_url` di Chat diterima tetapi diabaikan diam-diam, video hanya terbaca lewat Responses `input_video`; `input_file` PDF di Responses terbaca.
