# business-ai-operation

Sistem operasi bisnis berbasis AI untuk agensi dan startup software: portofolio produk/klien, subscription dan invoice, pipeline lead, tiket maintenance, dan **AI Action Center** dengan approval manusia. Dibuat untuk Meta Global AI Developer Hackathon (track Startup).

**Status: fase dokumentasi.** Belum ada fitur bisnis; pustaka komponen form (M14) sudah ada, lihat galeri di `/dev/komponen` saat `pnpm dev`. Baca `CLAUDE.md` dulu.

## Dokumen

| Dokumen | Isi |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Panduan kerja wajib (alur dokumen, kerja dua jalur, DoD, aturan teknis, skill) |
| [`docs/PLAN.md`](docs/PLAN.md) | Status tahap, jadwal, pemilik modul, pertanyaan terbuka |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Log keputusan |
| [`docs/00-visi-produk.md`](docs/00-visi-produk.md) | Visi, masalah, prinsip AI, cerita demo |
| [`docs/01-aturan-hackathon.md`](docs/01-aturan-hackathon.md) | Aturan, jadwal, penilaian hackathon |
| [`docs/02-meta-model-api.md`](docs/02-meta-model-api.md) | Model Meta, harga, limit, yang tidak ada |
| [`docs/03-arsitektur.md`](docs/03-arsitektur.md) | Stack, struktur, lapisan, AI, Telegram, keamanan |
| [`docs/04-workflow-pengembangan.md`](docs/04-workflow-pengembangan.md) | Kerja dua jalur (dua jalur paralel), git, testing |
| [`docs/05-uiux-dan-komponen.md`](docs/05-uiux-dan-komponen.md) | Design system dan kontrak komponen form |
| [`docs/09-breakdown-fitur.md`](docs/09-breakdown-fitur.md) | Modul dan keterkaitannya |
| [`docs/BRD.md`](docs/BRD.md) | BRD induk: tujuan, aktor, aturan lintas modul (CR), glosarium, template |
| [`docs/brd/README.md`](docs/brd/README.md) | Indeks 14 BRD modul (satu file per modul), 📝 draf menunggu review |
| [`docs/PRD.md`](docs/PRD.md) | 📝 draf v0.1.0, menunggu review |
| `docs/ERD.md` | ⬜ setelah PRD disetujui |

## Menjalankan (scaffold saja)

Prasyarat: Node >= 22.23.4, pnpm, PostgreSQL lokal.

```bash
cp .env.example .env     # isi DATABASE_URL dan MODEL_API_KEY (jangan di-commit)
pnpm install
pnpm build
```

Belum ada skema database: skema dan migrasi baru dibuat setelah ERD disetujui (`docs/DECISIONS.md` D-006).

## Kontribusi dan asal-usul

- **Pembuat:** satu peserta hackathon yang approved (pemilik repo).
- **Dibuat dari nol selama periode hackathon** (mulai 28 Okt 2026). Tidak ada kode yang disalin dari proyek lain; pola desain umum (kontrak komponen form, pola agen) ditulis ulang.
- **Tooling pihak ketiga** di `.claude/skills/` (`hallmark`, `tailwind-4-docs`) adalah skill panduan pengembangan, bukan bagian produk, lengkap dengan lisensinya masing-masing.
- Semua data demo adalah seed palsu; tidak ada data klien, kunci API, atau kredensial di repo.
