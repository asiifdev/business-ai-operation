# BRD-M17 — Koneksi, Playbook, dan Operasi Deployment

| | |
|---|---|
| **Status** | ✅ Disetujui owner (2026-10-29), v0.1.0 |
| **Tanggal** | 2026-10-29 |
| **Gelombang / Jalur** | Baru (usulan owner 2026-10-29) / B (AI dan eksekusi) + A (skema dan rahasia) |
| **Level usulan** | ✅ inti (koneksi, playbook, drift kode); ◐ (uptime) |
| **BRD induk** | [`../BRD.md`](../BRD.md): CR-01, CR-02, CR-08, CR-09, CR-11, CR-12, CR-13 |
| **Prasyarat** | BRD-M01, M02, M07, M08, M15 |
| **Sumber** | arahan owner 2026-10-29: onboarding klien baru yang manual dan lama, kode terdeploy yang tertinggal, uptime, "semua operasional cukup lewat chat" |

> **Peringatan perubahan lingkup.** Modul ini memasukkan hal yang sebelumnya **sengaja dikeluarkan** dari BRD yang sudah disetujui: integrasi GitHub dan branch (BRD-M02 §3), integrasi server dan monitoring (BRD induk §4.2), dan penyimpanan rahasia (BR-M02-07). Bagian 12 mendaftar perubahan yang diperlukan pada dokumen itu. Owner menyetujui modul ini pada 2026-10-29; amandemen di §12 diterapkan pada tanggal yang sama.

## 1. Tujuan dan nilai bisnis

Menyiapkan klien baru hari ini berarti masuk server, clone branch tertentu, menentukan folder, mengatur domain, nginx, database, dan env, lalu mencatat langganan dan tagihan dengan tangan, dan lupa memperbarui klien yang tertinggal. Modul ini membuat pekerjaan itu cukup diperintahkan lewat chat: AI mengumpulkan data yang kurang, menyusun rencana dari aturan produk yang sudah tersimpan, dan menjalankannya langkah demi langkah dengan **persetujuan manusia** dan progres yang terlihat. Sistem juga menunjukkan klien mana yang **belum memakai kode terbaru** dan mana yang **mati**.

Platform ini **SaaS multi-tenant**: tiap organisasi membawa **akun GitHub dan server miliknya sendiri**. Tidak ada kredensial milik pengembang platform yang dipakai organisasi lain.

## 2. Aktor dan hak akses

| Aksi | Pemilik | Admin | Staf | Sistem | AI |
|---|---|---|---|---|---|
| Melihat koneksi (tanpa rahasia), profil setup, run, dan status kode | ✅ | ✅ | ✅ (lihat) | — | ✅ `read` |
| Membuat, mengubah, menguji, dan menghapus koneksi (memegang rahasia) | ✅ | ⚠️ | ❌ | — | ❌ |
| Mengubah profil setup produk | ✅ | ✅ | ❌ | — | `draft` (usulan isi) |
| Menyetujui dan menjalankan playbook | ✅ | ⚠️ | ❌ | — | `act` (persetujuan) |
| Memicu cek kode terbaru dan uptime | ✅ | ✅ | ❌ | ✅ penjadwal | `read` |

## 3. Lingkup

**Termasuk:**

