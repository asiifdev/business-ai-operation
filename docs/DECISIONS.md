# DECISIONS — log keputusan

Format: ID, tanggal, keputusan, alasan, status. Keputusan baru ditambah di bawah; yang berubah diberi status baru, tidak dihapus.

| ID | Tanggal | Keputusan | Alasan | Status |
|---|---|---|---|---|
| D-001 | 2026-10-28 | Framework **Astro 7** (SSR, adapter Node) + React islands | Permintaan owner; cocok untuk dashboard + endpoint + webhook dalam satu app | ✅ final |
| D-002 | 2026-10-28 | Nama kerja `business-ai-operation`; brand final TBD | Untuk agensi/startup, bukan indie | ✅ kerja, brand ⚠️ |
| D-003 | 2026-10-28 | **Track Startup**, tema *Build for Your World*, SaaS-ready (`org_id`) | Owner menargetkan agensi/startup; hadiah track lebih besar; juri menilai "real product" | ✅ final |
| D-004 | 2026-10-28 | Tolak skill Telegram pihak ketiga (pengirim pesan satu arah). Telegram dibangun sebagai **fitur produk** (Bot API + webhook + inline keyboard) dengan skill buatan sendiri `telegram-bot-integration` dari dokumentasi resmi | Skill itu satu arah (kirim/jadwalkan), tanpa tombol interaktif, butuh deploy key Convex production, 1 commit, lisensi tidak jelas. Kebutuhan owner: asisten interaktif yang terhubung ke sistem | ✅ final |
| D-005 | 2026-10-28 | ORM **Drizzle** + postgres-js + drizzle-kit | Tanpa codegen, ringan dengan Vite/Astro | ✅ final, versi dari `package.json` |
| D-006 | 2026-10-28 | Draf skema Drizzle + migrasi `0000` (dibuat sebelum dokumen ada dan sebelum ERD disetujui) **dihapus**; database lokal `ai_business_operation` dikembalikan kosong (0 tabel). Tidak ada skema/migrasi sampai ERD disetujui | Dikoreksi owner: migrasi diterapkan tanpa persetujuan ERD. Draf kosong tanpa data, aman dihapus | ✅ final |
| D-007 | 2026-10-28 | Hosting live untuk penilaian juri | Owner: server live + domain sudah siap. ⚠️ detail (provider, Postgres produksi, storage, domain webhook Telegram) dicatat di PRD | ✅ tersedia, detail ⚠️ |
| D-008 | 2026-10-28 | Mekanisme job/scheduler | Opsi: job berbasis Postgres, atau proses cron terpisah. Hindari Redis demi jumlah infrastruktur | ⚠️ diputuskan di PRD |
| D-009 | 2026-10-28 | Pustaka auth | Kandidat Better Auth; verifikasi dukungan Astro | ⚠️ diputuskan di PRD |
| D-010 | 2026-10-28 | Pustaka bot Telegram | Kandidat grammY; verifikasi lewat skill `telegram-bot-integration` | ⚠️ |
| D-011 | 2026-10-28 | RLS Postgres atau filter di repo saja | Isolasi tenant: sabuk kedua vs waktu | ⚠️ diputuskan di ERD |
| D-012 | 2026-10-28 | `cookie@^2` dipin sebagai dependensi langsung | Bundel server me-resolve `cookie` lama dari `~/node_modules` milik mesin pengembang dan gagal build | ✅ |
| D-013 | 2026-10-28 | **UI dwibahasa Indonesia (ID) dan Inggris (EN)** dengan pengalih bahasa; semua teks lewat kamus `src/lib/i18n.ts`, tanpa teks hardcode di komponen. Bahasa awal: pilihan tersimpan, lalu bahasa browser, lalu Indonesia. Format Rupiah dan tanggal (DD/MM/YYYY) sama di kedua bahasa. Pesan bot Telegram (M11) mengikuti preferensi bahasa masing-masing pengguna. Galeri dev `/dev/komponen` dibiarkan Inggris (hanya development) | Keputusan owner (2026-10-28): "bahasa UI menggunakan ID/EN" | ✅ final |
| D-014 | 2026-10-28 | Pemilahan modul MVP (penuh/minimal/ditunda) | Lihat `docs/09`; waktu ±7 hari | ✅ Owner (2026-10-28): **scope penuh** seperti BRD awal (semua modul usulan ✅/◐ dikerjakan), solo. ⚠️ Risiko jadwal dicatat di PLAN; urutan gelombang BRD dipertahankan agar bagian yang tidak selesai selalu yang paling akhir |
| D-015 | 2026-10-28 | Ide/tema boleh diganti kapan saja setelah diterima | Terverifikasi: Cerebral Valley (forum #questions, 27 Okt) "You can change your idea or theme at any time" | ✅ terverifikasi |
| D-016 | 2026-10-28 | Node dev = 22.23.4 | Astro 7 mensyaratkan >= 22.23.4; Node 24.11.1 mesin owner terkena kerentanan | ✅ |
| D-018 | 2026-10-28 | **Kontributor hanya peserta approved; repo ini dikerjakan solo oleh owner (approved)** (dua sesi paralel, jalur A dan B) | Jawaban resmi Kai | CV (#faqs, 26 Okt) dan akun resmi Cerebral Valley (forum #questions, 28 Okt): semua yang terlibat (kode, dokumen, desain, saran) harus approved; berada dalam satu tim di akun Cerebral Valley tidak menggantikan approval; kapasitas penuh, tidak ada approval tambahan. Risiko diskualifikasi | ✅ final |
| D-019 | 2026-10-28 | Panggilan model: `max_tokens` ≥ 1.000 dan `reasoning_effort` eksplisit | Uji nyata: token reasoning memakan jatah `max_tokens`, isi jawaban bisa `null` | ✅ |
| D-020 | 2026-10-28 | Format BRD: satu dokumen induk `docs/BRD.md` + **satu file per modul** `docs/brd/BRD-Mxx-<slug>.md` + indeks `docs/brd/README.md` | Permintaan owner (rapi, jelas, detail); struktur dokumen berjenjang | ✅ |
| D-021 | 2026-10-28 | Pustaka komponen form dikerjakan sebelum ERD (izin eksplisit owner). Arah visual **provisional**: genre modern-minimal, tema katalog Cobalt (kertas dingin, satu aksen kobalt, Familjen Grotesk + IBM Plex Sans, JetBrains Mono hanya untuk nilai mesin), token terang/gelap di `src/styles/tokens.css`. Bahasa UI: lihat D-013. Kode komponen ditulis dari nol di repo ini | Kontrak komponen tidak bergantung pada ERD; token dikunci setelah owner menyetujui tampilan galeri | ✅ dikerjakan, ⚠️ arah visual menunggu persetujuan owner |
| D-017 | 2026-10-28 | Skill `hallmark` dan `tailwind-4-docs` dipasang di `.claude/skills`; MCP `astro-docs` di `.mcp.json` | Permintaan owner; sumber diperiksa sebelum dipasang | ✅ |
