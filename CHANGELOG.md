# Changelog

Format [Keep a Changelog](https://keepachangelog.com/). Entri terbaru di atas. Perubahan dokumen murni tidak dicatat di sini (cukup git log).

## [Unreleased]

### Added
- M14 (sebagian): token desain terang/gelap (arah Cobalt, provisional), Tailwind v4, util `format`/`money`/`files`/`i18n`, komponen form (`FormField`, `TextInput`, `NumberInput`, `MoneyInput`, `DateInput`, `SelectMenu`, `Textarea`, `Checkbox`/`CheckboxGroup`, `RadioGroup`, `Toggle`, `FileInput`, `InputError`), `Button`, `ThemeToggle`, pengalih bahasa ID/EN (`LocaleSwitch`, `useT`), galeri dev `/dev/komponen` (404 di produksi), 25 tes dasar termasuk larangan kontrol mentah.
- Scaffold Astro 7 (SSR, adapter Node) + React dan koneksi PostgreSQL lokal (tanpa skema; lihat DECISIONS D-006).
- Skill `hallmark` dan `tailwind-4-docs` di `.claude/skills`; MCP `astro-docs` di `.mcp.json`.