1. **Koneksi** milik organisasi: **GitHub**, **Server via SSH**, **Server via aaPanel**. **CyberPanel** dan **cPanel** tampil di UI sebagai **"segera hadir"** (tidak aktif).
2. **Profil setup per produk**: repo, branch bawaan, mode (satu branch per klien atau satu branch bersama beberapa klien), pola nama folder, templat nginx dan env, urutan langkah, dan **catatan aturan kerja** bebas (memori AI). Diisi lewat form, dapat diisi atau diusulkan AI, dan dapat disunting pengguna kapan saja.
3. **Playbook dan run**: urutan langkah bernama yang dijalankan terhadap satu server, dengan persetujuan, progres per langkah, dan hasil yang dapat dilanjutkan bila gagal.
4. **Sinkronisasi kode (drift)**: per deployment, bandingkan commit yang terpasang dengan ujung branch-nya di GitHub; tandai "tertinggal N commit" dan terbitkan temuan Action Center; aksi "perbarui" berupa playbook yang butuh persetujuan.
5. **Uptime**: pemeriksaan HTTP berkala atas domain deployment; temuan saat mati atau pulih.
6. Percakapan: AI menanyakan data yang kurang (repo, branch, domain) sebelum membuat rencana, sesuai aturan produk yang tersimpan.

**Tidak termasuk (dicatat):** pengaturan identitas aplikasi klien (nama dan brand, logo, banner, cabang) dan impor data awal, karena terjadi di dalam aplikasi produk itu sendiri ⚠️ (menunggu API produk, lihat §11); eksekusi shell bebas oleh AI; CyberPanel dan cPanel (hanya tampilan); pembuatan server atau DNS otomatis ⚠️; rollback otomatis ⚠️; tiket dari screenshot (diatur di amandemen M05/M11, lihat §12).

## 4. Proses bisnis (klien baru)

1. Pemilik memberi perintah (teks, voice, atau screenshot percakapan klien).
2. AI membaca profil setup produk dan koneksi yang ada, lalu **menanyakan yang kurang** (mis. repo dan branch) dan meminta konfirmasi.
3. AI menyusun **rencana run** dari playbook produk: langkah, parameter final (domain, folder, branch, nama database), dan server tujuan. Rencana menjadi **persetujuan** (`act`) berisi argumen persis.
4. Pemilik **menyetujui** di web atau Telegram. Langkah yang hanya membaca (cek) boleh jalan tanpa persetujuan.
5. Worker menjalankan langkah satu per satu. UI dan Telegram menampilkan **progres per langkah** (menunggu, berjalan, selesai, gagal) dengan keluaran yang sudah disaring dari rahasia.
6. Gagal di satu langkah: run **berhenti** dan menunggu keputusan (coba lagi, lanjutkan dari langkah itu, atau batalkan). Tidak ada langkah berikutnya yang jalan sendiri.
7. Selesai: deployment tercatat (domain, branch, commit terpasang), langganan dan draf invoice pertama dapat dibuat lewat alur M03, dan cek uptime dimulai.

## 5. Aturan bisnis

