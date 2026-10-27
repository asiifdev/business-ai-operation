import type { PageContent, PageSlug } from './types';

const updated = '2026-10-28';

/** Bahasa Indonesia. `{email}` dan `{brand}` diganti saat dirender. Himpunan halaman harus sama dengan bahasa Inggris. */
export const id: Record<PageSlug, PageContent> = {
  '': {
    title: 'Orbyte: Sistem Operasi Bisnis Berbasis AI untuk Agensi',
    description: 'Orbyte menyatukan klien, invoice, calon klien, dan tugas di satu tempat. AI memberi tahu apa yang perlu ditangani, Anda yang menyetujui tindakan berisiko.',
    h1: 'Jalankan agensi Anda dengan AI yang bertanya sebelum bertindak',
    answer:
      '{brand} adalah aplikasi untuk menjalankan agensi dan software house. Klien, langganan, invoice, calon klien, dan tugas ada di satu tempat. AI memberi tahu apa yang perlu ditangani dan menyiapkan langkah berikutnya. Tindakan berisiko baru berjalan setelah Anda setujui, dan semuanya tercatat di riwayat perubahan.',
    updated,
    home: {
      h1Accent: 'bertanya sebelum bertindak',
      howHeading: 'Cara kerjanya',
      howIntro: 'Empat langkah, dari data bisnis sampai tindakan yang Anda setujui. Pilih satu langkah untuk melihat contohnya di sebelah kanan.',
      stages: [
        { title: 'Data Anda jadi acuan utama', body: 'Produk, klien, langganan, dan invoice tersimpan rapi. Nominal, tanggal, dan status dihitung oleh program, bukan ditebak AI.' },
        { title: 'Aturan menandai yang perlu ditangani', body: 'Aturan yang berjalan terjadwal memunculkan peringatan, misalnya invoice yang lewat jatuh tempo, perpanjangan yang sudah dekat, atau calon klien yang lama tidak dihubungi. Peringatan yang sama tidak muncul dua kali.' },
        { title: 'AI menjelaskan dan menulis draf', body: 'Untuk tiap peringatan, AI menulis penjelasan singkat dan draf tindak lanjut dengan angka asli dari data Anda. Tidak ada yang dikirim ke siapa pun.' },
        { title: 'Anda menyetujui, semuanya tercatat', body: 'Tindakan berisiko menunggu persetujuan Anda di aplikasi web atau Telegram. Setelah disetujui, tindakan berjalan dengan cara yang sama seperti tombol manual, dan riwayat perubahan mencatat siapa atau apa yang melakukannya.' },
      ],
      ctaPrimary: 'Buat organisasi Anda',
      ctaSecondary: 'Lihat cara kerjanya',
      closing: 'Akses awal sudah dibuka. Anda bisa membuat organisasi dan masuk hari ini. Fitur dibangun secara terbuka, dan setiap fitur diberi status apa adanya.',
      note: 'Akses awal gratis. Dibangun dengan Meta Model API.',
      controlsHeading: 'Dirancang agar Anda tetap memegang kendali',
      controls: [
        { title: 'Persetujuan sebelum risiko', body: 'AI menyiapkan draf, Anda yang memutuskan. Tindakan berisiko selalu menunggu persetujuan.', status: 'in_development' },
        { title: 'Riwayat perubahan yang tidak bisa diedit', body: 'Setiap perubahan mencatat siapa atau apa yang melakukannya. Catatan itu tidak bisa diubah maupun dihapus.', status: 'in_development' },
        { title: 'Data Anda tetap terpisah', body: 'Data tiap organisasi dipisahkan dua kali: di aplikasi dan di basis data.', status: 'available' },
        { title: 'AI tidak pernah menyentuh uang', body: 'Nominal, pajak, dan status pembayaran dihitung program dari pembayaran yang tercatat, bukan oleh AI.', status: 'in_development' },
      ],
    },
    faq: [
      { q: 'Apa itu {brand}?', a: '{brand} adalah aplikasi untuk menjalankan agensi dan software house. Data bisnis tersimpan rapi, AI menandai yang perlu ditangani dan menyiapkan langkah berikutnya, dan Anda menyetujui dulu sebelum tindakan berisiko dijalankan.' },
      { q: 'Bisakah dipakai hari ini?', a: 'Bisa. Akses awal sudah dibuka, jadi Anda bisa membuat organisasi dan masuk sekarang. Fitur lain masih dibangun, dan statusnya ditampilkan di situs ini.' },
    ],
  },
  product: {
    title: 'Fitur Orbyte: Billing, Pusat Tindakan, Telegram',
    description: 'Yang bisa dikerjakan Orbyte untuk agensi: langganan dan invoice, Pusat Tindakan AI dengan persetujuan Anda, notulen rapat, Telegram, dan gambar pemasaran.',
    h1: 'Yang dikerjakan Orbyte',
    answer:
      '{brand} menangani pekerjaan yang berulang di agensi: langganan dan invoice, Pusat Tindakan tempat AI memberi peringatan dan menyiapkan langkah berikutnya, rekaman rapat yang jadi notulen, asisten Telegram, dan gambar pemasaran. Setiap fitur di bawah menunjukkan status dan batasannya saat ini.',
    updated,
    sections: [
      {
        heading: 'Yang tidak dilakukan Orbyte',
        bullets: [
          'Tidak mengirim pesan atau invoice ke klien Anda secara otomatis.',
          'Tidak membuat video atau suara.',
          'Tidak membiarkan AI mengubah pembayaran, nominal invoice, atau harga.',
          'Bukan pengganti aplikasi akuntansi Anda, dan tidak menerima pembayaran.',
        ],
      },
    ],
  },
  'product/action-center': {
    title: 'Pusat Tindakan: Peringatan AI dengan Persetujuan Anda',
    description: 'Cara Pusat Tindakan Orbyte mengubah kejadian bisnis menjadi peringatan, membiarkan AI menyiapkan langkah berikutnya, lalu menunggu persetujuan Anda.',
    h1: 'Pusat Tindakan: peringatan AI dengan persetujuan Anda',
    answer:
      'Pusat Tindakan mengubah kejadian bisnis jadi peringatan, misalnya invoice yang lewat jatuh tempo. AI menjelaskan tiap peringatan dengan angka asli Anda dan menulis draf tindak lanjut, tetapi tidak pernah mengirimnya. Anda yang menyetujui atau menolak setiap tindakan berisiko, di aplikasi web atau di Telegram.',
    updated,
    sections: [
      { heading: 'Bagaimana peringatan menjadi tindakan', bullets: ['Aturan yang berjalan terjadwal menemukan suatu kondisi, misalnya invoice terlambat.', 'Peringatan hanya dibuat satu kali. Aturan yang berjalan lagi tidak membuat peringatan ganda.', 'AI menjelaskan dan menulis pesan dengan angka yang dibaca dari data Anda.', 'Anda bisa menyetujui, menolak, atau mengedit. Tindakan yang disetujui berjalan dengan cara yang sama seperti tombol manual.'] },
      { heading: 'Yang tidak bisa dilakukan AI di sini', bullets: ['Mencatat atau mengubah pembayaran.', 'Mengubah nominal invoice, jatuh tempo, atau harga paket.', 'Menghapus data, atau mengubah peran dan pengaturan.', 'Mengirim apa pun ke luar aplikasi.'] },
    ],
  },
  'product/billing': {
    title: 'Langganan dan Invoice Tanpa Kejutan Hitungan',
    description: 'Orbyte menyiapkan draf invoice sebelum jatuh tempo, menghitung total lewat program, mencatat pembayaran yang tidak bisa diubah, dan mengekspor PDF.',
    h1: 'Langganan dan invoice tanpa kejutan hitungan',
    answer:
      '{brand} menyimpan langganan tiap klien dan menyiapkan draf invoice sebelum jatuh tempo. Total, pajak, jatuh tempo, dan status pembayaran dihitung oleh program, bukan oleh AI. Pembayaran dicatat sebagai catatan yang tidak bisa diubah, dan setiap invoice bisa diunduh sebagai PDF yang sama persis dengan tampilan di layar.',
    updated,
    sections: [
      { heading: 'Yang dihitung oleh program', bullets: ['Total invoice dan pajak, dari rincian tiap baris.', 'Nomor invoice yang berurutan tanpa terlewat.', 'Status lewat jatuh tempo, dihitung dari tanggal jatuh tempo.', 'Status lunas, dihitung dari pembayaran yang tercatat.'] },
      { heading: 'Tidak termasuk', bullets: ['Penerimaan pembayaran online.', 'Pengiriman invoice otomatis ke klien. Anda mengunduh PDF atau menyalin pesannya sendiri.', 'Beberapa mata uang dan nota kredit.'] },
    ],
  },
  'product/meetings': {
    title: 'Rekaman Rapat Menjadi Notulen, Calon Klien, dan Tugas',
    description: 'Unggah rekaman rapat, lalu Orbyte mengubahnya jadi tulisan, ringkasan, dan draf tugas untuk Anda periksa. Mendukung bahasa Indonesia dan Inggris.',
    h1: 'Rekaman rapat menjadi notulen, calon klien, dan tugas',
    answer:
      'Unggah rekaman rapat, dan {brand} mengubahnya jadi tulisan, membuat notulen berisi keputusan dan daftar tindakan, lalu menyiapkan draf calon klien dan tugas untuk Anda periksa. Bahasa Indonesia dan Inggris didukung, tiap berkas maksimal sepuluh menit, dan tidak ada yang jadi tugas sungguhan sebelum Anda menerimanya.',
    updated,
    sections: [
      { heading: 'Cara kerjanya', bullets: ['Rekaman yang lebih panjang dipotong dulu, diubah jadi tulisan, lalu digabung kembali sesuai urutan.', 'Nama pembicara ditampilkan kalau model suaranya bisa mengenali.', 'Harga di draf proposal selalu diambil dari daftar paket Anda, bukan dari yang diucapkan di rapat.', 'Kalimat perintah yang terucap di rekaman hanya dianggap isi pembicaraan, tidak pernah dijalankan.'] },
      { heading: 'Rekaman Anda', bullets: ['Menghapus rekaman otomatis menghapus tulisan lengkapnya juga.', 'Selama akses awal, jangan mengunggah rekaman yang memuat data klien sungguhan.'] },
    ],
  },
  'product/telegram': {
    title: 'Asisten Telegram Interaktif untuk Persetujuan',
    description: 'Setujui atau tolak peringatan Orbyte lewat tombol di Telegram. Hasilnya sama dengan di aplikasi web dan tercatat di riwayat perubahan.',
    h1: 'Asisten Telegram interaktif untuk persetujuan',
    answer:
      'Hubungkan akun Telegram Anda ke {brand} untuk menerima peringatan berupa kartu dengan tombol Setujui, Tolak, dan Detail. Persetujuan di Telegram berjalan sama seperti di aplikasi web, hasilnya tampil di pesan, dan tercatat di riwayat perubahan. Peran Anda juga membatasi apa saja yang bisa disetujui di sana.',
    updated,
    sections: [
      { heading: 'Aturan keamanan', bullets: ['Kode sekali pakai menghubungkan satu chat ke satu pengguna. Chat yang belum terhubung tidak menerima data apa pun.', 'Menekan Setujui dua kali, atau dari web dan Telegram bersamaan, hanya dijalankan satu kali.', 'Akun Staf tidak bisa menyetujui tindakan keuangan, di Telegram maupun di tempat lain.'] },
    ],
  },
  'product/marketing-studio': {
    title: 'Marketing Studio: Gambar dan Teks dari Data Anda',
    description: 'Buat gambar dan teks pemasaran dari data produk dan identitas merek Anda. Harga diambil dari paket Anda, dan gambar buatan AI diberi label.',
    h1: 'Marketing Studio: gambar dan teks dari data produk Anda',
    answer:
      'Marketing Studio membuat gambar dan teks untuk peluncuran, promo, dan rilis dari data produk dan identitas merek Anda sendiri. Teksnya hanya memuat fakta yang ada di data Anda, harga diambil dari paket resmi, dan gambar buatan AI diberi label. Tidak membuat video atau suara.',
    updated,
    sections: [
      { heading: 'Batasan', bullets: ['Tidak membuat video dan tidak ada pengisi suara.', 'Tidak ada testimoni, statistik, atau logo pelanggan karangan.', 'Pemakaian AI dibatasi per hari untuk setiap organisasi.'] },
    ],
  },
  'how-it-works': {
    title: 'Cara Kerja Orbyte: dari Data sampai Riwayat Perubahan',
    description: 'Orbyte menyimpan data bisnis dengan rapi, memunculkan peringatan lewat aturan, membiarkan AI menulis draf, dan mencatat setiap tindakan yang Anda setujui.',
    h1: 'Cara kerja Orbyte, dari data sampai riwayat perubahan',
    answer:
      '{brand} menyimpan data bisnis Anda dengan rapi. Aturan yang berjalan terjadwal memunculkan peringatan dari data itu, AI menjelaskan dan menulis draf dengan angka asli, lalu Anda menyetujui tindakan berisiko. Tindakan yang disetujui berjalan sama seperti tombol manual, dan setiap langkah masuk ke riwayat perubahan yang tidak bisa diubah.',
    updated,
    sections: [
      { heading: 'Mengapa AI tidak pernah mengubah uang', paragraphs: ['Nominal, pajak, jatuh tempo, dan status pembayaran dihitung program dari pembayaran yang tercatat. AI hanya membaca angka itu dan menjelaskannya. Yang bisa dilakukannya sebatas menulis draf, bukan mencatat pembayaran atau mengubah nominal.'] },
      { heading: 'Mengapa peringatan tidak pernah muncul dua kali', paragraphs: ['Setiap tindakan otomatis punya penanda unik. Kalau aturan berjalan lagi untuk invoice dan periode yang sama, percobaan kedua tidak melakukan apa-apa.'] },
      { heading: 'Mengapa isi dokumen tidak dianggap perintah', paragraphs: ['Teks di dalam dokumen, tulisan lengkap rekaman, dan pesan hanya dianggap isi, tidak pernah sebagai perintah. Teks seperti itu tidak bisa memicu tindakan berisiko, karena tindakan itu selalu menunggu persetujuan Anda.'] },
    ],
  },
  security: {
    title: 'Keamanan dan Kendali AI di Orbyte',
    description: 'Cara Orbyte memisahkan data tiap perusahaan, membatasi AI, melindungi kata sandi, dan mencatat setiap perubahan. Mana yang sudah ada dan yang belum.',
    h1: 'Keamanan dan kendali AI',
    answer:
      'Data tiap organisasi dipisahkan di aplikasi dan di basis data, jadi satu organisasi tidak bisa membaca data organisasi lain. AI boleh membaca dan menulis draf, tetapi tidak bisa mengubah pembayaran, harga, atau nominal invoice. Tindakan berisiko perlu persetujuan Anda. Kata sandi disimpan dalam bentuk hash, percobaan masuk dibatasi, dan riwayat perubahan tidak bisa diubah atau dihapus.',
    updated,
    sections: [
      { heading: 'Sudah ada hari ini', bullets: ['Data tiap organisasi dipisahkan di aplikasi, dan dijaga lagi oleh aturan di basis data.', 'Kata sandi disimpan dalam bentuk hash, dan jumlah percobaan masuk dibatasi.', 'Menonaktifkan pengguna langsung mengakhiri semua sesi loginnya.', 'Organisasi selalu punya Pemilik aktif, dijaga oleh basis data.', 'Tabel riwayat menolak diubah, dihapus, atau dikosongkan, langsung di basis data.'] },
      { heading: 'Dirancang dan sedang dikembangkan', bullets: ['Persetujuan Anda untuk setiap tindakan berisiko yang diusulkan AI.', 'Batas biaya AI per hari untuk tiap fitur, dengan setiap pemanggilan model tercatat.', 'Cloudflare Turnstile dan batas pendaftaran baru per hari.'] },
      { heading: 'Yang belum ada', paragraphs: ['Orbyte belum menjalani audit keamanan independen. Kalau Anda menemukan celah keamanan, tulis ke {email}.'] },
    ],
  },
  pricing: {
    title: 'Harga Orbyte (Rencana): Starter, Team, Business',
    description: 'Rencana paket Orbyte: Starter gratis, Team Rp 149.000, Business Rp 289.000 per pengguna per bulan (tahunan). Akses awal gratis, penagihan belum aktif.',
    h1: 'Harga Orbyte (rencana)',
    answer:
      'Orbyte berencana menawarkan Starter (gratis), Team Rp 149.000 per pengguna per bulan dengan tagihan tahunan, Business Rp 289.000, dan Enterprise yang disesuaikan. Penagihan belum aktif, jadi organisasi akses awal tidak dikenai biaya. Harga di bawah baru rencana, disusun dari harga publik pesaing yang dicek pada 28 Oktober 2026, dan masih bisa berubah sebelum penagihan dimulai.',
    updated,
    sections: [
      { heading: 'Bagaimana harga ini ditetapkan', bullets: ['Halaman harga publik Teamwork, Productive, Bonsai, dan Scoro menunjukkan sekitar $9 sampai $29 per pengguna per bulan untuk paket yang sudah termasuk invoice.', 'Teamwork punya paket gratis untuk tim kecil, jadi Orbyte juga merencanakan Starter gratis.', 'Biaya AI dibatasi per hari untuk tiap organisasi, jadi AI bisa ikut masuk di dalam paket.', 'Harga untuk Indonesia ditetapkan dalam Rupiah dan lebih rendah daripada harga USD global.'] },
      { heading: 'Tentang batas paket', paragraphs: ['Batas yang direncanakan, seperti jam rapat dan jumlah gambar, baru akan dipastikan setelah pemakaian nyata diukur dan sebelum penagihan dimulai.'] },
    ],
  },
  compare: {
    title: 'Orbyte vs Alat Proyek dan Penagihan Agensi',
    description: 'Harga publik Teamwork, Productive, Bonsai, dan Scoro, lengkap dengan sumber dan tanggal, serta perbedaan Orbyte: peringatan AI yang menunggu persetujuan Anda.',
    h1: 'Orbyte dibandingkan dengan alat manajemen proyek dan penagihan agensi',
    answer:
      'Teamwork, Productive, Bonsai, dan Scoro menggabungkan proyek, waktu, dan penagihan, dengan harga sekitar $9 sampai $57 per pengguna per bulan. Orbyte berbeda: ia adalah lapisan AI tempat peringatan dan draf menunggu persetujuan Anda. Halaman ini mencantumkan harga publik mereka beserta sumber dan tanggalnya.',
    updated,
    sections: [
      { heading: 'Cara membaca perbandingan ini', paragraphs: ['Harga diambil dari halaman harga publik tiap vendor yang dibaca pada 28 Oktober 2026. Fitur tiap produk berbeda, jadi halaman ini hanya membandingkan harga dan tidak menyebut produk mana yang lebih baik. Cek halaman vendor untuk angka terbaru.'] },
      { heading: 'Fokus Orbyte', bullets: ['Peringatan muncul dari aturan, tidak bergantung pada orang yang ingat untuk memeriksa.', 'Draf AI selalu menunggu persetujuan Anda.', 'Riwayat perubahan mencatat tindakan manusia maupun AI.'] },
    ],
  },
  faq: {
    title: 'FAQ Orbyte: Fitur, Batas AI, Harga, Data',
    description: 'Jawaban langsung tentang apa itu Orbyte, untuk siapa, apa yang bisa dan tidak bisa dilakukan AI-nya, apa yang tersedia hari ini, harga, dan data Anda.',
    h1: 'Pertanyaan yang sering diajukan',
    answer:
      'Jawaban singkat tentang apa itu {brand}, untuk siapa, apa yang bisa dan tidak bisa dilakukan AI-nya, apa yang tersedia hari ini, bagaimana rencana harganya, dan bagaimana data Anda disimpan dan dilindungi. Kalau sesuatu belum tersedia, jawabannya akan bilang begitu.',
    updated,
    faq: [
      { q: 'Apa itu {brand}?', a: '{brand} adalah aplikasi untuk menjalankan agensi dan software house. Klien, langganan, invoice, calon klien, dan tugas ada di satu tempat. AI menandai yang perlu ditangani dan menyiapkan langkah berikutnya, dan Anda menyetujui dulu sebelum tindakan berisiko dijalankan.' },
      { q: 'Untuk siapa?', a: 'Agensi dan software house kecil sampai menengah, sekitar 3 sampai 50 orang, yang sekarang masih menyambung alat proyek, penagihan, dan catatan rapat secara manual.' },
      { q: 'Apakah AI bertindak sendiri?', a: 'Tidak. AI bisa membaca data Anda, menjelaskannya, dan menulis draf. Hal berisiko menunggu persetujuan Anda, dan AI tidak bisa mengubah pembayaran, nominal invoice, atau harga.' },
      { q: 'Model AI apa yang dipakai?', a: '{brand} memakai Meta Model API: Muse Spark untuk menalar dan menulis draf, Muse Voice Transcribe untuk suara, dan Muse Image untuk gambar. Setiap pemanggilan model dicatat dan dibatasi biayanya per hari.' },
      { q: 'Bisakah invoice dikirim ke klien secara otomatis?', a: 'Tidak. Anda menandai invoice sebagai terkirim, mengunduh PDF, atau menyalin pesannya. Pengiriman otomatis ke klien bukan bagian dari produk ini.' },
      { q: 'Apakah data saya terpisah dari organisasi lain?', a: 'Ya. Data tiap organisasi dipisahkan di aplikasi dan dijaga lagi oleh aturan di basis data.' },
      { q: 'Apa yang bisa dipakai hari ini?', a: 'Akses awal sudah dibuka: Anda bisa membuat organisasi dan masuk. Fitur lain masih dikembangkan atau direncanakan, dan statusnya ditampilkan apa adanya di beranda dan halaman fitur.' },
      { q: 'Berapa biayanya?', a: 'Akses awal gratis. Paket yang direncanakan: Starter (gratis), Team Rp 149.000 dan Business Rp 289.000 per pengguna per bulan dengan tagihan tahunan. Penagihan belum aktif. Rinciannya ada di halaman harga.' },
      { q: 'Bisakah saya menghapus data saya?', a: 'Penghapusan akun sendiri belum tersedia. Tulis ke {email}, dan data Anda akan kami hapus.' },
      { q: 'Apakah membuat video atau suara?', a: 'Tidak. Marketing Studio hanya membuat gambar dan teks. Orbyte tidak membuat video atau suara.' },
    ],
  },
  about: {
    title: 'Tentang Orbyte dan Pembuatnya, ASIIFDEV',
    description: 'Orbyte dibuat oleh PT Asiifdev Digital Agency (ASIIFDEV), perusahaan AI engineering dan perangkat lunak di Boyolali, Indonesia, selama hackathon Meta.',
    h1: 'Tentang Orbyte',
    answer:
      'Orbyte dibuat oleh PT Asiifdev Digital Agency (ASIIFDEV), perusahaan AI engineering dan perangkat lunak di Boyolali, Jawa Tengah, yang berdiri pada 2021. Produk ini dikembangkan secara terbuka selama Meta Global AI Developer Hackathon, 26 Oktober sampai 4 November 2026, dengan Meta Model API.',
    updated,
    sections: [
      { heading: 'Mengapa produk ini ada', paragraphs: ['Agensi dan software house biasanya berjalan di atas banyak alat yang terpisah. Invoice telat karena tidak ada yang mengecek, keputusan rapat terlupa, dan AI yang bertindak sendiri sulit dipercaya. Orbyte dibuat sebagai jawabannya: data yang rapi, AI yang menulis draf, dan Anda yang memutuskan.'] },
      { heading: 'Cara dibuat', bullets: ['Astro dan React untuk aplikasi web, PostgreSQL untuk data.', 'Meta Model API untuk model bahasa, suara, dan gambar.', 'Kode sumber terbuka untuk umum, dengan dokumentasi yang ditulis lebih dulu sebelum kodenya.'] },
    ],
  },
  contact: {
    title: 'Hubungi Orbyte',
    description: 'Hubungi tim Orbyte lewat email untuk pertanyaan, masukan akses awal, laporan keamanan, atau permintaan terkait data.',
    h1: 'Kontak',
    answer:
      'Tulis ke {email} untuk pertanyaan, masukan akses awal, laporan keamanan, atau permintaan data seperti penghapusan akun. Kami membalas lewat email dan tidak memakai alamat Anda untuk keperluan lain. Belum ada telepon atau obrolan langsung, dan email Anda tidak dimasukkan ke milis.',
    updated,
  },
  changelog: {
    title: 'Changelog Orbyte',
    description: 'Daftar perubahan Orbyte dari waktu ke waktu, diambil dari berkas changelog di repositori proyek.',
    h1: 'Changelog',
    answer:
      'Daftar perubahan {brand} dari waktu ke waktu, diambil dari berkas changelog proyek, jadi isinya selalu sesuai dengan pekerjaan yang benar-benar dilakukan. Butir di bawah Unreleased sudah dibuat tetapi belum masuk rilis bernomor. Status fitur yang tersedia hari ini ada di beranda.',
    updated,
  },
  privacy: {
    title: 'Privasi dan Praktik Data Orbyte',
    description: 'Data apa yang disimpan atau diproses Orbyte hari ini, di mana, oleh siapa, kuki dan penyimpanan lokal apa yang dipakai, serta apa yang belum tersedia.',
    h1: 'Privasi dan praktik data',
    answer:
      'Halaman ini menjelaskan data yang benar-benar disimpan atau diproses {brand} hari ini, di mana, dan oleh siapa. Isinya dibuat dari daftar yang dijaga tetap sesuai dengan kode lewat tes otomatis. Halaman ini juga menyebut apa yang belum tersedia, seperti penghapusan akun sendiri. Ini penjelasan praktik, bukan nasihat hukum.',
    updated,
  },
  terms: {
    title: 'Syarat Penggunaan Orbyte (Akses Awal)',
    description: 'Syarat dalam bahasa sederhana untuk layanan akses awal Orbyte: pakai dengan data yang tidak sensitif, perubahan bisa terjadi, dan hasil AI adalah draf.',
    h1: 'Syarat penggunaan (akses awal)',
    answer:
      'Orbyte masih dalam akses awal. Pakai dengan data demo atau data yang tidak sensitif, siap-siap menghadapi perubahan dan gangguan, dan jangan jadikan satu-satunya catatan invoice atau pembayaran Anda dulu. Syarat ini menjelaskan layanan saat ini dengan bahasa sederhana dan bukan pengganti nasihat hukum profesional.',
    updated,
    sections: [
      { heading: 'Menggunakan layanan', bullets: ['Anda bertanggung jawab atas data yang Anda masukkan dan atas kerahasiaan kata sandi Anda.', 'Jangan memakai layanan untuk hal yang melanggar hukum, atau untuk menyerang layanan maupun pengguna lain.', 'Hasil AI adalah draf. Anda yang bertanggung jawab memeriksanya sebelum dipakai.'] },
      { heading: 'Batas akses awal', bullets: ['Layanan diberikan apa adanya, tanpa jaminan, dan bisa berubah atau berhenti.', 'Fitur yang ditandai sedang dikembangkan atau direncanakan mungkin belum berfungsi, atau belum ada.', 'Kami bisa menangguhkan akun yang menyalahgunakan layanan, misalnya membuat banyak akun demi memakai kuota AI.'] },
      { heading: 'Kontak', paragraphs: ['Pertanyaan tentang syarat ini: {email}.'] },
    ],
  },
};
