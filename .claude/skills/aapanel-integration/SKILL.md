---
name: aapanel-integration
description: Koneksi server lewat aaPanel API (M17), salah satu opsi koneksi yang berdiri sendiri. Baca sebelum menulis kode pelaksana aaPanel, tes koneksi, atau langkah playbook yang memakai panel.
---

# aaPanel API: panduan integrasi (M17)

Sumber: dokumentasi resmi `aapanel.com/docs/api/api-list.html` dibaca **2026-10-29** (sebagian halaman, mis. `databases-mysql.html`, dan `Document/api.pdf` tidak dapat dibaca isinya oleh alat baca; halaman API resmi sendiri menyebut PDF itu "belum selesai"). **Banyak hal tidak terdokumentasi di sini dan ditandai ⚠️: jangan mengandalkannya sebelum diuji terhadap panel uji owner.**

## 1. Bentuk integrasi di proyek ini

- aaPanel adalah **opsi koneksi server yang berdiri sendiri** (D-055); bukan cadangan SSH dan tidak bergantung padanya. Koneksi menyimpan `config.url` (alamat dan port panel) dan rahasia API key terenkripsi (BR-M17-02). Kode: `src/integrations/aapanel/` di balik `ServerRunner`.
- Langkah playbook yang tidak terbukti didukung aaPanel **ditolak saat rencana dibuat**, bukan gagal di tengah jalan (PRD M17).

## 2. Autentikasi (terdokumentasi)

- Aktifkan di panel: **Settings → API → Modify**, simpan **API secret key**, dan isi **IP whitelist** dengan IP server pemanggil. "Access will be denied" bila IP salah. Artinya **IP server Orbyte harus didaftarkan pemilik panel** (D-054 butir 5).
- Tiap permintaan membawa dua parameter: `request_time` (timestamp Unix saat ini) dan `request_token = md5(request_time + md5(api_sk))`. Keduanya harus dari timestamp yang sama.
- Base URL: `{alamat_panel}:{port_panel}/<path>`. Port bawaan tidak disebut dokumen ⚠️ (tiap panel berbeda).
- Sumber tidak resmi (forum, pustaka komunitas) melaporkan: token atau waktu salah dijawab **404**; permintaan umumnya `POST` `application/x-www-form-urlencoded`; panel versi 2 memakai awalan `/v2/`. Dokumen resmi memakai contoh string kueri. ⚠️ Diuji sebelum dipakai.

## 3. Catatan dari halaman resmi (dibaca ulang 2026-10-29)

- Halaman API resmi menyatakan **antarmuka yang sama dipakai oleh front end browser panel**, sehingga parameter permintaan di panel (DevTools → Network → Fetch/XHR) dapat dijadikan petunjuk untuk integrasi pihak ketiga. Artinya banyak endpoint **ada tetapi tidak terdokumentasi resmi**: boleh dipakai hanya setelah diamati dan diuji di panel uji owner, dan dicatat di skill ini per versi panel.
- Sumber resmi lain: PDF `Document/api.pdf` (ditandai belum selesai) dan contoh PHP/Python (`/docs/api_demo/api_demo_php.zip`, `api_demo_python.zip`). **Contoh PHP (`demo.php`, versi asli panel Baota, 2018) sudah dibaca** (2026-10-29) dan menegaskan klien kita: `request_token = md5(request_time . md5(api_key))`, kedua nilai dikirim sebagai **field POST** bersama parameter lain, ke `/data?action=getData` (v1) dengan `table`, `limit`; sertifikat tidak diverifikasi (di Orbyte hanya bila pemilik memilih `tlsInsecure`). Ia memakai **cookie jar** antarpermintaan; klien kita tidak memakainya dan permintaan baca berhasil, tetapi ⚠️ operasi tulis tertentu mungkin memerlukan sesi: dicek saat diuji. Kunci dan alamat dalam contoh itu hanyalah contoh dan tidak dipakai.
- Daftar API resmi hanya memuat dua halaman: **Website - PHP Project** dan **Databases - MySQL**. Tidak ada halaman resmi untuk perintah shell, git, nginx, atau berkas.

