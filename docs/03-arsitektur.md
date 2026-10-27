# 03 — Arsitektur

Status: draf konsep. Keputusan yang sudah final ada di `docs/DECISIONS.md`; sisanya ditandai ⚠️. Versi paket diambil dari `package.json`, bukan dari dokumen ini.

## 1. Stack

| Lapisan | Pilihan | Status |
|---|---|---|
| Framework | **Astro 7** (SSR, adapter `@astrojs/node` standalone) | ✅ D-001 |
| UI interaktif | **React 19 islands** (`@astrojs/react`) | ✅ |
| Styling | **Tailwind CSS v4** via plugin Vite | ⚠️ belum dipasang; konfirmasi lewat skill `tailwind-4-docs` |
| Bahasa | TypeScript strict | ✅ |
| Database | PostgreSQL 17 (FlyEnv lokal), ekstensi `pgcrypto`; `vector` tersedia tapi belum dipakai | ✅ |
| ORM/migrasi | Drizzle ORM + drizzle-kit + postgres-js | ✅ D-005 |
| Validasi | Zod | ✅ |
| Job/scheduler | ⚠️ PERLU KEPUTUSAN (job berbasis Postgres vs cron proses terpisah) | D-008 |
| PDF | HTML → PDF (Playwright/Chromium) | ⚠️ diverifikasi saat M03 |
| Auth | ⚠️ PERLU KEPUTUSAN (kandidat: Better Auth, cek dukungan Astro lewat Context7/Astro Docs MCP) | D-009 |
| AI | Meta Model API lewat `AiProvider` (`docs/02`) | ✅ |
| Bot | Telegram Bot API, webhook di endpoint Astro, library ⚠️ (kandidat grammY, verifikasi) | D-010 |
| Storage berkas | ⚠️ lokal untuk dev, S3-compatible untuk live | D-007 |
| Test | Unit: Vitest ⚠️; E2E: Playwright + uji manual di browser | ⚠️ |
| Runtime | **Node >= 22.23.4** (persyaratan Astro 7). Mesin dev: Node 24.11.1 rentan, pakai 22.23.4 | ✅ |
| Paket | pnpm | ✅ |

## 2. Struktur folder (target)

```
src/
  pages/              # halaman Astro + endpoint (src/pages/api/**)
  layouts/
  components/
    ui/               # tombol, kartu, badge, modal, toast, tabel (design system)
    forms/            # FormField, TextInput, SelectMenu, ... (docs/05)
    <modul>/          # komponen khusus modul
  domain/<modul>/     # service.ts, repo.ts, schemas.ts (Zod), events.ts
  ai/
    provider.ts       # interface AiProvider + implementasi Meta
    tools/            # registri tool + tiap tool (read/draft/act)
    agents/           # action-center, meeting, marketing
    budget.ts         # anggaran harian per fitur
  integrations/       # telegram/, meta/ (klien tipis, tanpa logika bisnis)
  jobs/               # scheduler, handler event
  db/                 # client, skema final, migrasi
  lib/                # format (Rupiah, tanggal), id, error
drizzle/              # migrasi
docs/                 # dokumen (CLAUDE.md di root)
e2e/                  # tes Playwright
```

Struktur ini **target**, bukan izin membuat folder dasar baru tanpa PR. Perubahan struktur dicatat di `docs/DECISIONS.md`.

## 3. Lapisan dan aturan dependensi

```
UI (pages, components) ─► Endpoint/Action ─► Service (domain/*) ─► Repo ─► DB
                                              ▲        │
                                  AI tools ───┘        └─► events/jobs
```

- UI tidak memanggil repo atau DB langsung.
- **Service adalah satu-satunya tempat logika bisnis.** Endpoint web, **tool AI**, **handler Telegram**, dan job semua memanggil service yang sama (satu sumber kebenaran; tiga jalur tidak boleh menghasilkan angka berbeda).
- Repo selalu menerima `orgId` dan memfilternya. Tidak ada query tanpa `org_id` untuk tabel bisnis.
- `domain/a` tidak mengimpor `domain/b` langsung; komunikasi lewat service publik atau event.

