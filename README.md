# business-ai-operation

Sistem operasi bisnis berbasis AI untuk agensi dan startup software: portofolio produk/klien, subscription dan invoice, pipeline lead, tiket maintenance, dan **AI Action Center** dengan approval manusia. Dibuat untuk Meta Global AI Developer Hackathon (track Startup).

**Status dan jadwal terkini: [`docs/PLAN.md`](docs/PLAN.md)** (satu-satunya sumber status; README tidak menyalinnya). Baca [`CLAUDE.md`](CLAUDE.md) dulu sebelum bekerja.

## Dokumen

| Dokumen | Isi |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Panduan kerja wajib (alur dokumen, kerja dua jalur, DoD, aturan teknis, skill) |
| [`docs/PLAN.md`](docs/PLAN.md) | Status tahap dan implementasi, jadwal, pemilik modul, pertanyaan terbuka |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Log keputusan |
| [`docs/00-visi-produk.md`](docs/00-visi-produk.md) | Visi, masalah, prinsip AI, cerita demo |
| [`docs/01-aturan-hackathon.md`](docs/01-aturan-hackathon.md) | Aturan, jadwal, penilaian hackathon |
| [`docs/02-meta-model-api.md`](docs/02-meta-model-api.md) | Model Meta, harga, limit, hasil uji nyata |
| [`docs/03-arsitektur.md`](docs/03-arsitektur.md) | Stack, struktur, lapisan, AI, Telegram, keamanan |
| [`docs/04-workflow-pengembangan.md`](docs/04-workflow-pengembangan.md) | Kerja dua jalur, git, testing |
| [`docs/05-uiux-dan-komponen.md`](docs/05-uiux-dan-komponen.md) | Design system dan kontrak komponen form |
| [`docs/09-breakdown-fitur.md`](docs/09-breakdown-fitur.md) | Modul dan keterkaitannya |
| [`docs/BRD.md`](docs/BRD.md) | BRD induk: tujuan, aktor, aturan lintas modul (CR), glosarium, template |
| [`docs/brd/README.md`](docs/brd/README.md) | Indeks BRD per modul (satu file per modul) |
| [`docs/PRD.md`](docs/PRD.md) | Kebutuhan produk: halaman, layanan, kontrak AI dan Telegram, pengujian |
| [`docs/ERD.md`](docs/ERD.md) | Skema data, batasan, penjaga di database, rencana migrasi |

## Menjalankan

Prasyarat: Node >= 22.23.4, pnpm, PostgreSQL, `ffmpeg`.

```bash
cp .env.example .env     # isi nilai; jangan pernah di-commit
pnpm install
pnpm db:migrate          # buat tabel di database lokal
pnpm db:seed             # data demo palsu: Orbit Studio dan Kopi Senja Digital
pnpm dev                 # galeri komponen: /dev/komponen
pnpm test                # unit, komponen, dan pemeriksaan sinkronisasi dokumen
pnpm typecheck
pnpm build
```

Skema database dan migrasi hanya berasal dari `docs/ERD.md` (lihat `CLAUDE.md`).

Masuk dengan data demo (palsu) setelah `pnpm db:seed`: `owner@orbit-studio.test`, `admin@orbit-studio.test`, atau `staf@orbit-studio.test`, kata sandi `demo-password-123`. Uji asisten dengan `pnpm ai:smoke` (butuh `MODEL_API_KEY`).

## Deploy ke server

Server publik **harus menjalankan build produksi**, bukan `pnpm dev` (mode dev membuka galeri dan alat pengembangan, lebih lambat, dan menolak host selain localhost).

```bash
pnpm install --frozen-lockfile
pnpm db:migrate          # tinjau migrasi baru di drizzle/ sebelum menerapkan
pnpm build
pnpm start               # mendengarkan di HOST:PORT dari .env
```

Variabel wajib di server (nilainya jangan di repo): `DATABASE_URL`, `BETTER_AUTH_SECRET` (acak, ≥ 32 karakter, **berbeda** dari lokal), `BETTER_AUTH_URL` dan `APP_URL` (alamat publik berskema `https://`), `HOST`, `PORT`. Penjadwal tagihan berjalan di proses yang sama (setiap 60 detik, sekali sehari per organisasi pada jam penjadwalnya); atur `SCHEDULER=off` pada proses yang tidak boleh menjalankan job. Jalankan `pnpm start` di bawah pengelola proses (pm2 atau systemd) di belakang proxy HTTPS yang meneruskan header `Host`, `X-Forwarded-Host`, dan `X-Forwarded-Proto`; `APP_URL` dibaca saat `pnpm build`, jadi atur sebelum build.

## Kontribusi dan asal-usul

- **Pembuat:** satu peserta hackathon yang approved (pemilik repo).
- **Dibuat dari nol selama periode hackathon** (mulai 28 Okt 2026). Tidak ada kode yang disalin dari proyek lain; pola desain umum (kontrak komponen form, pola agen) ditulis ulang.
- **Tooling pihak ketiga** di `.claude/skills/` (`hallmark`, `tailwind-4-docs`) adalah skill panduan pengembangan, bukan bagian produk, lengkap dengan lisensinya masing-masing.
- Semua data demo adalah seed palsu; tidak ada data klien, kunci API, atau kredensial di repo.
