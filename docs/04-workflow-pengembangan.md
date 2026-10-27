# 04 — Workflow Pengembangan (dua jalur, dua jalur kerja)

Pelengkap `CLAUDE.md`. Tujuannya satu: dua jalur kerja bergerak di satu jalur yang sama.

## 1. Pembagian jalur

| Jalur | Cakupan | Pemilik |
|---|---|---|
| **A — Platform & Data** | M01 Org & Auth, M02 Portfolio, M03 Billing (+ PDF engine), M04 Pipeline, M05 Tasks/Maintenance, M12 Dashboard & BI, M15 Audit & Guardrail data | ⚠️ nama developer A |
| **B — AI & Pengalaman** | M07 AI Core, M08 Action Center & Approvals, M09 Meeting Intelligence, M10 Marketing Studio, M11 Telegram, M14 Design system & UI kit | ⚠️ nama developer B |

Titik temu (kontrak yang dibekukan lebih dulu di PRD/ERD): skema tabel, tanda tangan service publik yang dipanggil tool AI, bentuk event scheduler, bentuk `approvals` dan `ai_runs`. Nama pemilik diisi di `docs/PLAN.md`.

## 2. Aturan kepemilikan

1. Satu modul satu pemilik. Mengubah modul orang lain lewat PR + pemberitahuan.
2. **File bersama** (CLAUDE.md, docs/*, package.json, astro.config.mjs, skema DB, registri tool): selalu lewat PR dan checklist DoD.
3. Kontrak antarjalur tidak diubah diam-diam: ubah di dokumen, catat di `docs/DECISIONS.md`, baru kode.
4. Dua jalur kerja **tidak boleh** mengedit file yang sama bersamaan tanpa koordinasi: sebelum mulai, tarik `main` terbaru dan baca `docs/PLAN.md`.

## 3. Git

- Trunk: `main`, selalu bisa `pnpm build`. Tanpa force push.
- Branch: `feat/<modul>-<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`.
- Commit kecil dan sering (juga bukti kontribusi untuk hackathon). Conventional Commits.
- PR kecil (idealnya < 400 baris diff), memakai checklist DoD di `CLAUDE.md`. Review lewat checklist DoD. Boleh self-merge hanya untuk `docs:` murni yang tidak mengubah kontrak, dengan pemberitahuan.
- `pnpm-lock.yaml` konflik: ambil versi `main`, jalankan `pnpm install`, commit ulang.
- Migrasi DB: satu PR satu migrasi, urut waktu; jangan edit migrasi yang sudah digabung, buat migrasi baru.

## 4. Lingkungan lokal

- Node **22.23.4** (`nvm use 22.23.4`), pnpm.
- `.env` dari `.env.example`. `DATABASE_URL` ke Postgres lokal masing-masing developer (database `ai_business_operation`). `MODEL_API_KEY` milik masing-masing; **tidak dibagikan lewat chat/commit**.
- Jika folder home berisi `node_modules/` lama (mis. `~/node_modules`), bundel server dapat salah me-resolve paket: `cookie@^2` dipin sebagai dependensi langsung (lihat DECISIONS D-012).
- Data demo: seed palsu, deterministik, menolak jalan di production.

## 5. Siklus satu fitur

```
1. Baca docs/PLAN.md + BRD/PRD/ERD modul + skill terkait.   (blocked? tandai di PLAN, ambil task lain)
2. Branch dari main terbaru.
3. Service + tes unit → endpoint → UI (komponen reusable) → hubungkan ke modul dependensi.
4. Verifikasi manual di browser, lalu tulis E2E Playwright.
5. Checklist DoD semua centang. Update PLAN, CHANGELOG, README (bila relevan).
6. PR → review → merge → hapus branch.
```

## 6. Testing

- **Unit** (wajib): kalkulasi uang/pajak/tanggal jatuh tempo, state machine invoice/subscription/approval, pemilihan tool dan tier.
- **E2E** (wajib untuk fitur ber-UI): uji manual di browser untuk eksplorasi, Playwright untuk regression. Minimal golden path + satu error path + verifikasi efek lintas-modul.
- **Tes AI:** panggilan model dibungkus `AiProvider` sehingga tes memakai provider palsu deterministik. Tes "nyata" ke Meta dijalankan manual dan sedikit (kredit terbatas).
- Skenario guardrail wajib punya tes: `act` tanpa approval tidak jalan; query tanpa `org_id` ditolak; konten tak tepercaya tidak memicu `act`.

## 7. Changelog, plan, README

- `CHANGELOG.md` (Keep a Changelog): fitur selesai, perubahan alur terlihat pengguna, bug yang menyentuh data/uang.
- `docs/PLAN.md` diperbarui di commit yang sama dengan perubahan.
- `README.md` mencerminkan struktur dan cara menjalankan.

## 8. Review

- Gunakan skill `hallmark` untuk UI; Astro Docs MCP dan Context7 untuk API pustaka.
- Jangan mengubah `.claude/settings*.json`, hook, atau `.mcp.json` tanpa PR.
- Jangan menambah dependensi tanpa menyebutkannya di PR (alasan + ukuran + lisensi).