### Utas forum resmi (dibaca lewat browser 2026-10-29: `forum/d/482-api-interface-tutorial`)

Isi utas = pernyataan staf aaPanel (resmi) dan pertanyaan pengguna (tidak resmi, hanya petunjuk):
- **Staf (Post #3):** "All functions of the panel can be managed via api". **Staf (Post #9):** dokumen yang lebih dalam **belum ada** ("we have not yet prepared a more in-depth document"). Jadi daftar endpoint lengkap memang tidak ada secara resmi; sumber kebenaran adalah panel itu sendiri.
- **Staf (Post #13): respons sebagian metode dienkripsi AES, dan enkripsi itu tidak berlaku setelah *developer mode* panel diaktifkan.** ⚠️ Metode yang kita coba (`/data?action=getData`, `/system?action=GetSystemTotal`, `/files?action=GetDir`) menjawab teks terang; tetapi endpoint lain dapat menjawab terenkripsi. Klien harus menganggap respons yang tidak terbaca sebagai "tak terduga", tidak menebak, dan tidak meminta pemilik mengaktifkan developer mode tanpa memahami akibatnya.
- Pengguna (Post #35): galat penolakan diselesaikan dengan **mendaftarkan IP** di whitelist, sama dengan temuan kita.
- Pengguna melaporkan galat 404/`null` bila IP, kunci, atau waktu salah, dan menanyakan (tanpa jawaban resmi) cara memasang aplikasi, mengatur reverse proxy, dan memblokir IP lewat API.
- Ada pustaka komunitas pihak ketiga (mis. `skolastikarhea/api_aapanel`, `mdestafadilah/AAPanel-API`). **Hanya petunjuk nama endpoint**: tidak resmi, tidak disalin (aturan hackathon 1), dan tiap endpoint harus diuji sendiri di panel uji sebelum dipakai; operasi tulis diuji hanya dengan izin eksplisit pemilik.

## 4. Endpoint terdokumentasi (sangat terbatas)

| Fungsi | Path |
|---|---|
| Config | `/config?action=get_token` |
| Query data | `/v2/data?action=getData` dengan `p`, `limit`, `table`, `search`, `order`, `type` (contoh `table=sites`) |

Halaman terpisah dirujuk untuk **PHP Project API** (`website-php.html`) dan **MySQL API** (`databases-mysql.html`), tetapi isinya tidak terbaca di sesi ini ⚠️.

## 4a. Terbukti pada panel nyata (2026-10-29, aaPanel `https://103.127.96.158:7800`)

- Permintaan bertanda tangan (POST form maupun GET dengan `request_time`/`request_token` di query) dijawab **HTTP 200** dengan JSON `{status: false, msg: "..."}` bila ditolak, **bukan 404**. Jadi penolakan harus dibaca dari `status === false`.
- Pesan penolakan IP: `IP validation failed, your access IP is[x.x.x.x]`: panel menyebut IP yang dilihatnya, yang dapat langsung didaftarkan di whitelist. Orbyte menampilkan pesan panel itu di UI.
- Panel memakai sertifikat self-signed; koneksi memerlukan opsi `tlsInsecure` yang dipilih pemilik secara eksplisit.
- **Setelah IP didaftarkan, tes sukses (2026-10-29).** Respons sukses nyata: v2 `{status: 0, timestamp, message: <data>}`; v1 mengembalikan datanya langsung (`{where, page, data, search_history, ...}`). Kunci salah (kedua jalur): `{status: false, msg: "Secret key verification failed"}`, jadi kunci dan tanda tangan terbukti diverifikasi panel, bukan hanya IP. Keberhasilan dikenali dari tanda positif (`status === 0` + `message`, atau `data` berupa larik), bukan dari ketiadaan penolakan.
- **Endpoint baca-saja yang teramati menjawab pada panel ini** (hanya bentuk respons diperiksa): `/data?action=getData` (`table=sites` dan `table=databases`, v1 dan v2), `/system?action=GetSystemTotal` (v1; v2 menjawab amplop lain), `/config?action=get_config` (v1), `/files?action=GetDir` (v1; parameter `path`, `p`, `showRow`). `/database?action=GetSqlServer` menjawab "Specific parameters are invalid!" (parameter belum diketahui).
- **⚠️ Peringatan keamanan:** `/config?action=get_config` mengembalikan kunci `mysql_root` (kata sandi root MySQL panel) dan data sensitif lain kepada pemegang API key. Orbyte **tidak boleh memanggil, menyimpan, atau mencatat** respons itu; respons panel apa pun disaring sebelum disimpan (BR-M17-03) dan hanya endpoint dari daftar izin yang dipakai.

## 4b. Peta endpoint dari antarmuka panel (aaPanel 8.0.7, diamati 2026-10-29 lewat Claude in Chrome)

Cara: halaman panel dibuka dengan sesi pemilik, permintaan XHR yang dikirim antarmukanya dicatat (hanya jalur, nama `action`, dan nama parameter; tidak ada nilai, domain, atau token), lalu berkas JavaScript antarmuka dibaca untuk nama endpoint tulis. **Tidak ada operasi tulis yang dijalankan.** Antarmuka memakai sesi dan awalan jalur masuk (`/apsess_…`); Orbyte memakai API key tanpa awalan itu. Semua amplop v2: `{status: 0, timestamp, message}`.

**Endpoint BACA, teramati dari antarmuka dan sudah diuji dengan API key (semua menjawab `status: 0`):**

| Fungsi | Jalur dan parameter form |
|---|---|
| Daftar situs (PHP dan lainnya) | `/v2/data?action=getData` · `p`, `limit`, `table=sites`, `search`, `order`, `type=-1`, `re_order` |
| Daftar database | `/v2/data?action=getData` · `table=databases`, `p`, `limit`, `search` |
| Daftar proyek proxy (reverse proxy) | `/v2/mod/proxy/com/get_list` · `p`, `limit`, `search`, `re_order` (respons dalam: `{code, status, msg, data, timestamp}`) |
| Jenis situs | `/v2/site?action=get_site_types` |
| Daftar folder | `/v2/files?action=GetDirNew` · `path`, `is_operating`, `p`, `showRow`, `disk` |
| Status layanan | `/v2/panel/public/get_soft_status` · `name=nginx` atau `mysql` |
| Server database (cloud/lokal) | `/v2/database?action=GetCloudServer` · `type=mysql` |
| Antrean tugas | `/v2/task?action=get_task_lists` · `status=-3` |

Teramati tetapi belum diuji dengan API key: `/v2/data?action=getSiteThirtyTotal` (`site_type`, `start_date`, `end_date`), `/v2/ssl_domain?action=ssl_tasks_status`, `/v2/crontab?action=get_auto_config` (`name`), `/v2/plugin?action=get_soft_find` (`sName`), `/v2/files?action=get_files_store`. `submit_module_logs` dan `get_public_config*` adalah telemetri dan konfigurasi antarmuka: **tidak dipakai**.

**Endpoint TULIS: hanya nama yang ditemukan di kode antarmuka; parameter, respons, dan perilaku BELUM diamati dan tidak boleh dipakai sebelum diuji dengan izin pemilik:**
`/site?action=AddSite`, `/site?action=DeleteSite`, `/site?action=AddDomain`, `/site?action=add_site_type`, `/database?action=AddDatabase` (dan bentuk baru `/database/<tipe>/AddDatabase`), `/mod/proxy/com/add_proxy`, `/project/nodejs/create_project`, `/btdocker/proxy/create_proxy`, `/business_ssl?action=apply_cert_order_pay` (berbayar: **jangan dipakai**). Modul proxy juga punya `create_by_supervisor`, `proxy_bind_by_supervisor`, `action_by_supervisor`.

## 4c. Operasi TULIS terbukti (2026-10-29, atas izin pemilik, hanya pada item uji `orbyte_probe_*` buatan sendiri)

Dijalankan dua kali: lewat antarmuka (sesi, parameter ditangkap) lalu lewat **API key** (jalur Orbyte). Semua item uji sudah dihapus dan diverifikasi (0 tersisa). Respons sukses tulis: `{status: 0, timestamp, message: {result: ...}}` (HTTP 200).

| Operasi | Jalur (form POST) | Parameter teramati |
|---|---|---|
| **Buat database** | `/v2/database?action=AddDatabase` | `sid=0`, `name`, `codeing=utf8mb4`, `db_user`, `password`, `dataAccess=127.0.0.1`, `address=127.0.0.1`, `active=false`, `ssl=""`, `ps` (catatan), `dtype=MySQL` |
| **Hapus database** | `/v2/database?action=DeleteDatabase` | `name`, `id` (id dari `getData` `table=databases`; antarmuka memanggil `check_del_data` `ids=[id]` lebih dulu dan meminta frasa konfirmasi di UI saja) |
| **Buat reverse proxy** | `/v2/mod/proxy/com/create` | `domains`, `proxy_type=true`, `url`, `unx=""`, `proxy_host=$http_host`, `remark`, `keepuri=1`, `rewrite[0][key]=""`, `rewrite[0][value]=""`, `proxy_pass` (= `url`), `rewritedir=[]` |
| **Hapus reverse proxy** | `/v2/mod/proxy/com/delete` | `id`, `site_name` (domain), `remove_path=0` (1 juga menghapus folder root: **jangan**) |

Bentuk daftar proxy: `/v2/mod/proxy/com/get_list` → `message = {code, status, msg, data: {data: [baris], page}, timestamp}`; baris: `id, name (domain), path, status, ps (catatan), addtime, edate, re_total, healthy, conf_path, ssl, proxy_pass, source_binding, waf`. Daftar situs/database: `message = {where, page, data: [baris], ...}`.

Aturan pemakaian di Orbyte (keamanan):
- **Hanya hapus yang Orbyte buat sendiri**, dikenali dari penanda yang Orbyte tulis saat membuat (catatan/`ps` berawalan `orbyte:` dan nama yang dihasilkan oleh run). Tidak pernah menghapus berdasarkan pencarian bebas; id dan nama harus cocok persis dengan catatan run (BR-M17-07).
- Kata sandi database dibuat oleh kode (acak, kuat), ditampilkan sekali di hasil run, tidak disimpan (BR-M02-07) dan tidak dicatat.
- Membuat atau menghapus proxy membuat aaPanel memuat ulang nginx pada server yang melayani situs lain: operasi ini wajib lewat persetujuan, satu per satu, dan diikuti pemeriksaan bahwa situs tetap menjawab.
- ⚠️ Belum diuji: membuat situs PHP (`/site?action=AddSite`), domain, SSL, proyek Node; perilaku bila domain/nama sudah ada; batas laju.

## 5. Yang BELUM terbukti (ditandai ⚠️, uji pada panel uji owner)

- Membuat situs/domain dan konfigurasi nginx lewat API.
- Membuat database dan pengguna database.
- **Menjalankan perintah** atau git clone/pull lewat API, serta membaca commit terpasang (`git rev-parse HEAD`). Bila tidak ada, aaPanel **tidak mendukung** langkah `git_clone`, `git_update`, dan pembacaan commit; jangan menggantinya dengan jalan pintas yang tidak aman.
- Operasi berkas (menulis `.env`).
- Daftar layanan dan restart.
- Format respons dan kode galat; apakah ada pembatas laju.
- Perilaku panel v1 vs v2 (awalan `/v2/`).

## 6. Keamanan

- API key tidak pernah ke model/log/audit/respons API; keluaran respons disaring dari nilai rahasia (BR-M17-03).
- Parameter (domain, nama folder, nama database) divalidasi dengan pola ketat sebelum dikirim (BR-M17-04). Tidak ada eksekusi perintah bebas.
- Sertifikat TLS panel sering tidak tepercaya (panel memakai IP + sertifikat sendiri): pengguna memilih menyematkan sidik jari sertifikat atau menerima risikonya secara eksplisit ⚠️ (keputusan saat implementasi).