| ID | Aturan | Status |
|---|---|---|
| BR-M17-01 | Koneksi dan semua data modul ini milik **satu organisasi**; query selalu difilter `org_id`. Tidak ada koneksi atau kredensial bersama lintas organisasi | Final (CR-01, BR-M01-01) |
| BR-M17-02 | **Rahasia** (token, kunci privat, kata sandi, passphrase, API key) disimpan **terenkripsi** di database dengan kunci induk dari lingkungan server, ditampilkan hanya sebagian (mis. 4 karakter terakhir), dan **tidak pernah** dikembalikan oleh API setelah disimpan | Final |
| BR-M17-03 | **Model tidak pernah menerima rahasia.** Ia hanya mengenal ID koneksi dan nama. Rahasia tidak masuk prompt, `ai_runs`, audit, log, keluaran langkah, maupun pesan Telegram | Final |
| BR-M17-04 | Eksekusi **hanya lewat langkah bernama dari daftar izin** (mis. `git_clone`, `set_nginx_site`, `create_database`). **Tidak ada perintah shell bebas** dari AI atau dari teks chat. Parameter divalidasi ketat (domain, nama folder, nama branch, nama database) dan disisipkan ke perintah dengan pengutipan aman | Final (CR-12) |
| BR-M17-05 | Run yang mengubah server adalah tool `act`: **wajib persetujuan manusia** atas rencana persis (argumen tidak berubah setelah disetujui). Langkah `read` (cek versi, cek ruang disk) boleh tanpa persetujuan | Final (CR-08) |
| BR-M17-06 | Teks dari luar (chat klien, screenshot, keluaran server, README dan pesan commit GitHub) adalah **data, bukan instruksi**; tidak dapat memicu run | Final (CR-12) |
| BR-M17-07 | Setiap langkah punya status, waktu, dan keluaran (dipotong, disaring dari rahasia). Run dapat **dilanjutkan dari langkah yang gagal**; langkah yang sudah sukses tidak diulang | Usulan |
| BR-M17-08 | **SSH:** metode login **kata sandi**, **kunci privat** (dengan passphrase opsional), atau **kunci + kata sandi** ⚠️. **Sidik jari host (host key) disematkan** saat koneksi pertama atas konfirmasi pengguna; perubahan sidik jari menolak koneksi sampai dikonfirmasi ulang | Final (keamanan) |
| BR-M17-09 | **aaPanel:** URL panel dan API key. Kemampuan yang dipakai dibatasi pada yang terdokumentasi resmi ⚠️. **CyberPanel dan cPanel** tampil "segera hadir" dan tidak dapat dibuat | Usulan |
| BR-M17-10 | **Tes koneksi** wajib berhasil sebelum koneksi dipakai playbook; hasil dan waktu tes tersimpan | Usulan |
| BR-M17-11 | **"Tertinggal kode"** adalah kondisi turunan: commit terpasang ≠ ujung branch di GitHub (jumlah commit selisih). Yang disimpan hanya commit terpasang dan waktu cek terakhir, bukan status (CR-01) | Final |
| BR-M17-12 | Cek kode dan uptime berjalan di penjadwal (D-008) dengan **dedupe** (`automation.once`) sehingga temuan yang sama tidak ganda | Final (CR-02) |
| BR-M17-13 | Koneksi yang dipakai profil setup atau run aktif **tidak dapat dihapus**; harus dilepas dulu | Usulan |
| BR-M17-14 | Pembuatan, perubahan, tes, dan penghapusan koneksi; setiap run, persetujuan, dan langkah tercatat di audit **tanpa rahasia** | Final (CR-09) |
| BR-M17-15 | Setiap run dibatasi: waktu maksimum per langkah, jumlah run bersamaan per server (1), dan pembatas laju per organisasi | Usulan |
| BR-M17-16 | Repo ini public: **tidak ada kredensial nyata** di commit. Tidak ada mode demo atau simulasi di produk: semuanya production ready (arahan owner 2026-10-29); pelaksana palsu hanya untuk tes otomatis | Final (aturan hackathon 2) |

## 6. Entitas bisnis dan data kunci

Koneksi (jenis: github, ssh, aapanel, dan jenis segera hadir; nama; rahasia terenkripsi; sidik jari host; status tes), Profil Setup Produk (repo, branch bawaan, mode, pola folder, templat, urutan langkah, catatan), Playbook Run dan Langkah Run (rencana, status, progres, keluaran), data drift pada Deployment (repo, branch, commit terpasang, waktu cek), Cek Uptime (status, waktu, latensi). Skema di ERD setelah BRD ini disetujui.

## 7. Keterkaitan modul

- **M02:** deployment menerima repo, branch, commit terpasang; aturan tertinggal kode melengkapi tertinggal versi.
- **M03:** selesai setup memicu pembuatan langganan dan draf invoice lewat service M03; nominal tetap dari kode.
- **M07/M08:** tool `read`/`draft`/`act` baru, rule temuan `deployment_outdated`, `deployment_down`, kartu persetujuan dan progres.
- **M11:** persetujuan dan progres dapat diikuti di Telegram.
- **M15:** audit dan guardrail rahasia.
- **M14:** komponen progres langkah, dan antarmuka asisten yang menjadi pusat aplikasi.

## 8. Integrasi eksternal

