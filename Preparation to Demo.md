Saya sudah memeriksa aplikasi live, halaman resmi hackathon, dan panduan video demo Devpost. Ada beberapa temuan yang mengubah brief sebelumnya.

## 1. Aplikasi live (`ai-business.asiifdev.com`)
- **Org yang sedang login ("NoName") masih kosong.** Dasbor, Action Center, Meetings, dan Audit log tidak berisi apa pun, dan semua angka Rp 0. Dalam kondisi ini adegan Action Center, briefing, dan persetujuan tidak bisa direkam.
  - Buat org demo baru dengan nama yang meyakinkan (misalnya agensi fiktif), lalu isi datanya lewat UI sesuai aturan CLAUDE.md: profil dan logo perusahaan, 3–4 produk dan paket, 4–5 klien, langganan, invoice yang sudah lewat jatuh tempo, lead yang diam lebih dari N hari, dan beberapa tugas.
  - Perlu 1–2 hari kalender supaya penjadwal sempat memunculkan temuan dan briefing. Jadi **seed paling lambat 2 Nov**.
- **UI sudah berbahasa Inggris dan rapi** (tema gelap). Narasi cukup dalam bahasa Inggris dan tidak perlu terjemahan.
- **Kotak "Ask Orbyte about your business" ada di paling atas dasbor.** Jangan buka video dengan kotak ini, karena akan langsung terlihat seperti chatbot. Pakai kotak ini nanti di adegan asisten, dan gunakan untuk memicu tindakan, bukan untuk tanya-jawab.
- Halaman yang bisa jadi bukti "siap produksi": **AI usage** (`/app/ai`: anggaran harian dan log setiap run), **Audit log** (dengan catatan "Entries cannot be edited or deleted"), dan pengaturan organisasi.
- **Kuota Marketing Studio: 20 gambar per hari.** Simpan kuota untuk latihan dan take final.
- Halaman `/app/marketing` sempat membuat tab macet sekitar 30 detik saat saya mengambil tangkapan layar. Periksa sekali sebelum merekam, siapa tahu halamannya berat.

## 2. Halaman resmi Cerebral Valley
- **Startup track dinilai pada "technical execution and whether it holds up in production."** Penutup video sebaiknya tidak sekadar ringkasan fitur, tetapi bukti produksi: URL live, multi-tenant, log biaya per run, anggaran harian, audit yang tidak bisa diubah, dan penolakan klaim palsu.
- Model yang disebut di halaman: Muse Spark, **Muse Wonder**, Muse Image, **SAM 3.1**, dan model open-weight. Orbyte memakai Spark, Image, dan Voice Transcribe. SAM 3.1 belum dipakai, jadi jangan diklaim. Muse Wonder tercantum di `src/ai/pricing.ts`, tetapi saya belum memastikan ada fitur yang memakainya. Sebut di video hanya kalau memang dipakai.

## 3. Panduan video Devpost
- **Pitch dan masalah disampaikan di 10–15 detik pertama.** Juri menonton banyak video berturut-turut.
- **Jangan berupa slide deck.** Perlihatkan produk berjalan dengan input nyata. Slide hanya untuk diagram arsitektur yang singkat.
- **Jangan mempercepat audio** agar muat 3 menit. Lebih baik kurangi adegannya. Yang boleh dipercepat hanya bagian menunggu, dengan narasi tetap normal.
- Hubungkan isi video dengan kriteria penilaian secara eksplisit.
- Unggah ke YouTube sebagai **Unlisted**, tandai **"Not made for kids"** (kalau tidak, juri bisa gagal memutarnya), dan unggah jauh sebelum tenggat.
- Tulis naskahnya sendiri. Naskah buatan AI cenderung generik. Jadikan draf saya hanya kerangka, lalu ganti dengan kata-kata Anda.

## Perubahan pada brief
| Bagian | Sebelumnya | Sekarang |
|---|---|---|
| Persiapan nomor 1 | Uji fitur yang belum diuji | **Buat org demo dan isi datanya lewat UI dulu**, baru uji fitur |
| Penutup (2:45–3:00) | Diagram + URL | Diagram + **10 detik bukti produksi**: AI usage (biaya per run, cap harian) dan audit log |
| Klaim model | Spark, Image, Voice Transcribe | Tetap tiga itu saja; SAM dan Wonder jangan diklaim |
| Distribusi | n/a | YouTube Unlisted, "Not made for kids", unggah paling lambat 4 Nov siang |

Langkah berikutnya bisa salah satu dari dua ini:
- Saya susun **daftar data seed** untuk org demo, berisi nama klien, nominal, dan tanggal yang dirancang agar temuan Action Center muncul tepat saat rekaman.
- Saya isi data itu sendiri lewat UI di Claude in Chrome.