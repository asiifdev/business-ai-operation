# Changelog

Format [Keep a Changelog](https://keepachangelog.com/). Entri terbaru di atas. Perubahan dokumen murni tidak dicatat di sini (cukup git log).

## [Unreleased]

### Added
- M01 (sebagian): registrasi organisasi + Pemilik dalam satu transaksi, login/keluar (Better Auth), middleware sesi dan penolakan pengguna nonaktif, `AppShell` dan dasbor sementara, layanan pengguna (tambah, ubah peran, nonaktifkan), matriks izin, pembatas laju, `/api/health`. Halaman `/login`, `/register`, `/app`. 20 tes baru termasuk uji login terhadap hash buatan layanan.
- M15 (sebagian): `recordAudit` yang ditulis dalam transaksi yang sama dengan perubahan datanya.
- Konfigurasi produksi: `pnpm start`, `security.allowedDomains` dan `allowedHosts` dari `APP_URL`, bagian "Deploy ke server" di README.
- Skema database (Drizzle) kelompok auth dan AI core sesuai `docs/ERD.md`: 13 tabel, 4 migrasi di `drizzle/` termasuk penjaga SQL (Pemilik terakhir, audit append-only), 14 tes integrasi di `tests/db/` terhadap database uji sekali-pakai. Migrasi belum diterapkan ke database dev.
- Konfigurasi Better Auth (email + kata sandi, kolom tambahan `orgId`/`role`/`locale`) di `src/auth/auth.ts`; klien DB `src/db/client.ts`; util `env`.
- Tes sinkronisasi dokumen (`tests/docs-sync.test.ts`): tautan, rujukan keputusan, status BRD/PRD/ERD terhadap PLAN, indeks README, perintah `pnpm` di README, CHANGELOG.
- M14 (sebagian): token desain terang/gelap (arah Cobalt, provisional), Tailwind v4, util `format`/`money`/`files`/`i18n`, komponen form (`FormField`, `TextInput`, `NumberInput`, `MoneyInput`, `DateInput`, `SelectMenu`, `Textarea`, `Checkbox`/`CheckboxGroup`, `RadioGroup`, `Toggle`, `FileInput`, `InputError`), `Button`, `ThemeToggle`, pengalih bahasa ID/EN (`LocaleSwitch`, `useT`), galeri dev `/dev/komponen` (404 di produksi), 25 tes dasar termasuk larangan kontrol mentah.
- Scaffold Astro 7 (SSR, adapter Node) + React dan koneksi PostgreSQL lokal (tanpa skema; lihat DECISIONS D-006).
- Skill `hallmark` dan `tailwind-4-docs` di `.claude/skills`; MCP `astro-docs` di `.mcp.json`.