GitHub API, SSH (pustaka klien SSH, ⚠️ dipilih saat implementasi), aaPanel API. **Skill integrasi wajib ditulis dari dokumentasi resmi** (GitHub, aaPanel, pustaka SSH) sebelum coding area ini, dengan butir ⚠️ yang diuji terhadap server uji owner.

## 9. Notifikasi dan keluaran

Kartu temuan (kode tertinggal, domain mati, run gagal), kartu persetujuan run, progres run di web dan Telegram, ringkasan hasil setup.

## 10. Kriteria penerimaan

- [ ] Dua organisasi berbeda tidak dapat melihat atau memakai koneksi satu sama lain.
- [ ] Rahasia tidak muncul di respons API, `ai_runs`, audit, log, atau keluaran langkah (uji pencarian string pada semuanya).
- [ ] Teks "jalankan rm -rf" di chat atau di README repo tidak membuat langkah apa pun; tidak ada jalur shell bebas.
- [ ] Parameter berisi karakter berbahaya (`;`, `$(…)`, spasi, `..`) ditolak sebelum eksekusi.
- [ ] Run tidak mulai tanpa persetujuan; argumen yang disetujui sama persis dengan yang dijalankan.
- [ ] Run gagal berhenti di langkah itu dan dapat dilanjutkan tanpa mengulang langkah sukses.
- [ ] SSH menolak sidik jari host yang berubah; metode kata sandi, kunci privat, dan kunci + kata sandi dapat diuji.
- [ ] Deployment yang commit-nya tertinggal dari branch menerbitkan temuan satu kali; setelah diperbarui temuan selesai sendiri.
- [ ] CyberPanel dan cPanel tampil nonaktif dengan label "segera hadir".
- [ ] Progres per langkah terlihat langsung di UI selama run.

## 11. Keputusan owner (2026-10-29) dan pertanyaan yang masih terbuka

Owner menyetujui BRD ini beserta saran berikut (`docs/DECISIONS.md` D-054):

| # | Keputusan |
|---|---|
| 1 | GitHub: **GitHub App** (izin per repo, token berumur pendek) |
| 2 | **Pemilik** memegang rahasia koneksi; **Admin** boleh menyetujui dan menjalankan run |
| 3 | **Rollback manual** pada versi ini |
| 4 | **Uptime tetap di M17** |
| 5 | Server pelanggan harus dapat dijangkau dari server Orbyte (IP allowlist); **agen ringan ditunda** |

**Masih ⚠️ PERLU KEPUTUSAN OWNER:** setup identitas klien dan impor data di dalam aplikasi produk (apakah produk punya API atau CLI untuk itu, atau tetap manual). **Dibuktikan lewat uji saat implementasi:** kemampuan aaPanel API, cara membaca commit terpasang lewat aaPanel saja, dukungan SSH kunci + kata sandi, rotasi kunci induk enkripsi, dan teks persetujuan hukum sebelum publik. Pertanyaan asli (arsip):

