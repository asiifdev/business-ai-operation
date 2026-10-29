---
name: ssh-integration
description: Koneksi server lewat SSH (M17), salah satu opsi koneksi yang berdiri sendiri, dengan metode kata sandi, kunci privat, atau gabungan, dan host key disematkan. Baca sebelum menulis pelaksana SSH, tes koneksi, atau langkah playbook yang menjalankan perintah.
---

# SSH (pustaka `ssh2`): panduan integrasi (M17)

Sumber: dokumentasi `mscdex/ssh2` (README dan referensi konfigurasi) lewat Context7, dibaca **2026-10-29**. Versi pustaka yang tersedia di Context7: 1.17.0 ⚠️ (pastikan versi terpasang).

## 1. Bentuk integrasi di proyek ini

- SSH adalah **opsi koneksi server yang berdiri sendiri** (D-055). `connections.config` menyimpan `{host, port, username, authMethod}`; kata sandi, kunci privat, passphrase ada di rahasia terenkripsi (BR-M17-02). Kode: `src/integrations/ssh/` di balik `ServerRunner`.
- **Tidak ada shell interaktif** dan tidak ada perintah bebas: hanya templat langkah dari katalog, argumen divalidasi dan dikutip (BR-M17-04).

## 2. Opsi koneksi `Client.connect()`

`host` (bawaan `localhost`), `port` (22), `username` (**wajib**), `password`, `privateKey` (string/Buffer, format OpenSSH), `passphrase` (untuk kunci terenkripsi), `readyTimeout` (ms, bawaan 20000), `keepaliveInterval` (ms, bawaan 0), `keepaliveCountMax` (3), `hostHash` (algoritma hash yang didukung node, mis. `sha256`), `hostVerifier(key[, callback])`, `tryKeyboard`, `authHandler`, `algorithms`.

## 3. Metode login (BR-M17-08)

- **Kata sandi:** `{ username, password }`.
- **Kunci privat:** `{ username, privateKey, passphrase? }`.
- **Gabungan (kunci + kata sandi, `AuthenticationMethods publickey,password` di server):** pakai `authHandler` fungsi `(methodsLeft, partialSuccess, callback)`: percobaan pertama (`methodsLeft` null) kembalikan `{type:'publickey', username, key, passphrase}`; bila `partialSuccess` dan `password` ada di `methodsLeft`, kembalikan `{type:'password', username, password}`; `false` menghentikan semua percobaan. Bentuk objek valid: `none`, `password`, `publickey`, `hostbased`, `agent`, `keyboard-interactive`. ⚠️ Dibuktikan terhadap server uji dengan `AuthenticationMethods` ganda.
- `tryKeyboard: true` hanya bila perlu keyboard-interactive; wajib menangani event `keyboard-interactive`. Tidak dipakai secara bawaan.

## 4. Host key (wajib, BR-M17-08)

- Set `hostHash: 'sha256'` dan `hostVerifier(hash)`: bandingkan dengan `connections.host_key_fingerprint`. **Tanpa `hostVerifier` pustaka menerima semua host key** (bawaan), jadi verifier wajib selalu dipasang.
- Tes pertama: tampilkan sidik jari ke pengguna; setelah dikonfirmasi, simpan. Sidik jari berubah = tolak dan minta konfirmasi ulang.
- Gunakan perbandingan waktu-konstan (`crypto.timingSafeEqual`) pada hash.

## 5. Eksekusi perintah

Satu perintah per langkah lewat `client.exec(command, cb)`; baca `stdout` dan `stderr`, kode keluar, dan batas waktu per langkah (`organizations.step_timeout_sec`). Keluaran dipotong 8 KB dan disaring dari nilai rahasia (BR-M17-03). Tutup koneksi setelah run; satu run per server pada satu waktu (BR-M17-15).

## 6. Hal yang belum diverifikasi (uji sebelum bergantung)

- ⚠️ Bentuk tepat `exec` (opsi `pty`, `env`) dan penanganan sinyal batas waktu pada versi terpasang.
- ⚠️ Kunci privat format selain OpenSSH (mis. PEM/PuTTY) dan passphrase salah: pesan galat yang aman tanpa membocorkan material.
- ⚠️ Pemblokiran IP server Orbyte oleh firewall pelanggan (D-054 butir 5): tes koneksi harus memberi pesan yang jelas.
- ⚠️ Pengutipan argumen shell yang aman untuk tiap templat langkah (uji injeksi: `;`, `$()`, spasi, `..`, awalan `-`).
