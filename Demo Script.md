# Demo Script — Orbyte (3 menit), versi 3

Track Startup, tema *Build for Your World*. Narasi bahasa **Inggris**, kalimat pendek, ±330 kata. Catatan produksi bahasa Indonesia. Ini kerangka: ganti kata-katanya dengan gaya bicara Anda.

**Posisi produk:** Orbyte adalah AI Operations Manager untuk agensi software. Anda memberi tugas (ketik, suara, berkas, rekaman rapat) dan ia mengerjakan pekerjaan back-office-nya. Ia juga bekerja sendiri saat ada kejadian. Aksi berisiko menunggu persetujuan manusia. Sumber: `docs/00-visi-produk.md` §1 dan §4.

**Perusahaan demo:** ASIIFDEV DIGITAL AGENCY (produk invly.id, paket Basic/Pro/Enterprise). Klien lain di demo adalah data fiktif dari `scripts/seed-asiifdev.ts`.

## Aturan editing (panduan Devpost)

- Narasi **tidak dipercepat**. Yang dipercepat 4–8× hanya waktu tunggu dan pengetikan, dengan label kecil "sped up" dan indikator progres AI tetap terlihat.
- Hasil yang perlu dibaca (angka invoice, kutipan di tugas, kartu persetujuan, poster jadi) ditahan 2–3 detik pada kecepatan normal.
- Kalau total melebihi 3:00, buang adegan 5 (penolakan) dulu, lalu pendekkan adegan 6.

## Naskah dan anggaran waktu

| # | Waktu | Layar | Narasi (EN) | Model / bukti |
|---|---|---|---|---|
| 1 | 0:00–0:10 | Landing page lalu **Register** | "I run Asiifdev Digital Agency, a small software team. Billing, follow-ups, proposals, tickets: it all lived in my head. Orbyte is an AI operations manager. It does the work, and I approve what matters." | — |
| 2 | 0:10–0:35 | Isi form daftar (dipotong) → **Onboarding**: masukkan situs `asiifdev.com`, profil terisi otomatis → lanjut (sped up) | "I sign up, and Orbyte reads my website with Muse Spark to fill in my company profile: services, audience, contact. No forms to type." | Isi otomatis profil dari web (`D-095`, tool `read_website`) |
| 3 | 0:35–1:15 | **Asisten**. Satu perintah: "Add the product invly.id with Basic, Pro and Enterprise packages, add Arunika Trans Rental as a client, and draft a proposal for the Pro package." Tampilkan langkah nyata (sped up), kartu hasil, klik **Approve** pada aksi berisiko. | "Now I just tell it what I need. Spark calls typed tools to create the product, the client and a draft proposal. Prices come from my official packages and totals are computed by code, not by the model. Anything that touches money or locked documents waits for my approval." | `create_product`, `create_package`, `create_client` (`act`); `draft_proposal` (`draft`); `finalize_document` (`act`) |
| 4 | 1:15–1:35 | Pindah ke org yang sudah berisi data → **Action Center**, kartu invoice lewat jatuh tempo → buka → Approve | "It also works without being asked. The scheduler flagged this overdue invoice. Amount and due date come from the ledger. The model only explains it and drafts the reminder." | Rule `invoice_overdue` via `automation.once`; `get_finding_facts`; `mark_invoice_sent` (`act`) |
| 5 | 1:35–1:43 | Asisten: "Write me a poem about the moon" → penolakan baku | "Ask anything outside my business and it refuses. It is not a general chatbot." | `OUT_OF_SCOPE_REFUSAL`, `grounding: 'advisory'` |
| 6 | 1:43–2:03 | **Marketing Studio**: logo + screenshot invly.id sebagai gambar acuan → klik buat (sped up ±50 dtk → ±5 dtk) → poster jadi (tahan 3 dtk) | "Marketing is operations too. Muse Image edits from my real logo and a real screenshot. Code places the text, so the poster cannot invent a price. Every image is labeled as AI-made." | Muse Image `/images/edits`; teks digambar kode; penanda dibuat AI |
| 7 | 2:03–2:33 | Slide arsitektur ≤10 dtk → **AI usage** (`/app/ai`) → **Audit log** (`/app/audit`) | "Under the hood: Astro and React, PostgreSQL. Web, Telegram and AI tools all call one service layer, so numbers never differ. Every query is filtered by organization in code, not in the prompt. Each Meta call is logged with tokens and cost, under a daily budget. The audit trail is append-only, enforced by the database. Documents and recordings are data, never instructions." | `ai_runs`, `ai_budgets`, penjaga DB audit, `src/ai/untrusted.ts` |
| 8 | 2:33–2:50 | Layar penutup: ringkasan 3 model + URL + repo | "Built from scratch during this hackathon on Muse models. Orbyte: ai-business.asiifdev.com. The repo is public." | — |

