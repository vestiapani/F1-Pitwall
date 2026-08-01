# 🏎️ F1 Pitwall Remote

F1 Pitwall adalah aplikasi pendamping berbasis *dashboard* untuk game F1 (Codemasters/EA). Aplikasi ini memungkinkan Anda memantau telemetri mobil, posisi lawan di lintasan, *leaderboard*, hingga mengontrol fungsi mobil secara nirkabel/kabel melalui *smartphone* menggunakan emulasi *controller* Xbox. Telemetri game F1 tetap bisa dipakai tanpa menghubungkan ke aplikasi Mobile, Biarkan settingan telemetri UDP secara default maka F1 Pitwall otomatis terhubung untuk menerima data telemetri.

---

## ✨ Fitur Utama
* **Live Telemetry:** Pantau RPM, kecepatan, gas/rem, suhu ban, dan status ERS secara *real-time*.
* **Track Map & Leaderboard:** Lacak posisi setiap mobil di lintasan secara *live*, lengkap dengan gap, interval, dan waktu per sektor.
* **Lap Compare:** Bandingkan grafik telemetri (Gas/Rem, Kecepatan, RPM) antar lap secara interaktif.
* **Smart Connection:** Mendukung konektivitas via jaringan WiFi lokal maupun USB (via ADB Reverse) tanpa lag.
* **Xbox Controller Emulation:** Ubah layar HP Anda menjadi *button box* interaktif menggunakan ViGEmBus.

---

## 📥 Instalasi (Windows PC)
1. Pergi ke halaman [Releases](../../releases/latest).
2. Unduh file `F1 Pitwall Setup X.X.X.exe`.
3. Jalankan *installer* dan ikuti petunjuk di layar.
4. **Penting:** Pastikan Anda telah menginstal [ViGEmBus Driver](https://github.com/nefarius/ViGEmBus/releases) agar fitur *controller* dari HP berfungsi normal.

---

## 📱 Panduan Koneksi (PC ke Mobile)
Aplikasi ini terdiri dari server PC dan APK mobile. Untuk menghubungkan HP Anda ke PC, pilih salah satu metode di bawah ini:

### Metode 1: WiFi
1. Pastikan PC dan HP terhubung di **jaringan WiFi yang sama**.
2. Buka F1 Pitwall di PC, pastikan tombol indikator di *navbar* menunjukkan **WiFi**.
3. Buka aplikasi/web di HP, masukkan **IP Server** yang tertera pada *navbar* aplikasi PC.
4. *(Troubleshoot)* Jika gagal, pastikan **Port 3000** tidak terblokir oleh Windows Defender Firewall.

### Metode 2: USB (ADB) (Disarankan)
1. Aktifkan **USB Debugging** pada opsi pengembang (*Developer Options*) di HP Anda.
2. Hubungkan HP ke PC menggunakan kabel data.
3. Klik tombol **USB** pada *navbar* di aplikasi PC. Tunggu hingga notifikasi ADB aktif.
4. Pada aplikasi HP, isi kolom IP dengan `127.0.0.1`.

---

## 🛠️ Tech Stack
* **Frontend PC:** HTML/CSS/JS murni (Modularisasi Canvas Chart).
* **Backend PC:** Node.js, Electron, Socket.io, ViGEmClient.
* **Mobile Client:** React Native.
* **Telemetry Data:** `@racehub-io/f1-telemetry-client` (UDP Port 20777).

## 📄 Lisensi
Proyek ini bersifat *Open-Source*. Silakan modifikasi dan kembangkan lebih lanjut!