## 4. Multi-tenant (SaaS-ready)

- Batas tenant = `organizations`. Semua tabel bisnis memuat `org_id` (FK) dengan indeks.
- `orgId` diambil dari sesi di server, tidak pernah dari input klien/tool.
- ⚠️ PERLU KEPUTUSAN: perlu Row Level Security Postgres sebagai sabuk kedua, atau cukup filter di repo untuk hackathon (D-011).
- Billing SaaS milik platform sendiri dan onboarding self-serve di luar scope hackathon.

## 5. Lapisan AI

```
Trigger (scheduler/event | web | Telegram | upload)
   └► Agent (action-center / meeting / marketing)
        ├► AiProvider (Meta)  ── ai_runs: model, token, biaya
        └► Tool registry ── tiap tool: skema Zod, tier (read|draft|act), izin, service yang dipanggil
              ├ read  : langsung jalan, hasilnya dicatat
              ├ draft : membuat draft, status 'draft'
              └ act   : membuat baris `approvals` (pending) → manusia menyetujui (web/Telegram) → baru dieksekusi
```

Aturan:
- Batas putaran tool per run (usulan 4–6) dan batas token. Argumen tool yang rusak dinormalisasi atau dianggap gagal dengan pesan jujur, bukan ditebak.
- Anggaran harian per fitur diperiksa sebelum panggilan.
- Semua panggilan tercatat di `ai_runs`; aksi tercatat di `audit_logs`.
- Konten tak tepercaya (dokumen, email, chat, transkrip) dimasukkan sebagai data terlabel, bukan instruksi sistem. `act` tidak boleh dipicu langsung dari teks tak tepercaya.
- Fitur tanpa embedding: pengambilan konteks lewat query terstruktur lewat tool `read`.

## 6. Event dan scheduler

- Scheduler memeriksa kondisi deterministik (jatuh tempo, grace, overdue, deadline tugas) lalu menerbitkan event. **AI hanya dipanggil setelah event ada.**
- Idempotensi: `automation_runs` dengan kunci dedupe (org, rule, key) unik.
- Setiap rule: log, retry berbatas, dan tidak menghasilkan efek ganda.

## 7. Telegram sebagai antarmuka interaktif

Bukan sekadar chat. Kemampuan target (⚠️ dikunci di PRD, diverifikasi dari dokumentasi resmi lewat skill `telegram-bot-integration`):

- Perintah dan bahasa alami → tool yang sama dengan web (tier berlaku sama).
- **Inline keyboard** untuk approval: Setujui / Tolak / Lihat detail pada kartu Action Center.
- Voice note → Muse Voice Transcribe → notulen/task.
- Foto/screenshot → pembacaan multimodal → draft tiket.
- Notifikasi proaktif dari scheduler (overdue, deadline) dengan tombol aksi.
- Tautan akun: chat Telegram dipetakan ke satu user dalam satu org lewat kode pairing sekali pakai; pesan dari chat tak terpetakan ditolak. Webhook diverifikasi lewat secret token.
- Pengembangan lokal butuh URL publik (tunnel) untuk webhook ⚠️.


## 8. Deploy

⚠️ PERLU KEPUTUSAN OWNER (D-007): juri menilai produk live, jadi butuh URL publik stabil + Postgres + penyimpanan berkas + domain untuk webhook Telegram. Opsi dievaluasi di PLAN setelah ERD.

## 9. Keamanan

- Secret hanya di `.env` (tidak di-commit; `.env.example` dilacak). Tidak ada kunci di repo public.
- Tidak ada data klien asli di seed; seed menolak berjalan jika `NODE_ENV=production`.
- Unggahan: batasi tipe dan ukuran; nama berkas di storage diacak.
- Rate limit pada endpoint AI dan webhook.
- Log tidak memuat isi dokumen sensitif atau token.
