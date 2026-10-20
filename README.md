# GPS Timestamp Studio

Aplikasi web statis untuk menempelkan stempel GPS bergaya kamera ke foto:
nama lokasi, koordinat, ketinggian, tanggal/jam, dan **peta mini dengan pin**.
Foto diproses sepenuhnya di browser — tidak pernah diunggah ke server mana pun.

## Fitur

- **Satu halaman** — semua pengaturan tersusun dalam satu alur (Foto → Pin map →
  Waktu → Isi stempel → Tampilan), tanpa menu bertab, dan nyaman dipakai di HP:
  area sentuh besar, kolom menumpuk otomatis, serta bar aksi Unduh/Salin yang
  menempel di bawah layar.
- **Pin Map** — peta interaktif (Leaflet) di bawah pratinjau foto. Ketuk peta atau
  seret pin untuk menentukan lokasi; koordinat dan nama alamat ikut terisi.
- **Pencarian alamat** (Nominatim/OpenStreetMap) dan tombol **ambil GPS perangkat**.
- **Tempel koordinat gabungan** — kolom kosong di atas Lintang/Bujur: tempel satu
  baris hasil salin dari Google Maps (`0.7775066273861159, 127.38027820539887`)
  dan isinya otomatis dipecah ke kedua kolom sekaligus memindahkan pin. Menerima
  pemisah koma atau spasi, huruf arah (N/S/E/W), serta format derajat
  (`0°46'39"N 127°22'49"E`), termasuk bila urutan bujur-lintang terbalik.
- **Deteksi ketinggian.** Mode otomatis dari koordinat pin **menyala secara
  default**; pembacaan EXIF tetap opsional dan default mati. Dua sumber:
  centang *"Ambil lokasi, ketinggian & waktu dari data EXIF foto"* untuk membaca
  GPSAltitude, koordinat, dan waktu pemotretan langsung dari file foto (offline,
  tanpa kirim data ke mana pun); atau tombol **Deteksi** / centang *"Deteksi
  ketinggian otomatis saat pin dipindah"* untuk mengambil ketinggian permukaan
  tanah di titik pin dari Open-Meteo Elevation API (tanpa kunci). Sumber angka
  yang sedang dipakai ditampilkan di samping kolom ketinggian.
- **Peta mini di dalam stempel** — potongan peta persegi dengan penanda merah,
  disusun dari tile basemap langsung di canvas, lengkap dengan atribusi.
- Zona waktu WIB/WITA/WIT; jam yang diketik dibaca sebagai jam dinding zona terpilih,
  baris GMT dihitung dari situ.
- **Lima model stempel**: *Kartu peta* (peta mini + rincian lengkap), *Jam besar*
  (jam raksasa di kiri), *Ringkas di sudut*, *Pita tipis* selebar foto, dan
  *Klasik tanpa kotak* bergaya stempel tanggal kamera analog. Posisinya bisa
  dipindah ke empat sudut.
- Tiga tema stempel, pengaturan transparansi, ukuran teks, label kamera,
  dan pilihan kolom yang ditampilkan.
- Unduh hasil sebagai JPG/PNG beresolusi asli, atau salin ke clipboard. Nama file
  mengikuti waktu yang diset: `07-03-2026-18.45.09.jpg` (tanggal-bulan-tahun-jam).

## Menjalankan di lokal

```bash
python3 -m http.server 8000     # lalu buka http://localhost:8000
```

Fitur GPS perangkat butuh `https://` atau `localhost`.

## Kunci basemap CARTO

Kunci API **tidak disimpan di repo**. Saat build, `scripts/build-config.mjs`
menulis `config.js` dari environment variable `CARTO_BASEMAP_KEY`
(`config.js` ada di `.gitignore`). Tanpa kunci, aplikasi otomatis memakai tile
OpenStreetMap sehingga tetap jalan.

Untuk mencoba di lokal: salin `config.example.js` menjadi `config.js`, lalu isi kuncinya.

## Deploy ke Vercel

1. Import repository ini di Vercel (framework preset: **Other**).
2. Settings → Environment Variables → tambahkan:

   | Name | Value |
   | --- | --- |
   | `CARTO_BASEMAP_KEY` | kunci CARTO Basemaps Anda |

   Centang Production, Preview, dan Development.
3. Deploy. `vercel.json` sudah mengatur build command dan output directory,
   jadi tidak ada konfigurasi lain yang perlu diisi.

Setelah deploy, batasi kunci tersebut ke domain Vercel Anda lewat
[dashboard CARTO](https://dashboard.basemaps.carto.com/) — kunci basemap raster
selalu terlihat di sisi klien, jadi pembatasan domain adalah pengamannya.

## Atribusi

Peta © [CARTO](https://carto.com/attributions),
© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
Pencarian alamat memakai Nominatim (OpenStreetMap).
Data ketinggian dari [Open-Meteo](https://open-meteo.com/) (Copernicus DEM).