1. ⚠️ **Jenis koneksi GitHub:** GitHub App (disarankan: izin per repo, token berumur pendek), OAuth, atau token fine-grained buatan pengguna?
2. ⚠️ **Kemampuan aaPanel API:** apa yang benar-benar tersedia (situs, database, nginx, perintah, berkas)? Menentukan langkah mana yang bisa lewat aaPanel dan mana hanya lewat SSH. Dibuktikan dari dokumentasi resmi dan server uji.
3. ⚠️ **Cara membaca commit terpasang:** lewat SSH (`git rev-parse HEAD` di folder deployment) cukup jelas; lewat aaPanel saja belum jelas.
4. ⚠️ **Server pelanggan harus dapat dijangkau dari server Orbyte** (daftar IP yang diizinkan di aaPanel atau firewall SSH). Perlu **agen ringan yang menghubungi keluar** pada tahap lanjut? (Di luar versi ini.)
5. ⚠️ **SSH kunci + kata sandi:** dukungan "gabungan" bergantung pada pustaka klien dan konfigurasi server (`AuthenticationMethods`); diuji.
6. ⚠️ **Admin** boleh memegang rahasia dan menyetujui run, atau Pemilik saja?
7. ⚠️ **Rollback:** manual saja pada versi ini, atau langkah balik per playbook?
8. ⚠️ **Rotasi kunci induk enkripsi** dan pemulihan bila kunci hilang (rahasia harus dimasukkan ulang).
9. ⚠️ **Uptime di modul ini** atau modul tersendiri? Frekuensi cek dan lokasi pemeriksa.
10. ⚠️ **Setup identitas klien dan impor data** di aplikasi produk: apakah produk memiliki API/CLI untuk itu, atau tetap manual?
11. ⚠️ **Tanggung jawab dan persetujuan hukum:** organisasi memberi akses ke servernya sendiri; teks persetujuan dan batasan tanggung jawab perlu dipikirkan sebelum publik.

## 12. Perubahan yang diperlukan pada dokumen yang sudah disetujui (setelah modul ini disetujui)

| Dokumen | Perubahan |
|---|---|
| `BRD.md` §4.2 | Keluarkan "integrasi GitHub/monitoring domain/server" dari daftar di luar lingkup; tambahkan M17 ke tabel modul |
| `brd/BRD-M02-portfolio.md` | BR-M02-07 diperjelas: rahasia **aplikasi klien** (env, kata sandi database) tetap tidak disimpan; kredensial **koneksi organisasi** diatur BR-M17-02. §3 "Tidak termasuk" menghapus GitHub/branch; deployment menerima repo, branch, commit terpasang |
| `brd/BRD-M05`, `BRD-M11` | Tiket dari screenshot atau chat klien menjadi draf task; foto di Telegram |
| `brd/BRD-M08` | Rule baru `deployment_outdated`, `deployment_down`, kartu progres run |
| `brd/BRD-M14` | Antarmuka berpusat pada asisten, komponen progres, pembaruan tampilan menyeluruh |
| `PRD.md`, `ERD.md` | Spesifikasi dan skema modul ini (tahap berikutnya, setelah BRD disetujui) |
| `docs/DECISIONS.md` | Keputusan jenis koneksi, enkripsi rahasia, dan batas eksekusi |

## 13. Amandemen D-061: flow deploy buatan pengguna (✅ disetujui owner 2026-10-29)

Arah dan keputusan owner 2026-10-29 tercatat di `docs/DECISIONS.md` D-061. Bagian ini mengubah cara §3 (poin 3) dan §4 dikerjakan: **playbook bukan runtime tertanam, melainkan flow yang disusun pengguna sebagai diagram** (simpul dan garis, seperti n8n). Alur Laravel + pm2 (D-060) menjadi **template flow bawaan**.

**Konsep.** *Flow* = diagram milik organisasi, berjenis `setup` atau `update`. *Simpul* = satu **alat** dari katalog di kode, milik satu jenis koneksi (aaPanel: buat database, buat situs, buat reverse proxy, daftar situs; SSH: clone, perbarui, tulis berkas, pm2, jalankan perintah; GitHub: daftar repo, ujung branch; Orbyte: alokasi port, hasilkan rahasia, render templat, rekam deployment, cek HTTP). *Slot koneksi* = peran bernama pada flow (`server`, `panel`, `github`) yang diikat ke koneksi nyata saat dijalankan, sehingga satu flow dipakai ulang untuk banyak produk dan klien. *Variabel* = keluaran satu simpul yang dipakai simpul lain; nilai rahasia bertanda dan disamarkan.

