/* Pembaca EXIF ringkas: ambil koordinat GPS, ketinggian, dan waktu pemotretan
   dari file JPEG. Tanpa dependensi; seluruhnya berjalan di browser. */

const EXIF_TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

function readExifValue(view, entryAt, tiffBase, little) {
  const type = view.getUint16(entryAt + 2, little);
  const count = view.getUint32(entryAt + 4, little);
  const size = (EXIF_TYPE_SIZE[type] || 0) * count;
  if (!size) return null;
  const at = size <= 4 ? entryAt + 8 : tiffBase + view.getUint32(entryAt + 8, little);
  if (at + size > view.byteLength) return null;

  const out = [];
  for (let i = 0; i < count; i++) {
    const p = at + i * EXIF_TYPE_SIZE[type];
    switch (type) {
      case 1: case 7: out.push(view.getUint8(p)); break;
      case 2: out.push(String.fromCharCode(view.getUint8(p))); break;
      case 3: out.push(view.getUint16(p, little)); break;
      case 4: out.push(view.getUint32(p, little)); break;
      case 5: out.push(view.getUint32(p, little) / (view.getUint32(p + 4, little) || 1)); break;
      case 9: out.push(view.getInt32(p, little)); break;
      case 10: out.push(view.getInt32(p, little) / (view.getInt32(p + 4, little) || 1)); break;
      default: return null;
    }
  }
  return type === 2 ? out.join('').replace(/\0.*$/, '') : out;
}

function readExifIfd(view, ifdAt, tiffBase, little) {
  const tags = {};
  if (ifdAt + 2 > view.byteLength) return tags;
  const count = view.getUint16(ifdAt, little);
  for (let i = 0; i < count; i++) {
    const entryAt = ifdAt + 2 + i * 12;
    if (entryAt + 12 > view.byteLength) break;
    tags[view.getUint16(entryAt, little)] = readExifValue(view, entryAt, tiffBase, little);
  }
  return tags;
}

/** Ubah [derajat, menit, detik] + huruf arah menjadi derajat desimal. */
function dmsToDecimal(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const value = dms[0] + dms[1] / 60 + dms[2] / 3600;
  if (!Number.isFinite(value)) return null;
  return /^[SW]/i.test(String(ref || '')) ? -value : value;
}

/**
 * Baca metadata EXIF yang relevan dari sebuah file foto.
 * Mengembalikan { lat, lon, alt, wallClock, utcOffsetMinutes } — tiap bagian
 * bisa null bila tidak tersedia. Mengembalikan null bila file bukan JPEG
 * atau tidak memuat blok EXIF.
 */
async function readPhotoExif(file) {
  let view;
  try {
    // Blok EXIF selalu berada di awal file; 256 KB lebih dari cukup.
    view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  } catch {
    return null;
  }
  if (view.byteLength < 8 || view.getUint16(0) !== 0xFFD8) return null; // bukan JPEG

  let offset = 2;
  let tiffBase = -1;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xFF00) !== 0xFF00) break;
    if (marker === 0xFFDA) break;                       // mulai data gambar
    const size = view.getUint16(offset + 2);
    if (marker === 0xFFE1 && offset + 10 < view.byteLength
        && view.getUint32(offset + 4) === 0x45786966) { // "Exif"
      tiffBase = offset + 10;
      break;
    }
    offset += 2 + size;
  }
  if (tiffBase < 0 || tiffBase + 8 > view.byteLength) return null;

  const little = view.getUint16(tiffBase) === 0x4949;
  if (view.getUint16(tiffBase + 2, little) !== 0x2A) return null;

  const ifd0 = readExifIfd(view, tiffBase + view.getUint32(tiffBase + 4, little), tiffBase, little);
  const exif = ifd0[0x8769] ? readExifIfd(view, tiffBase + ifd0[0x8769][0], tiffBase, little) : {};
  const gps = ifd0[0x8825] ? readExifIfd(view, tiffBase + ifd0[0x8825][0], tiffBase, little) : {};

  const lat = dmsToDecimal(gps[2], gps[1]);
  const lon = dmsToDecimal(gps[4], gps[3]);

  let alt = null;
  if (Array.isArray(gps[6]) && Number.isFinite(gps[6][0])) {
    alt = gps[5] && gps[5][0] === 1 ? -gps[6][0] : gps[6][0];  // ref 1 = di bawah permukaan laut
  }

  // "2026:03:07 18:45:09" -> "2026-03-07T18:45:09"
  const taken = exif[0x9003] || ifd0[0x0132] || null;
  const m = taken && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(taken);
  const wallClock = m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;

  const off = exif[0x9011] && /^([+-])(\d{2}):(\d{2})/.exec(exif[0x9011]);
  const utcOffsetMinutes = off ? (off[1] === '-' ? -1 : 1) * (+off[2] * 60 + +off[3]) : null;

  return {
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    alt: Number.isFinite(alt) ? alt : null,
    wallClock,
    utcOffsetMinutes,
  };
}
