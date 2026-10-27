# BRD-M09 — Meeting Intelligence (Speech-to-Text)

| | |
|---|---|
| **Status** | ✅ Disetujui owner (2026-10-28), v0.1.0 |
| **Tanggal** | 2026-10-28 |
| **Gelombang / Jalur** | 3 — AI & pengalaman / B |
| **Level usulan** | ✅ (inti demo, multimodal) |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-05, CR-08, CR-11, CR-12, CR-13, CR-16 |
| **Prasyarat** | BRD-M04, M05, M06, M07 |
| **Sumber** | `docs/02` §3 (batas Voice Transcribe, terverifikasi), permintaan owner (speech-to-text), konsep awal (Lead-to-Client Generator) |

## 1. Tujuan & nilai bisnis

Rekaman rapat atau voice note menjadi **transkrip, notulen, lead, task, dan draft proposal** tanpa mengetik ulang. Memakai Muse Voice Transcribe dan Muse Spark secara bermakna (bukan chatbot). Melayani G2, G5, G7.

## 2. Aktor & hak akses

| Aksi | Pemilik | Admin | Staf | Sistem | AI |
|---|---|---|---|---|---|
| Mengunggah rekaman / mengirim voice note | ✅ | ✅ | ✅ | — | — |
| Melihat transkrip dan notulen | ✅ | ✅ | pemilik rekaman ✅ | — | ✅ `read` |
| Menerima hasil sebagai lead/task/proposal draft | ✅ | ✅ | task saja | — | `draft` |
| Menghapus rekaman dan transkrip | ✅ | ✅ | milik sendiri | — | ❌ |

## 3. Lingkup

**Termasuk:** unggah audio (web) dan voice note (Telegram, M11); **pemotongan** rekaman > 10 menit; transkripsi **dengan pembeda pembicara**, hint bahasa Indonesia/Inggris + code-switching, biasing kosakata (nama produk/klien); **notulen terstruktur** (ringkasan, keputusan, action item); ekstraksi **lead** (structured output); draft **task** dan **proposal**; pemetaan Pembicara A/B ke nama; penghapusan; progres pemrosesan.

**Tidak termasuk:** transkripsi realtime/langsung rapat; timestamp per kata (tidak ada di model); analisis emosi; video; penyimpanan rekaman jangka panjang ⚠️; bergabung otomatis ke rapat online.

## 4. Proses bisnis

1. Pengguna mengunggah audio (atau mengirim voice note) dan memilih konteks (klien/lead ⚠️ opsional).
2. Sistem memvalidasi tipe/ukuran, **memotong** menjadi bagian ≤ 10 menit dan ≤ 32 MB, mengirim ke **Muse Voice Transcribe** (async, dengan progres), lalu **menggabungkan** transkrip.
3. Pengguna memetakan Pembicara A/B ke nama.
4. **Spark** menyusun notulen dan mengekstrak lead/action item dengan **structured output**.
5. Hasil tampil sebagai **draft**: notulen (M06), lead (M04), task (M05), proposal (M06). Pengguna menerima/menyunting/menolak tiap item.
6. Rekaman mentah dapat dihapus setelah selesai (opsi).

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M09-01 | Batas model: **≤ 10 menit dan ≤ 32 MB per permintaan**; rekaman lebih panjang dipotong dan digabung; lebih besar dari batas sistem ditolak dengan pesan jelas | Final (dokumentasi Meta) |
| BR-M09-02 | Format audio yang diterima ditetapkan setelah diuji ⚠️ (mp3/wav/m4a/ogg); di luar daftar ditolak | Usulan |
| BR-M09-03 | **Bahasa Indonesia didukung** (code-switching); hint bahasa diberikan; **akurasi nyata diuji** sebelum dijanjikan di demo | Final / ⚠️ uji |
| BR-M09-04 | Transkrip adalah **data tak tepercaya**; instruksi di dalam rekaman **tidak** dijalankan (CR-12) | Final |
| BR-M09-05 | Semua hasil turunan (notulen, lead, task, proposal) adalah **draft** dan tidak berlaku sampai diterima pengguna | Final (CR-08) |
| BR-M09-06 | **Angka/harga/tanggal yang disebut dalam rapat** ditampilkan sebagai kutipan ("disebut dalam rapat") untuk dikonfirmasi; harga proposal tetap dari paket resmi | Final (CR-05) |
| BR-M09-07 | Hasil berlabel **"dibantu AI"** dan menautkan kutipan transkrip sebagai sumber tiap action item | Final (CR-13) |
| BR-M09-08 | Pemrosesan **async** dengan status (`Diunggah`, `Memotong`, `Mentranskripsi`, `Menyusun`, `Selesai`, `Gagal`) dan percobaan ulang aman; kegagalan sebagian tidak membuang bagian yang berhasil | Usulan |
| BR-M09-09 | Setiap pemrosesan memeriksa **anggaran AI** dan tercatat di `ai_runs` (detik audio × tarif, token) | Final (CR-11) |
| BR-M09-10 | Audio mentah dihapus setelah transkripsi bila pengguna memilih; transkrip dapat dihapus kapan saja oleh pemilik/Admin | Usulan ⚠️ |
| BR-M09-11 | **Hanya rekaman demo/palsu** di lingkungan hackathon; peringatan privasi (persetujuan peserta rapat) ditampilkan sebelum unggah | Final (CR-16) |
| BR-M09-12 | Pembicara A/B dipetakan manual ke nama; sistem tidak menebak identitas | Final |

