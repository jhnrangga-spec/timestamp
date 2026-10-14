# GPS Timestamp Studio

Aplikasi web statis untuk menempelkan stempel GPS bergaya kamera ke foto:
nama lokasi, koordinat, ketinggian, tanggal/jam, dan **peta mini dengan pin**.
Foto diproses sepenuhnya di browser — tidak pernah diunggah ke server mana pun.

## Fitur

- **Pin Map** — peta interaktif (Leaflet) di bawah pratinjau foto. Klik peta atau
  seret pin untuk menentukan lokasi; koordinat dan nama alamat ikut terisi.
- **Pencarian alamat** (Nominatim/OpenStreetMap) dan tombol **ambil GPS perangkat**.
- **Peta mini di dalam stempel** — potongan peta persegi dengan penanda merah,
  disusun dari tile basemap langsung di canvas, lengkap dengan atribusi.
- Zona waktu WIB/WITA/WIT; jam yang diketik dibaca sebagai jam dinding zona terpilih,
  baris GMT dihitung dari situ.
- Tiga tema stempel, pengaturan transparansi, ukuran teks, label kamera,
  dan pilihan kolom yang ditampilkan.
- Unduh hasil sebagai JPG/PNG beresolusi asli, atau salin ke clipboard.

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
