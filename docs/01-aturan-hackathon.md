# 01 — Aturan Hackathon (Meta Global AI Developer Hackathon)

Sumber: halaman resmi Cerebral Valley (dibaca 2026-10-28), Discord server hackathon (announcements dibaca 2026-10-28; rules/faqs/office-hours dibaca 2026-10-27).
**Belum dibaca/diverifikasi:** teks lengkap Official Rules (dipublikasikan 26 Okt), pinned messages, isi penuh Google Form kredit. Jangan jadikan ringkasan ini pengganti Official Rules.

## 1. Timeline (ET → WIB)

| Event | ET | WIB |
|---|---|---|
| Kickoff | 26 Okt 12:00 | 27 Okt 00:00 |
| Building | 27 Okt – 4 Nov | |
| **Deadline submit + klaim kredit $150** | **4 Nov 21:00** | **5 Nov 09:00** |
| Judging | 5 – 8 Nov | |
| Engagement X dihitung (Most Viral) | 8 Nov EOD | |
| Closing, finals, community vote | 9 Nov 12:00 | |
| Pemenang community vote | 16 Nov | |

Target internal: **submit sore 4 Nov WIB**.

## 1a. Verifikasi 2026-10-28 (halaman resmi + Discord #rules, #faqs, forum #questions)

- **Kontributor harus approved. Jawaban resmi** Kai | CV (26 Okt, #faqs): *"Can I work with someone who hasn't applied or been approved to this hackathon? No. Everyone involved in the creation process of the project must be approved. To form a team, you must choose from the approved participants. We cannot approve any more people as we are at max capacity."* Satu tim di akun Cerebral Valley tidak menggantikan approval event.
- **Jawaban resmi akun Cerebral Valley (forum #questions, 28 Okt):** berada dalam satu tim di akun Cerebral Valley tidak sama dengan approved; peserta yang belum approved tidak boleh terlibat sama sekali (kode, dokumen, desain, saran), tanpa pengecualian; approval sudah final karena event penuh.
- **Ganti ide boleh** (Cerebral Valley, forum #questions, 27 Okt): *"You can change your idea or theme at any time; there's nothing to update on the platform, since the track and idea are set when you submit."*
- **Proyek lama:** halaman Details menyebut startup boleh membangun di atas produk/codebase yang ada dengan identifikasi jelas bagian baru; FAQ Kai | CV (26 Okt) lebih ketat: repo submit harus *standalone extract* berisi kerja selama event. **Pegang yang lebih ketat** (repo ini dari nol).
- **Submit:** satu Representative per tim; cantumkan semua yang mengerjakan; repo public; video 3 menit; 3 Nov = hari penuh terakhir untuk pertanyaan submit; deadline 4 Nov 21:00 ET (Details menulis "EST").
- **Alat bantu coding (dibaca 2026-10-28 di #rules dan #faqs):** tidak ditemukan aturan yang melarang atau mewajibkan pengungkapan alat bantu coding AI. Satu-satunya penyebutan: "Muse Code is also available to help you code." (#faqs). Aturan yang berlaku tetap: *new work only* (semua dibuat 26 Okt–4 Nov), *identify your contributions* (demo hanya menampilkan yang dibuat selama event), repo publik, dan larangan memakai kode, data, atau aset tanpa hak. ⚠️ Teks **Official Rules** formal (disebut akan dipublikasikan sebelum 26 Okt dan wajib disetujui peserta) belum ditemukan di halaman event, #rules, atau #faqs; periksa dokumen yang Anda setujui saat mendaftar.
- **Rubrik Stage Two (0–10):** Impact 30%, Use of Meta AI Tooling 25%, Demo 25%, Technical Depth & Execution 20%. Stage One lulus/gagal: sesuai tema dan memakai Meta Model API/open-weight secara wajar.
- Bonus *Best Build on Meta Open Weight Models* ($10k) mensyaratkan Muse Glimmer/Muse Spark Open **di hardware sendiri**; tidak otomatis lewat Model API.

## 2. Aturan yang mengikat pekerjaan

1. Semua yang dipresentasikan dibuat selama periode event; kontribusi harus teridentifikasi (juri harus bisa membedakan yang baru).
2. Membangun di atas proyek lama boleh jika **repo submit adalah standalone extract**; video dibuka dengan satu kalimat "sudah ada apa vs dibangun minggu ini". **Proyek ini dimulai dari nol, jadi kalimatnya cukup menyebut latar bisnis.**
3. **Repo wajib public.** Link repo dan video harus berfungsi.
4. Tim maks 4 orang atau solo. Satu track (Indie atau Startup). **Satu orang yang submit. Semua kontributor harus peserta approved.**
5. Tema: *Build for Your World* atau *Push the Frontier*. **Proyek ini: Build for Your World, track Startup.**
6. **Wajib memakai Meta Model API dan/atau model open-weight Meta** (syarat lolos penyisihan).
7. Demo video 3 menit wajib. Juri menilai video, kode, dan produk live.
8. Usia 18+. Staf Meta/CV, kontraktor, dan terafiliasi pemerintah beserta rumah tangganya tidak boleh ikut.
9. Daftar proyek yang dihindari: AI medis/kesehatan, mental health, skin detector, **Basic RAG**, simple image analyzer, chatbot "AI for education", job application screener, nutrition coach, personality analyzer, sports analyzer/coach, politik/perang.

## 3. Penilaian

Penyisihan: sesuai tema + pemakaian Meta AI yang berarti. Lalu skor setara: **Impact, Use of Meta AI tooling, Technical depth & execution, Demo quality.** Top 5 per track maju ke final.

Track Startup: "teams and founders building a real product", dinilai pada eksekusi teknis dan **apakah bertahan di produksi**.

Hadiah Startup: $250k / 150k / 75k / 50k / 25k. Bonus: Most Viral $20k, Best Build on Open Weights $10k, Community Vote $10k, **Best Agentic Use-Case $5k**, **Best Creative Build $5k**.

## 4. Implikasi untuk repo ini

- Tanpa salin kode dari repo lama (lihat `CLAUDE.md` aturan 1).
- Commit kecil dan sering sejak 28 Okt agar kontribusi terbukti.
- Tidak ada data klien asli di repo public.
- **Hanya peserta approved yang boleh berkontribusi** (lihat 1a). Repo ini dikerjakan solo oleh owner (approved) (D-018).
- Demo harus menonjolkan: agen dengan approval, audit trail, multimodal (STT + gambar + vision), dan **bukan** "chatbot" atau "Basic RAG".
- Produk live (URL publik) dibutuhkan untuk penilaian: lihat D-007 di `docs/DECISIONS.md` (hosting belum diputuskan).

## 5. Kredit dan akun

- $150 kredit Meta Model API per orang; kartu kredit wajib; klaim sebelum tenggat.
- Pantau penggunaan kredit di halaman billing. **Jangan pernah mengirim API key atau data kartu di Discord.**
- "Spend Limit" belum tentu menghentikan tagihan: pantau penggunaan dan pasang anggaran harian di aplikasi.
- Kredit gratis: konten dapat dipakai untuk peningkatan produk Meta ("While using free credits your content may be used for product improvement", tertera di halaman billing). **Data nyata tidak boleh dikirim ke model selama memakai kredit gratis.**