## 6. Entitas bisnis & data kunci

Rekaman Rapat (berkas, durasi, status, konteks), Transkrip (giliran bicara + pembicara + waktu), Notulen (dokumen M06), Hasil Turunan (draft lead/task/proposal) ber-relasi ke rekaman. Skema di ERD.

## 7. Keterkaitan modul

Bergantung pada M07 (STT, structured output, anggaran), M04, M05, M06, M01. Dipakai oleh M11 (voice note), M08 (opsional: task dari rapat muncul di briefing).

## 8. Integrasi eksternal & skill

Meta: `muse-voice-transcribe-1.0` (`POST /v1/asr/transcribe`, `wss://…/asr/realtime`), Muse Spark. Skill `meta-model-api-integration` ⬜.

## 9. Notifikasi & dokumen keluaran

Notifikasi "hasil rapat siap" (web/Telegram). Notulen sebagai dokumen/PDF.

## 10. Kriteria penerimaan

- [ ] Rekaman Indonesia ≤ 10 menit menghasilkan transkrip dengan pembicara A/B dan notulen berisi ringkasan, keputusan, action item.
- [ ] Rekaman 25 menit dipotong, ditranskripsi, dan digabung berurutan tanpa kehilangan bagian.
- [ ] Action item muncul sebagai **draft** task dengan kutipan sumber; tidak dihitung sebagai task terbuka sebelum diterima.
- [ ] Lead dari rapat muncul sebagai **draft** di pipeline; draft proposal memakai harga **paket resmi**, bukan angka lisan.
- [ ] Kalimat berisi perintah di dalam rekaman tidak memicu aksi apa pun.
- [ ] File di atas batas atau format tak didukung ditolak dengan pesan jelas.
- [ ] Anggaran habis menghentikan pemrosesan baru dengan pesan jelas; fitur lain tetap jalan.
- [ ] Menghapus rekaman menghapus berkas dan transkripnya (sesuai pilihan).

## 11. Risiko & pertanyaan terbuka

1. ⚠️ **Akurasi STT bahasa Indonesia + istilah teknis** belum diuji.
2. ⚠️ **Format audio** yang diterima endpoint belum diuji.
3. ⚠️ **Pemotongan audio** butuh alat (ffmpeg?) di server: dependensi baru.
4. ⚠️ Rekaman terhubung ke lead/klien sejak awal atau dipilih setelah selesai?
5. ⚠️ Retensi audio mentah.
