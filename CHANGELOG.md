# Changelog

Format [Keep a Changelog](https://keepachangelog.com/). Entri terbaru di atas. Perubahan dokumen murni tidak dicatat di sini (cukup git log).

## [Unreleased]

### Added
- M11 (sebagian): `src/integrations/telegram`: klien Bot API (kirim dan sunting pesan, jawab callback, unduh berkas ≤ 20 MB, webhook, polling), verifikasi `X-Telegram-Bot-Api-Secret-Token` dengan pembanding waktu-konstan, `callback_data` `ap:<id>:<y|n|d>`, kode pairing 128 bit (hanya hash disimpan), pembantu escape dan pemecah teks, parser update; 40 tes tanpa jaringan.
- M07 (sebagian): `src/ai`: antarmuka `AiProvider`, `MetaProvider` (chat dengan tool calling dan structured output, STT, gambar; pencarian bawaan Muse Image dimatikan), klien HTTP dengan retry dan backoff yang menghormati `Retry-After`, tabel harga dalam micro-USD, pemeriksa WAV, penjaga model `-contributor`, dan `FakeProvider`; 52 tes tanpa jaringan. Keputusan D-036.
- Skill `meta-model-api-integration` (`.claude/skills/`): panduan integrasi Meta Model API dari dokumentasi resmi (protokol, reasoning dan batas token, tool calling, structured output, gambar masuk dan keluar, STT, file, retry, caching) beserta daftar butir yang belum diuji.
- Skill `telegram-bot-integration` (`.claude/skills/`): panduan webhook, tombol inline untuk persetujuan, pairing lewat deep link, voice note dan foto, format pesan, rate limit, dari teks asli dokumentasi Telegram, beserta daftar butir yang belum diuji.
- M16 (tampilan): palet Cobalt Soft (krem hangat di mode terang, biru-abu lembut di mode gelap, token `--color-warm`), efek gerak yang mati saat "kurangi gerakan" (latar bergerak, muncul 3D, kartu tilt, parallax hero, bar kemajuan scroll); teks Indonesia ditulis ulang di semua halaman publik; perbaikan hidrasi `PriceEstimator`.
- M16 (sebagian): situs publik multi-halaman EN dan ID (17 halaman) dengan SEO teknis, data terstruktur, `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt`, `pricing.md`, gambar Open Graph, GA4 dengan persetujuan, halaman privasi dari registri, beranda dengan hero beranimasi, "Cara kerja" interaktif, kalkulator harga; merek Orbyte (wordmark Krona One, logo dengan kontras terkoreksi); 400+ tes termasuk pemeriksaan atas hasil build.
- M01 (sebagian): registrasi organisasi + Pemilik dalam satu transaksi, login/keluar (Better Auth), middleware sesi dan penolakan pengguna nonaktif, `AppShell` dan dasbor sementara, layanan pengguna (tambah, ubah peran, nonaktifkan), matriks izin, pembatas laju, `/api/health`. Halaman `/login`, `/register`, `/app`. 20 tes baru termasuk uji login terhadap hash buatan layanan.
- M15 (sebagian): `recordAudit` yang ditulis dalam transaksi yang sama dengan perubahan datanya.
- Konfigurasi produksi: `pnpm start`, `security.allowedDomains` dan `allowedHosts` dari `APP_URL`, bagian "Deploy ke server" di README.
- Skema database (Drizzle) kelompok auth dan AI core sesuai `docs/ERD.md`: 13 tabel, 4 migrasi di `drizzle/` termasuk penjaga SQL (Pemilik terakhir, audit append-only), 14 tes integrasi di `tests/db/` terhadap database uji sekali-pakai. Migrasi belum diterapkan ke database dev.
- Konfigurasi Better Auth (email + kata sandi, kolom tambahan `orgId`/`role`/`locale`) di `src/auth/auth.ts`; klien DB `src/db/client.ts`; util `env`.
- Tes sinkronisasi dokumen (`tests/docs-sync.test.ts`): tautan, rujukan keputusan, status BRD/PRD/ERD terhadap PLAN, indeks README, perintah `pnpm` di README, CHANGELOG.
- M14 (sebagian): token desain terang/gelap (arah Cobalt, provisional), Tailwind v4, util `format`/`money`/`files`/`i18n`, komponen form (`FormField`, `TextInput`, `NumberInput`, `MoneyInput`, `DateInput`, `SelectMenu`, `Textarea`, `Checkbox`/`CheckboxGroup`, `RadioGroup`, `Toggle`, `FileInput`, `InputError`), `Button`, `ThemeToggle`, pengalih bahasa ID/EN (`LocaleSwitch`, `useT`), galeri dev `/dev/komponen` (404 di produksi), 25 tes dasar termasuk larangan kontrol mentah.
- Scaffold Astro 7 (SSR, adapter Node) + React dan koneksi PostgreSQL lokal (tanpa skema; lihat DECISIONS D-006).
- Skill `hallmark` dan `tailwind-4-docs` di `.claude/skills`; MCP `astro-docs` di `.mcp.json`.