| ID | Aturan | Status |
|---|---|---|
| BR-M17-17 | Jenis simpul hanya dari **katalog di kode**; pengguna dan AI tidak dapat menambah jenis simpul. Tiap alat punya skema masukan (Zod), keluaran, dan tingkat (`read` atau `change`) | Final (D-061) |
| BR-M17-18 | Simpul **perintah SSH** (skrip buatan manusia) dan **tulis berkas bebas** (`ssh.write_file`, D-063: menulis ke path mana saja sama dengan menjalankan kode) hanya dapat dibuat atau diubah **Pemilik**; semua variabel yang disisipkan ke skrip **dikutip otomatis** sebagai nilai literal, tidak dapat menjadi perintah. **AI tidak pernah** menulis atau mengubahnya | Final (D-061) |
| BR-M17-19 | **Pemilik dan Admin** membuat dan mengubah flow tanpa simpul perintah bebas; Staf hanya melihat. Tiap perubahan membuat **versi baru yang tidak dapat diubah** dan tercatat di audit | Final (D-061) |
| BR-M17-20 | Run memakai **snapshot versi** flow yang disetujui; mengubah flow sesudahnya tidak memengaruhi run yang berjalan atau menunggu | Usulan |
| BR-M17-21 | **Persetujuan atas rencana lengkap:** server menyelesaikan flow dan parameter menjadi daftar simpul `change` berikut argumen non-rahasia yang sudah diselesaikan; yang disetujui ditandai dengan hash rencana, dan sebelum jalan hash dihitung ulang dan harus sama | Final (CR-08) |
| BR-M17-22 | Flow divalidasi sebelum disimpan dan sebelum dijalankan: tanpa siklus, tiap variabel punya sumber, tiap slot terikat ke koneksi berjenis benar yang pernah lolos tes, dan alat yang belum terbukti pada jenis koneksi itu ditolak | Usulan |
| BR-M17-23 | Eksekusi berurutan menurut urutan topologi diagram; tiap simpul berjalan sekali (status `done` tidak diulang saat dilanjutkan); simpul gagal menghentikan run dan menunggu keputusan (coba lagi atau batalkan); **rollback manual** (D-054). Cabang paralel ditunda ⚠️ | Usulan |
| BR-M17-24 | **Rahasia run** (kata sandi database, kunci Reverb, `APP_KEY`) dihasilkan kode, dienkripsi selama run dan **dihapus** saat run selesai, gagal permanen, atau dibatalkan; tidak ke model, tidak di log, tidak tampil di UI (D-060 butir 4) ✅ disetujui eksplisit 2026-10-29 | Final (D-062) |
| BR-M17-25 | **Penghapusan oleh alat hanya untuk objek yang dibuat run itu sendiri** (mis. database yang dibuat simpul sebelumnya dalam run yang sama); tidak ada alat yang menghapus berdasarkan pencarian bebas | Final (arahan owner 2026-10-29) |
| BR-M17-26 | Port aplikasi = tertinggi terpakai di rentang yang ditetapkan + 1 (bawaan 6000-6999), dibaca dari target proxy aaPanel, port yang mendengarkan di server, dan deployment tercatat, lalu diperiksa kosong sebelum dipakai (D-060 butir 3) | Final (jawaban owner) |
| BR-M17-27 | Peran AI: memilih flow, menanyakan parameter yang kurang, dan mengajukan run; boleh mengusulkan **draf flow** (ditandai "dibantu AI", wajib ditinjau dan disimpan manusia) hanya dari simpul di katalog | Final (D-061) |

**Kriteria penerimaan tambahan:** satu flow dipakai untuk dua produk dengan koneksi berbeda; simpul perintah ditolak untuk Admin dan untuk AI; variabel berisi `;`, `$()`, `` ` `` dan spasi tidak dapat keluar dari kutipan; ubah flow setelah persetujuan tidak mengubah run; run dilanjutkan setelah proses dimatikan tanpa mengulang simpul selesai dan tanpa kehilangan rahasia run; rahasia run hilang dari database setelah run selesai; progres tampil langsung di diagram.