Margin ±10 detik.

## Slide arsitektur (satu gambar, ≤10 detik)

```
Triggers: scheduler/event · web · Telegram · upload (audio, video, image, PDF)
        │
   Agent loop ──► AiProvider (Meta: Muse Spark/Wonder · Muse Image · Muse Voice Transcribe)
        │                     └─► ai_runs: model, tokens, cost  (daily budget)
        ▼
   Tool registry:  read (free) · draft (creates drafts) · act (approval)
        │
        ▼
   Domain services ──► PostgreSQL (every query filtered by org_id)
   (one source of truth for web, tools, Telegram)   └─► audit log (append-only)
```

## Dua klip rekaman

- **Klip A (akun baru, kosong):** adegan 1–3. Daftar org baru lewat UI. Data produk/klien/proposal dibuat lewat asisten di depan kamera.
- **Klip B (org ASIIFDEV yang sudah di-seed):** adegan 4–7. Perlu temuan Action Center, poster, dan log AI usage.
- Sambungkan di editor MotionShine dengan potongan langsung. Jangan klaim keduanya satu akun.

## Klaim model yang sesuai kode

| Klaim | Bukti |
|---|---|
| Spark: chat, tool calling, structured output, video sebagai input | `src/ai/meta/provider.ts` (`input_video`), `src/ai/agent.ts` |
| Muse Image edit dengan gambar acuan | `provider.ts` `/images/edits`, `src/domain/marketing/free.ts` |
| Muse Voice Transcribe | `muse-voice-transcribe-1.0`, job `meeting.process` (tidak ditampilkan di versi 3; tambahkan 1 kalimat di adegan 7 bila perlu) |
| Muse Wonder | `.env` lokal `AI_CHAT_MODEL=muse-wonder-1.0` dan 23 run di `ai_runs` memakainya; **cek `/app/ai` di server live** dan ucapkan model sesuai log |
| SAM 3.1 | **Tidak dipakai, jangan diklaim** |
| Suara video Marketing Studio | VoxCPM2/Piper, bukan Meta |

## Persiapan sebelum merekam

1. Jalankan `scripts/seed-asiifdev.ts` (dulu tentukan DB: lokal atau live; skrip menolak di `NODE_ENV=production`). Perintah: `pnpm exec node --env-file=.env --import tsx scripts/seed-asiifdev.ts`.
2. ⚠️ **Onboarding multilangkah dan isi otomatis dari web belum diuji di browser** (`docs/PLAN.md`, M01). Uji sekali dulu. Bila gagal, ganti adegan 2 dengan isian manual singkat.
3. Persiapkan poster Marketing Studio di klip B (kuota 20 gambar/hari; latih lalu simpan kuota untuk take final).
4. Cek `/app/marketing` sekali (sempat macet ±30 detik).
5. Telegram belum diuji dengan akun sungguhan: jangan ditampilkan.
6. Jangan tampilkan `.env`, kunci, atau data klien nyata. Klien lama di DB yang tampak seperti bisnis nyata (toko kebaya, rental kamera) jangan muncul di layar; hindari halaman daftar klien tanpa filter.
7. Unggah ke YouTube **Unlisted**, "Not made for kids", paling lambat 4 Nov siang WIB (batas 5 Nov 09:00 WIB).

## Bukti kepatuhan aturan hackathon

| Aturan | Bukti di video / submit |
|---|---|
| Wajib model Meta | Disebut di adegan 2, 3, 6; log AI usage menampilkan model |
| Dibuat selama event | `git log` repo (commit pertama 28 Okt) |
| Repo public, tanpa data nyata | Semua data demo fiktif; tanpa `.env` |
| Bukan Basic RAG / chatbot sederhana | Adegan 3–4: agen bertool + persetujuan; adegan 5: penolakan |
| Hanya peserta approved | Satu pembuat (owner) di halaman submit |
| Tahan produksi | Biaya per run, anggaran harian, audit tak bisa diubah, isolasi org di kode. **Jangan ucapkan "production-ready" bila live masih dev server** (`docs/PLAN.md`) |
