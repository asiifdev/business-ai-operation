# 09 — Breakdown Fitur dan Keterkaitan Modul

Dasar: percakapan konsep (8 modul) + permintaan owner (function tooling, STT, vision, marketing content, PDF invoice, Telegram interaktif) + batas Meta Model API (`docs/02`). **Daftar periksa dependensi wajib saat menulis BRD modul apa pun.** Detail yang belum pasti ditandai ⚠️: jangan diisi dengan asumsi.

## 1. Modul

| ID | Modul | Jalur | MVP hackathon? | Bergantung pada |
|---|---|---|---|---|
| M01 | Org, Auth, RBAC, tenancy | A | ✅ dasar | — |
| M02 | Portfolio: produk, klien, deployment | A | ✅ minimal | M01 |
| M03 | Billing: subscription, invoice, payment record, **PDF**, scheduler overdue | A | ✅ inti | M01, M02 |
| M04 | Pipeline: lead, stage, konversi ke klien, checklist onboarding | A | ✅ | M01, M02 |
| M05 | Tasks & Maintenance (task/bug/feature/maintenance) | A | ✅ minimal | M01, M02 |
| M06 | Dokumen: proposal/quotation/notulen (draft → final), template | A (engine) + B (narasi AI) | ✅ proposal + invoice | M02, M03, M04 |
| M07 | AI Core: `AiProvider`, registri tool 3 tingkat, `ai_runs`, anggaran | B | ✅ | M01 |
| M08 | Action Center + Approvals | B | ✅ inti demo | M03, M05, M07, M15 |
| M09 | Meeting Intelligence (STT → notulen → lead/proposal/task) | B | ✅ inti demo | M04, M05, M06, M07 |
| M10 | Marketing Studio (gambar, brand kit) | B | ✅ minimal | M02, M07 |
| M11 | Telegram Assistant (interaktif) | B | ✅ target (lihat risiko) | M07, M08, M09 |
| M12 | Dashboard & BI (MRR, outstanding, pipeline value) | A | ✅ ringkas | M03, M04, M05 |
| M13 | Knowledge base / RAG | — | ❌ ditunda (tanpa embedding di Meta) | — |
| M14 | Design system & UI kit | B | ✅ lebih dulu | — |
| M15 | Audit log & guardrail data (`audit_logs`, `automation_runs`, `approvals`) | A | ✅ | M01 |

## 2. Peta aliran lintas modul (yang wajib benar-benar terhubung)

- Scheduler (M03) → event overdue → Action Center (M08) → AI draft follow-up + invoice PDF (M03/M06) → approval (web/Telegram M11) → pencatatan (M15).
- Upload rekaman (M09) → STT → notulen (M06) → lead (M04) + task (M05) + draft proposal (M06, harga dari paket produk M02).
- Lead menang (M04) → klien + subscription + checklist onboarding (M02/M03/M05).
- Marketing Studio (M10) memakai data produk (M02) dan brand kit; hasil disimpan sebagai media asset.
- Dashboard (M12) membaca data service M03/M04/M05, bukan menghitung ulang di UI.

## 3. Fitur AI per modul

| Fitur | Model | Tier tool | Modul |
|---|---|---|---|
| Penjelasan overdue + rekomendasi follow-up | Spark | read, draft, act | M08 |
| Daily briefing berbasis data | Spark | read | M08/M12 |
| Pengelompokan issue serupa | Spark | read, draft | M05 |
| Proposal dari lead + paket harga resmi | Spark | read, draft | M06 |
| Notulen dan action item dari rekaman | Voice Transcribe + Spark | draft | M09 |
| Baca screenshot bug → draft tiket | Spark (multimodal ⚠️) | draft | M05 |
| Gambar promo dan caption | Image + Spark | draft | M10 |
| Tanya status bisnis lewat Telegram | Spark | read | M11 |

## 4. Risiko cakupan

- Delapan modul dalam ±7 hari untuk satu orang + dua jalur kerja **tidak realistis jika semua dalam**. BRD wajib memilah: ✅ penuh, ◐ minimal (demo-able), ❌ ditunda. Pemilahan akhir = keputusan owner (D-014).
- M11 Telegram menambah dependensi eksternal (webhook publik). Jika menekan jadwal, M11 turun jadi ◐ (notifikasi + tombol approval saja).
- Sebagian kemampuan model belum diuji (STT audio, vision, SAM, streaming); uji sebelum PRD dikunci.
