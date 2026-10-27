# 02 — Meta Model API (ringkasan terverifikasi)

Sumber: `dev.meta.ai/platform/models`, `/docs/overview`, `/docs/pricing-rate-limits`, `/docs/speech-to-text` (dibaca 2026-10-28). Halaman lain (tool calling, structured output, image generation, image/video understanding, Responses API, SDK, kompatibilitas) **belum dibaca penuh**: wajib dipelajari lewat skill `meta-model-api-integration` (⬜, lihat `CLAUDE.md`) sebelum coding lapisan AI.

## 0. Hasil uji nyata (2026-10-28, `muse-spark-1.3`/`muse-image-1.0`, key owner di `.env`)

| Uji | Hasil |
|---|---|
| Chat Completions (`/chat/completions`) | HTTP 200. Berhasil dipanggil dengan API key proyek |
| **Token reasoning memakan `max_tokens`** | Dengan `max_tokens:40` isi jawaban `null` (38 token habis untuk reasoning, `finish_reason:length`). **Selalu beri batas lapang (≥1.000) dan atur `reasoning_effort`** (`low` diterima) |
| Tool calling | ✅ `finish_reason:"tool_calls"`, `tool_calls[0].function.arguments` JSON valid (`{"org":"acme"}`). Model juga menulis teks pembuka sebelum tool |
| Structured output `response_format: json_schema` (`strict:true`) | ✅ JSON sesuai skema (`{"branches":2,"budget_idr":15000000,"client":"Budi","deadline_weeks":6}`); 378 dari 419 token adalah reasoning |
| Prompt | `prompt_tokens` ≈ 548 untuk permintaan kecil (ada konteks steering dari Meta; per dokumentasi tidak ditagih) |
| Muse Image `/images/generations` | ✅ HTTP 200, respons `data[0].b64_json` (WebP, `output_format:"webp"`, `background:"opaque"`), `usage` memuat token. Satu gambar ≈ $0,01 per dokumentasi |

**Belum diuji:** STT (butuh audio), image/video understanding, Responses API, streaming, `-contributor`, SAM, edit gambar multi-turn, akurasi teks dalam gambar, akurasi bahasa Indonesia STT.

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
