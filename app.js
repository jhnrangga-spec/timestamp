/* GPS Timestamp Studio — stempel GPS + peta mini di atas foto.
   Semua pemrosesan foto terjadi di browser; hanya tile peta & geocoding
   yang mengambil data dari OpenStreetMap. */

const $ = (id) => document.getElementById(id);

const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const photo = new Image();
let hasPhoto = false;
let photoFile = null;      // disimpan agar EXIF bisa dibaca ulang kapan saja

const SAMPLE = {
  place: 'Bastiong Talangame, Ternate Selatan, Kota Ternate, Maluku Utara, Indonesia',
  lat: '0.768672',
  lon: '127.374420',
  alt: '5.0',
  brand: 'GPS Map Camera',
};

/* Basemap CARTO.
   Kunci TIDAK disimpan di repo. Saat build, scripts/build-config.mjs menulis
   config.js dari environment variable CARTO_BASEMAP_KEY (atur di Vercel →
   Settings → Environment Variables). Untuk coba di lokal, salin
   config.example.js menjadi config.js lalu isi kuncinya.
   Tanpa kunci, aplikasi otomatis memakai tile OpenStreetMap. */
const CARTO_KEY = (window.APP_CONFIG && window.APP_CONFIG.cartoKey) || '';
const HAS_CARTO = CARTO_KEY.length > 0;

const cartoUrl = (name) =>
  `https://basemaps.cartocdn.com/rastertiles/${name}/{z}/{x}/{y}.png?key=${encodeURIComponent(CARTO_KEY)}`;

const CARTO_ATTR = '© CARTO © OpenStreetMap contributors';
const OSM_ATTR = '© OpenStreetMap contributors';

const TILES = {
  voyager:    { tpl: cartoUrl('voyager'),   attr: CARTO_ATTR, max: 20, carto: true },
  positron:   { tpl: cartoUrl('light_all'), attr: CARTO_ATTR, max: 20, carto: true },
  darkmatter: { tpl: cartoUrl('dark_all'),  attr: CARTO_ATTR, max: 20, carto: true },
  osm:        { tpl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: OSM_ATTR, max: 19 },
  topo:       { tpl: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', sub: 'abc', max: 16,
                attr: '© OpenStreetMap · OpenTopoMap' },
};

const DEFAULT_STYLE = HAS_CARTO ? 'voyager' : 'osm';

/** Gaya yang dipilih, dengan fallback ke OSM bila gaya CARTO dipakai tanpa kunci. */
function styleOf(key) {
  const style = TILES[key] || TILES[DEFAULT_STYLE];
  return style.carto && !HAS_CARTO ? TILES.osm : style;
}

/** URL tile konkret (mengisi {s}/{z}/{x}/{y}) untuk digambar ke canvas. */
function tileUrl(style, z, x, y) {
  const sub = style.sub ? style.sub[(x + y) % style.sub.length] : '';
  return style.tpl.replace('{s}', sub).replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

/* ---------------------------------------------------------------- status */

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text || '';
  el.classList.toggle('err', !!isError);
}

/* ------------------------------------------------------------ tema halaman */

const savedTheme = localStorage.getItem('gts-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$('themeBtn').onclick = () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('gts-theme', next);
};

/* ------------------------------------------------------- tanggal & waktu */

$('datetime').step = 1;

/** Selisih zona waktu (ms) pada instant tertentu. */
function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUTC = Date.UTC(+parts.year, parts.month - 1, +parts.day, hour, +parts.minute, +parts.second);
  return asUTC - date.getTime();
}

/** "2026-10-14T09:21:43" yang dibaca sebagai jam dinding di zona `tz`. */
function wallClockToInstant(value, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value || '');
  if (!m) return new Date();
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let ts = naive - tzOffsetMs(new Date(naive), tz);
  ts = naive - tzOffsetMs(new Date(ts), tz);     // koreksi untuk batas DST
  return new Date(ts);
}

function nowAsWallClock(tz) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date()).reduce((acc, x) => (acc[x.type] = x.value, acc), {});
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}`;
}

function setNow() { $('datetime').value = nowAsWallClock($('timezone').value); }

function currentInstant() { return wallClockToInstant($('datetime').value, $('timezone').value); }

function fmtDate(d, tz) {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz,
  }).format(d);
}

function fmtTime(d, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: tz,
  }).format(d);
}

function tzLabel(d, tz) {
  const part = new Intl.DateTimeFormat('id-ID', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(d).find((p) => p.type === 'timeZoneName');
  return part ? part.value : tz;
}

function gmtOffsetLabel(d, tz) {
  const mins = Math.round(tzOffsetMs(d, tz) / 60000);
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  return `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/* --------------------------------------------------------------- peta mini */

const tileCache = new Map();
const miniCache = new Map();

function loadTile(url) {
  if (tileCache.has(url)) return tileCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  tileCache.set(url, p);
  return p;
}

function lonToWorldX(lon, z) { return ((lon + 180) / 360) * 256 * 2 ** z; }
function latToWorldY(lat, z) {
  const rad = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
  return y * 256 * 2 ** z;
}

function drawPin(c, cx, cy, size) {
  c.save();
  c.translate(cx, cy - size * 0.1);
  c.beginPath();
  c.moveTo(0, size * 0.55);
  c.bezierCurveTo(-size * 0.52, -size * 0.1, -size * 0.36, -size * 0.62, 0, -size * 0.62);
  c.bezierCurveTo(size * 0.36, -size * 0.62, size * 0.52, -size * 0.1, 0, size * 0.55);
  c.closePath();
  c.fillStyle = '#e5484d';
  c.shadowColor = 'rgba(0,0,0,.45)';
  c.shadowBlur = size * 0.25;
  c.fill();
  c.shadowBlur = 0;
  c.lineWidth = Math.max(1, size * 0.07);
  c.strokeStyle = '#fff';
  c.stroke();
  c.beginPath();
  c.arc(0, -size * 0.22, size * 0.14, 0, Math.PI * 2);
  c.fillStyle = '#fff';
  c.fill();
  c.restore();
}

/**
 * Susun peta mini persegi dari tile OSM, dipusatkan ke lat/lon.
 * Mengembalikan canvas offscreen, atau null bila tile gagal dimuat.
 */
async function buildMiniMap(lat, lon, zoom, styleKey, sizePx) {
  const style = styleOf(styleKey);
  const baseZoom = Math.min(zoom, style.max);
  // Perbesar zoom (tanpa mengubah cakupan) agar thumbnail tetap tajam.
  const extra = Math.max(0, Math.min(2, Math.ceil(Math.log2(Math.max(1, sizePx / 256))), style.max - baseZoom));
  const z = baseZoom + extra;
  const crop = 256 * 2 ** extra;

  const cx = lonToWorldX(lon, z);
  const cy = latToWorldY(lat, z);
  const left = cx - crop / 2;
  const top = cy - crop / 2;
  const world = 256 * 2 ** z;

  const out = document.createElement('canvas');
  out.width = crop;
  out.height = crop;
  const c = out.getContext('2d');
  c.fillStyle = '#dfe3d8';
  c.fillRect(0, 0, crop, crop);

  const x0 = Math.floor(left / 256), x1 = Math.floor((left + crop - 1) / 256);
  const y0 = Math.floor(top / 256), y1 = Math.floor((top + crop - 1) / 256);
  const jobs = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty * 256 >= world) continue;
      const wrapped = ((tx % 2 ** z) + 2 ** z) % 2 ** z;
      jobs.push(loadTile(tileUrl(style, z, wrapped, ty)).then((img) => ({ img, tx, ty })));
    }
  }

  const tiles = await Promise.all(jobs);
  let drawn = 0;
  for (const { img, tx, ty } of tiles) {
    if (!img) continue;
    c.drawImage(img, Math.round(tx * 256 - left), Math.round(ty * 256 - top), 256, 256);
    drawn++;
  }
  if (!drawn) return null;

  drawPin(c, crop / 2, crop / 2, crop * 0.18);

  // Atribusi wajib untuk tile OpenStreetMap.
  const fs = Math.max(8, crop * 0.038);
  c.font = `${fs}px Arial, sans-serif`;
  c.textBaseline = 'bottom';
  const label = style.attr;
  const tw = c.measureText(label).width;
  c.fillStyle = 'rgba(255,255,255,.75)';
  c.fillRect(crop - tw - fs * 0.6, crop - fs * 1.5, tw + fs * 0.6, fs * 1.5);
  c.fillStyle = '#333';
  c.fillText(label, crop - tw - fs * 0.3, crop - fs * 0.25);

  return out;
}

function miniKey(lat, lon, zoom, style, size) {
  return `${style}|${zoom}|${lat.toFixed(5)}|${lon.toFixed(5)}|${size}`;
}

async function getMiniMap(lat, lon, zoom, style, size) {
  const key = miniKey(lat, lon, zoom, style, size);
  if (miniCache.has(key)) return miniCache.get(key);
  const built = await buildMiniMap(lat, lon, zoom, style, size);
  miniCache.set(key, built);
  if (miniCache.size > 24) miniCache.delete(miniCache.keys().next().value);
  return built;
}

/* ---------------------------------------------------------------- render */

const STAMP_THEMES = {
  dark:   { bg: '0,0,0',       title: '#ffffff', body: '#eaeaea', accent: null,      plain: '#ffb300' },
  light:  { bg: '255,255,255', title: '#101620', body: '#39445a', accent: null,      plain: '#ffffff' },
  accent: { bg: '0,0,0',       title: '#ffffff', body: '#eaeaea', accent: '#76e0c2', plain: '#76e0c2' },
};

/* Model stempel. `full` = selebar foto, `usesMap` = memakai peta mini. */
const LAYOUTS = {
  card:    { usesMap: true,  full: true },
  bigdate: { usesMap: true,  full: true },
  compact: { usesMap: true,  full: false },
  bar:     { usesMap: false, full: true },
  classic: { usesMap: false, full: false },
};

function layoutKey() {
  const key = $('layout').value;
  return LAYOUTS[key] ? key : 'card';
}

function layoutUsesMap() {
  return LAYOUTS[layoutKey()].usesMap && $('showMap').checked;
}

function wrapText(c, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (c.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    if (c.measureText(last).width > maxWidth) {
      while (last.length > 1 && c.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

function coordLabel(valueText, posSuffix, negSuffix) {
  const n = Number(valueText);
  if (!Number.isFinite(n)) return valueText || '—';
  return `${Math.abs(n).toFixed(6)}° ${n >= 0 ? posSuffix : negSuffix}`;
}

function stampGeometry(w, h) {
  const scale = Number($('scale').value) || 1;
  const base = Math.max(11, Math.min(w, h) * 0.027 * scale);
  return { base, pad: base * 0.78, mapSide: base * 5.6 };
}

/** Seluruh teks yang bisa dipakai tiap model stempel. */
function stampData() {
  const d = currentInstant();
  const tz = $('timezone').value;
  const place = $('place').value.trim() || 'Lokasi tidak diketahui';
  const headline = $('headline').value.trim() || place.split(',').slice(0, 2).join(',').trim();
  const lat = $('lat').value.trim();
  const lon = $('lon').value.trim();
  const altValue = $('alt').value.trim() || '—';

  return {
    d, tz, place, headline,
    sameHeadline: place === headline,
    coords: $('showCoords').checked
      ? `Lat ${coordLabel(lat, 'N', 'S')}   Long ${coordLabel(lon, 'E', 'W')}` : null,
    coordsShort: $('showCoords').checked ? `${lat || '—'}, ${lon || '—'}` : null,
    alt: $('showAlt').checked ? `Ketinggian ${altValue} meter` : null,
    altShort: $('showAlt').checked ? `${altValue} m` : null,
    date: $('showDate').checked ? fmtDate(d, tz) : null,
    dateShort: $('showDate').checked
      ? new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz }).format(d)
      : null,
    time: $('showTime').checked ? `${fmtTime(d, tz)} ${tzLabel(d, tz)}` : null,
    clock: $('showTime').checked
      ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d)
      : null,
    gmt: $('showTime').checked ? `${gmtOffsetLabel(d, tz)}  ·  GMT ${fmtTime(d, 'UTC')}` : null,
    brand: $('showBrand').checked ? $('brand').value.trim() : '',
  };
}

/* ------------------------------------------------- perkakas menggambar */

function roundBox(c, x, y, w, h, r, fill) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
}

/** Tempatkan kotak sesuai pilihan posisi. Layout selebar foto hanya memakai sisi atas/bawah. */
function boxPosition(w, h, boxW, boxH, pad, full) {
  const pos = $('position').value || 'bottom-right';
  const top = pos.startsWith('top');
  const left = pos.endsWith('left');
  return {
    x: full ? (w - boxW) / 2 : (left ? pad : w - boxW - pad),
    y: top ? pad : h - boxH - pad,
  };
}

function drawTextLines(c, lines, x, y, maxWidth) {
  let ty = y;
  for (const line of lines) {
    c.fillStyle = line.color;
    c.font = `${line.weight || 400} ${line.size}px Arial, sans-serif`;
    c.fillText(line.text, x, ty, maxWidth);
    ty += line.size * (line.lh || 1.3);
  }
  return ty - y;
}

function linesHeight(lines) {
  return lines.reduce((sum, l) => sum + l.size * (l.lh || 1.3), 0);
}

function drawMiniFrame(c, mini, x, y, size, radius) {
  c.save();
  c.beginPath();
  c.roundRect(x, y, size, size, radius);
  c.clip();
  c.drawImage(mini, x, y, size, size);
  c.restore();
  c.save();
  c.lineWidth = Math.max(1, size * 0.012);
  c.strokeStyle = 'rgba(255,255,255,.55)';
  c.beginPath();
  c.roundRect(x, y, size, size, radius);
  c.stroke();
  c.restore();
}

/** Label kamera sebagai pil kecil di atas (atau di bawah) kotak stempel. */
function drawBrandBadge(c, brand, boxX, boxY, boxW, boxH, base, below) {
  if (!brand) return;
  c.font = `700 ${base * 0.72}px Arial, sans-serif`;
  const bw = Math.min(boxW * 0.6, c.measureText(brand).width + base * 1.1);
  const bh = base * 1.3;
  const bx = boxX + boxW - bw;
  const by = below ? boxY + boxH + base * 0.3 : boxY - bh - base * 0.3;
  roundBox(c, bx, by, bw, bh, bh * 0.28, 'rgba(245,245,245,.92)');
  c.fillStyle = '#1d2430';
  c.textBaseline = 'middle';
  c.fillText(brand, bx + base * 0.55, by + bh / 2, bw - base * 1.1);
  c.textBaseline = 'top';
}

/* --------------------------------------------------------- model stempel */

/** Kartu peta: peta mini di kiri, rincian di kanan, selebar foto. */
function layoutCard(c, w, h, g, data, theme, mini) {
  const { base, pad, mapSide } = g;
  const withMap = !!mini;
  const boxW = w - pad * 2;
  const textW = Math.max(base * 6, boxW - pad * 2 - (withMap ? mapSide + base * 0.9 : 0));

  const lines = [];
  c.font = `700 ${base * 1.18}px Arial, sans-serif`;
  for (const t of wrapText(c, data.headline, textW, 1)) {
    lines.push({ text: t, size: base * 1.18, weight: 700, color: theme.title, lh: 1.32 });
  }
  if (!data.sameHeadline) {
    c.font = `400 ${base * 0.78}px Arial, sans-serif`;
    for (const t of wrapText(c, data.place, textW, 2)) {
      lines.push({ text: t, size: base * 0.78, weight: 400, color: theme.body });
    }
  }
  if (data.coords) lines.push({ text: data.coords, size: base * 0.8, weight: 500, color: theme.body, lh: 1.32 });
  if (data.alt) lines.push({ text: data.alt, size: base * 0.78, weight: 400, color: theme.body, lh: 1.32 });
  if (data.date || data.time) {
    lines.push({ text: [data.date, data.time].filter(Boolean).join('  ·  '),
      size: base * 0.8, weight: 500, color: theme.title, lh: 1.32 });
  }
  if (data.gmt) lines.push({ text: data.gmt, size: base * 0.72, weight: 400, color: theme.body });

  const textH = linesHeight(lines);
  const boxH = Math.max(withMap ? mapSide : 0, textH) + pad * 1.2;
  const { x, y } = boxPosition(w, h, boxW, boxH, pad * 0.8, true);

  roundBox(c, x, y, boxW, boxH, Math.min(base * 0.8, boxH * 0.22),
    `rgba(${theme.bg},${Number($('opacity').value) / 100})`);
  if (theme.accent) roundBox(c, x, y, Math.max(3, base * 0.14), boxH, base * 0.3, theme.accent);

  let textX = x + pad;
  if (withMap) {
    drawMiniFrame(c, mini, x + pad, y + (boxH - mapSide) / 2, mapSide, Math.min(base * 0.45, mapSide * 0.12));
    textX = x + pad + mapSide + base * 0.9;
  }
  drawTextLines(c, lines, textX, y + (boxH - textH) / 2, textW);
  drawBrandBadge(c, data.brand, x, y, boxW, boxH, base, $('position').value.startsWith('top'));
}

/** Jam besar: jam raksasa di kiri, rincian di tengah, peta di kanan. */
function layoutBigDate(c, w, h, g, data, theme, mini) {
  const { base, pad, mapSide } = g;
  const withMap = !!mini;
  const boxW = w - pad * 2;
  const clockSize = base * 2.5;

  c.font = `700 ${clockSize}px Arial, sans-serif`;
  const clockText = data.clock || data.dateShort || '';
  const clockW = clockText ? c.measureText(clockText).width : 0;

  const leftLines = [];
  if (data.dateShort) leftLines.push({ text: data.dateShort, size: base * 0.82, weight: 500, color: theme.body });
  if (data.time) {
    const zone = data.time.split(' ').pop();
    leftLines.push({ text: `${zone}  ·  ${gmtOffsetLabel(data.d, data.tz)}`, size: base * 0.7, weight: 400, color: theme.body });
  }
  const leftW = Math.max(clockW, ...leftLines.map((l) => {
    c.font = `${l.weight} ${l.size}px Arial, sans-serif`;
    return c.measureText(l.text).width;
  }), base * 4);

  const gap = base * 1.1;
  const textW = Math.max(base * 5, boxW - pad * 2 - leftW - gap - (withMap ? mapSide + gap : 0));
  const mid = [];
  c.font = `700 ${base * 1.0}px Arial, sans-serif`;
  for (const t of wrapText(c, data.headline, textW, 1)) {
    mid.push({ text: t, size: base, weight: 700, color: theme.title, lh: 1.34 });
  }
  if (!data.sameHeadline) {
    c.font = `400 ${base * 0.74}px Arial, sans-serif`;
    for (const t of wrapText(c, data.place, textW, 2)) {
      mid.push({ text: t, size: base * 0.74, weight: 400, color: theme.body });
    }
  }
  if (data.coords) mid.push({ text: data.coords, size: base * 0.74, weight: 500, color: theme.body });
  if (data.alt) mid.push({ text: data.alt, size: base * 0.74, weight: 400, color: theme.body });

  const clockBlockH = (clockText ? clockSize * 1.1 : 0) + linesHeight(leftLines);
  const boxH = Math.max(withMap ? mapSide : 0, clockBlockH, linesHeight(mid)) + pad * 1.2;
  const { x, y } = boxPosition(w, h, boxW, boxH, pad * 0.8, true);

  roundBox(c, x, y, boxW, boxH, Math.min(base * 0.8, boxH * 0.22),
    `rgba(${theme.bg},${Number($('opacity').value) / 100})`);
  if (theme.accent) roundBox(c, x, y, Math.max(3, base * 0.14), boxH, base * 0.3, theme.accent);

  let ly = y + (boxH - clockBlockH) / 2;
  if (clockText) {
    c.fillStyle = theme.title;
    c.font = `700 ${clockSize}px Arial, sans-serif`;
    c.fillText(clockText, x + pad, ly);
    ly += clockSize * 1.1;
  }
  drawTextLines(c, leftLines, x + pad, ly, leftW);

  const midH = linesHeight(mid);
  drawTextLines(c, mid, x + pad + leftW + gap, y + (boxH - midH) / 2, textW);

  if (withMap) {
    drawMiniFrame(c, mini, x + boxW - pad - mapSide, y + (boxH - mapSide) / 2, mapSide,
      Math.min(base * 0.45, mapSide * 0.12));
  }
  drawBrandBadge(c, data.brand, x, y, boxW, boxH, base, $('position').value.startsWith('top'));
}

/** Ringkas: kotak kecil di salah satu sudut foto. */
function layoutCompact(c, w, h, g, data, theme, mini) {
  const { base, pad } = g;
  const withMap = !!mini;
  const mapSide = base * 3.8;
  const textW = Math.min(w * 0.42, base * 13);

  const lines = [];
  c.font = `700 ${base * 0.86}px Arial, sans-serif`;
  for (const t of wrapText(c, data.headline, textW, 1)) {
    lines.push({ text: t, size: base * 0.86, weight: 700, color: theme.title, lh: 1.36 });
  }
  if (data.coordsShort) lines.push({ text: data.coordsShort, size: base * 0.64, weight: 400, color: theme.body });
  if (data.date || data.time) {
    lines.push({ text: [data.dateShort, data.time].filter(Boolean).join('  ·  '),
      size: base * 0.68, weight: 500, color: theme.title });
  }
  if (data.altShort) lines.push({ text: `Ketinggian ${data.altShort}`, size: base * 0.62, weight: 400, color: theme.body });

  c.font = `400 ${base * 0.68}px Arial, sans-serif`;
  const widest = Math.max(...lines.map((l) => {
    c.font = `${l.weight} ${l.size}px Arial, sans-serif`;
    return c.measureText(l.text).width;
  }));
  const innerPad = base * 0.6;
  const textH = linesHeight(lines);
  const boxW = Math.min(w - pad * 2, widest + innerPad * 2 + (withMap ? mapSide + innerPad : 0));
  const boxH = Math.max(withMap ? mapSide : 0, textH) + innerPad * 2;
  const { x, y } = boxPosition(w, h, boxW, boxH, pad, false);

  roundBox(c, x, y, boxW, boxH, Math.min(base * 0.6, boxH * 0.2),
    `rgba(${theme.bg},${Number($('opacity').value) / 100})`);
  if (theme.accent) roundBox(c, x, y, Math.max(2, base * 0.12), boxH, base * 0.25, theme.accent);

  let textX = x + innerPad;
  if (withMap) {
    drawMiniFrame(c, mini, x + innerPad, y + (boxH - mapSide) / 2, mapSide, base * 0.3);
    textX = x + innerPad * 2 + mapSide;
  }
  drawTextLines(c, lines, textX, y + (boxH - textH) / 2, boxW - (textX - x) - innerPad);
  drawBrandBadge(c, data.brand, x, y, boxW, boxH, base, $('position').value.startsWith('top'));
}

/** Pita tipis selebar foto, tanpa peta. */
function layoutBar(c, w, h, g, data) {
  const { base, pad } = g;
  const theme = STAMP_THEMES[$('theme').value] || STAMP_THEMES.dark;
  const boxW = w;
  const innerPad = base * 1.1;
  const textW = boxW - innerPad * 2;

  const main = [data.headline, [data.dateShort, data.time].filter(Boolean).join(' ')]
    .filter(Boolean).join('  ·  ');
  const sub = [data.coordsShort, data.altShort && `Ketinggian ${data.altShort}`]
    .filter(Boolean).join('  ·  ');

  const lines = [];
  c.font = `600 ${base * 0.86}px Arial, sans-serif`;
  for (const t of wrapText(c, main, textW, 1)) {
    lines.push({ text: t, size: base * 0.86, weight: 600, color: theme.title, lh: 1.34 });
  }
  if (sub) {
    c.font = `400 ${base * 0.68}px Arial, sans-serif`;
    for (const t of wrapText(c, sub, textW, 1)) {
      lines.push({ text: t, size: base * 0.68, weight: 400, color: theme.body });
    }
  }

  const textH = linesHeight(lines);
  const boxH = textH + innerPad * 1.1;
  const top = ($('position').value || '').startsWith('top');
  const y = top ? 0 : h - boxH;

  c.fillStyle = `rgba(${theme.bg},${Number($('opacity').value) / 100})`;
  c.fillRect(0, y, boxW, boxH);
  if (theme.accent) {
    c.fillStyle = theme.accent;
    c.fillRect(0, top ? y + boxH - Math.max(2, base * 0.1) : y, boxW, Math.max(2, base * 0.1));
  }
  drawTextLines(c, lines, innerPad, y + (boxH - textH) / 2, textW);

  if (data.brand) {
    c.font = `700 ${base * 0.68}px Arial, sans-serif`;
    c.fillStyle = theme.body;
    c.textAlign = 'right';
    c.fillText(data.brand, boxW - innerPad, y + (boxH - base * 0.68) / 2, boxW * 0.3);
    c.textAlign = 'left';
  }
}

/** Klasik: teks berbayang tanpa kotak, seperti stempel tanggal kamera analog. */
function layoutClassic(c, w, h, g, data, theme) {
  const { base, pad } = g;
  const color = theme.plain;
  const right = !($('position').value || '').endsWith('left');
  const top = ($('position').value || '').startsWith('top');

  const lines = [];
  const stamp = [data.dateShort, data.clock].filter(Boolean).join('  ');
  if (stamp) lines.push({ text: stamp, size: base * 1.25, weight: 700 });
  if (data.time) lines.push({ text: data.time.split(' ').pop(), size: base * 0.7, weight: 500 });
  if (data.headline) lines.push({ text: data.headline, size: base * 0.75, weight: 500 });
  if (data.coordsShort) lines.push({ text: data.coordsShort, size: base * 0.65, weight: 400 });
  if (data.altShort) lines.push({ text: `Ketinggian ${data.altShort}`, size: base * 0.65, weight: 400 });
  if (data.brand) lines.push({ text: data.brand, size: base * 0.62, weight: 600 });
  if (!lines.length) return;

  const textH = linesHeight(lines);
  const y = top ? pad : h - pad - textH;
  const x = right ? w - pad : pad;

  c.save();
  c.globalAlpha = Math.max(0.5, Number($('opacity').value) / 100);
  c.textAlign = right ? 'right' : 'left';
  c.shadowColor = 'rgba(0,0,0,.65)';
  c.shadowBlur = base * 0.35;
  c.shadowOffsetY = base * 0.06;
  let ty = y;
  for (const line of lines) {
    c.fillStyle = color;
    c.font = `${line.weight} ${line.size}px Arial, sans-serif`;
    c.fillText(line.text, x, ty, w - pad * 2);
    ty += line.size * 1.3;
  }
  c.restore();
  c.textAlign = 'left';
}

const LAYOUT_RENDERERS = {
  card: layoutCard,
  bigdate: layoutBigDate,
  compact: layoutCompact,
  bar: layoutBar,
  classic: layoutClassic,
};

function draw(mini) {
  const w = photo.naturalWidth;
  const h = photo.naturalHeight;
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(photo, 0, 0, w, h);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  const g = stampGeometry(w, h);
  const theme = STAMP_THEMES[$('theme').value] || STAMP_THEMES.dark;
  const key = layoutKey();
  const usableMini = LAYOUTS[key].usesMap && $('showMap').checked ? mini : null;

  LAYOUT_RENDERERS[key](ctx, w, h, g, stampData(), theme, usableMini);

  $('empty').classList.add('hidden');
  canvas.classList.remove('hidden');
}

let renderToken = 0;

async function render() {
  if (!hasPhoto) return;
  const token = ++renderToken;

  const lat = Number($('lat').value);
  const lon = Number($('lon').value);
  const zoom = Number($('mapZoom').value);
  const style = $('mapStyle').value;
  const { mapSide } = stampGeometry(photo.naturalWidth, photo.naturalHeight);
  const size = Math.round(mapSide);
  const wantMap = layoutUsesMap() && Number.isFinite(lat) && Number.isFinite(lon);
  const key = wantMap ? miniKey(lat, lon, zoom, style, size) : null;

  // Gambar dulu dengan peta yang sudah tersimpan agar pratinjau tetap responsif.
  draw(wantMap && miniCache.has(key) ? miniCache.get(key) : null);
  if (!wantMap || miniCache.has(key)) return;

  const mini = await getMiniMap(lat, lon, zoom, style, size);
  if (token !== renderToken) return;
  draw(mini);
  if (!mini) setStatus('Peta mini tidak bisa dimuat (jaringan diblokir?). Stempel tetap dibuat tanpa peta.', true);
}

/* ------------------------------------------------------------------ foto */

/** Zona waktu pilihan yang cocok dengan offset UTC dari EXIF, bila ada. */
function timezoneForOffset(minutes) {
  const match = { 420: 'Asia/Jakarta', 480: 'Asia/Makassar', 540: 'Asia/Jayapura' }[minutes];
  return match || null;
}

/** Isi form dari metadata EXIF foto. Mengembalikan daftar bagian yang terisi. */
async function applyExif(file) {
  let data = null;
  try {
    data = await readPhotoExif(file);
  } catch {
    return [];
  }
  if (!data) return [];

  const filled = [];
  if (data.wallClock) {
    const tz = data.utcOffsetMinutes !== null ? timezoneForOffset(data.utcOffsetMinutes) : null;
    if (tz) $('timezone').value = tz;
    $('datetime').value = data.wallClock;
    filled.push('waktu');
  }
  if (Number.isFinite(data.alt)) {
    setAltitude(data.alt, 'EXIF foto');
    filled.push('ketinggian');
  }
  if (Number.isFinite(data.lat) && Number.isFinite(data.lon)) {
    setPin(data.lat, data.lon, { move: true, geocode: $('autoPlace').checked });
    filled.push('lokasi');
  }
  return filled;
}

function loadPhotoFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { setStatus('File harus berupa gambar.', true); return; }
  photoFile = file;
  const url = URL.createObjectURL(file);
  photo.onload = async () => {
    hasPhoto = true;
    URL.revokeObjectURL(url);
    const size = `${photo.naturalWidth}×${photo.naturalHeight} px`;
    render();
    if (!$('useExif').checked) { setStatus(`Foto siap (${size}).`); return; }
    const filled = await applyExif(file);
    setStatus(filled.length
      ? `Foto siap (${size}). Dari EXIF: ${filled.join(', ')}.`
      : `Foto siap (${size}). Foto ini tidak memuat data EXIF GPS/waktu.`);
  };
  photo.onerror = () => { URL.revokeObjectURL(url); setStatus('Foto tidak bisa dibuka.', true); };
  photo.src = url;
}

$('photo').addEventListener('change', (e) => {
  loadPhotoFile(e.target.files?.[0]);
  e.target.value = '';      // agar memilih file yang sama lagi tetap terbaca
});

// Mencentang EXIF setelah foto termuat langsung menerapkannya.
$('useExif').addEventListener('change', async () => {
  if (!$('useExif').checked || !photoFile) return;
  const filled = await applyExif(photoFile);
  setStatus(filled.length
    ? `Dari EXIF foto: ${filled.join(', ')}.`
    : 'Foto ini tidak memuat data EXIF GPS/waktu.', !filled.length);
});

const dropzone = $('dropzone');
for (const zone of [dropzone, $('previewWrap')]) {
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); dropzone.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, () => dropzone.classList.remove('drag')));
  zone.addEventListener('drop', (e) => { e.preventDefault(); loadPhotoFile(e.dataTransfer?.files?.[0]); });
}

/* ------------------------------------------------------------- peta pin */

let map = null;
let marker = null;
let tileLayer = null;

function tileLayerFor(styleKey) {
  const style = styleOf(styleKey);
  const urls = {
    standard: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    humanitarian: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    topo: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  };
  return L.tileLayer(urls[styleKey] || urls.standard, {
    maxZoom: style.max,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
}

function currentLatLng() {
  const lat = Number($('lat').value);
  const lon = Number($('lon').value);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : [Number(SAMPLE.lat), Number(SAMPLE.lon)];
}

/** Muat Leaflet dari CDN cadangan bila CDN utama gagal. */
function ensureLeaflet() {
  if (typeof L !== 'undefined') return Promise.resolve(true);
  return new Promise((resolve) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve(typeof L !== 'undefined');
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

async function initMap() {
  if (!(await ensureLeaflet())) {
    $('map').innerHTML = '<p class="empty">Peta tidak bisa dimuat (Leaflet gagal diambil). Koordinat masih bisa diisi manual.</p>';
    updatePinInfo();
    return;
  }
  const start = currentLatLng();
  map = L.map('map', { zoomControl: true }).setView(start, Number($('mapZoom').value));
  tileLayer = tileLayerFor($('mapStyle').value).addTo(map);
  marker = L.marker(start, {
    draggable: true,
    icon: L.divIcon({ className: 'pin-icon', iconSize: [26, 26], iconAnchor: [13, 24] }),
  }).addTo(map);

  map.on('click', (e) => setPin(e.latlng.lat, e.latlng.lng, { move: false }));
  marker.on('dragend', () => {
    const p = marker.getLatLng();
    setPin(p.lat, p.lng, { move: false });
  });
  map.on('zoomend', () => {
    $('mapZoom').value = String(Math.min(18, Math.max(3, Math.round(map.getZoom()))));
    render();
  });
  setTimeout(() => map.invalidateSize(), 50);
  updatePinInfo();
}

function updatePinInfo() {
  const [lat, lon] = currentLatLng();
  $('pinInfo').textContent = `Pin: ${lat.toFixed(6)}, ${lon.toFixed(6)} — klik peta atau seret pin untuk memindahkan.`;
}

/** Sumber tunggal untuk perubahan koordinat. */
function setPin(lat, lon, { move = true, geocode = true } = {}) {
  $('lat').value = lat.toFixed(6);
  $('lon').value = lon.toFixed(6);
  if (marker) marker.setLatLng([lat, lon]);
  if (map && move) map.setView([lat, lon], Math.max(map.getZoom(), Number($('mapZoom').value)));
  updatePinInfo();
  render();
  if (geocode && $('autoPlace').checked) queueReverseGeocode(lat, lon);
  if (geocode && $('autoAlt').checked) queueElevation(lat, lon);
}

$('mapCenterBtn').onclick = () => {
  if (!map) return;
  const [lat, lon] = currentLatLng();
  map.setView([lat, lon], Number($('mapZoom').value));
};

$('mapStyle').addEventListener('change', () => {
  if (map) {
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = tileLayerFor($('mapStyle').value).addTo(map);
  }
  render();
});

/* --------------------------------------------------- geocoding Nominatim */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
let reverseTimer = null;
let reverseAbort = null;

function queueReverseGeocode(lat, lon) {
  clearTimeout(reverseTimer);
  reverseTimer = setTimeout(() => reverseGeocode(lat, lon), 550);
}

async function reverseGeocode(lat, lon) {
  reverseAbort?.abort();
  reverseAbort = new AbortController();
  setStatus('Mencari nama lokasi…');
  try {
    const url = `${NOMINATIM}/reverse?format=jsonv2&accept-language=id&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { signal: reverseAbort.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    $('place').value = data.display_name || `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    setStatus('Nama lokasi diperbarui. Silakan periksa kembali.');
    render();
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus('Nama lokasi otomatis gagal diambil; isi manual bila perlu.', true);
  }
}

/* ------------------------------------------------- deteksi ketinggian */

const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';
let elevationTimer = null;
let elevationAbort = null;

function setAltitude(meters, source) {
  $('alt').value = Number(meters).toFixed(1);
  $('altSource').textContent = source ? `dari ${source}` : '';
  render();
}

function queueElevation(lat, lon) {
  clearTimeout(elevationTimer);
  elevationTimer = setTimeout(() => lookupElevation(lat, lon, true), 600);
}

/** Ketinggian permukaan tanah pada koordinat pin (model elevasi ±90 m). */
async function lookupElevation(lat, lon, quiet) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    setStatus('Koordinat belum valid.', true);
    return;
  }
  elevationAbort?.abort();
  elevationAbort = new AbortController();
  $('altBtn').disabled = true;
  if (!quiet) setStatus('Mencari ketinggian permukaan…');
  try {
    const res = await fetch(`${ELEVATION_API}?latitude=${lat}&longitude=${lon}`,
      { signal: elevationAbort.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const meters = Array.isArray(data.elevation) ? data.elevation[0] : data.elevation;
    if (!Number.isFinite(meters)) throw new Error('data kosong');
    setAltitude(meters, 'data elevasi peta');
    setStatus(`Ketinggian permukaan: ${meters.toFixed(1)} m di atas permukaan laut.`);
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus('Ketinggian otomatis gagal diambil; isi manual bila perlu.', true);
  } finally {
    $('altBtn').disabled = false;
  }
}

$('altBtn').onclick = () => {
  const [lat, lon] = currentLatLng();
  lookupElevation(lat, lon, false);
};

$('alt').addEventListener('input', () => { $('altSource').textContent = ''; });

/* ------------------------------------------------------------- pencarian */

async function searchPlace() {
  const q = $('search').value.trim();
  if (!q) { setStatus('Tulis dulu nama tempat yang dicari.', true); return; }
  const list = $('results');
  $('searchBtn').disabled = true;
  setStatus('Mencari tempat…');
  try {
    const url = `${NOMINATIM}/search?format=jsonv2&accept-language=id&limit=6&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    list.innerHTML = '';
    if (!items.length) { list.classList.add('hidden'); setStatus('Tempat tidak ditemukan.', true); return; }
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item.display_name;             // textContent: aman dari HTML asing
      li.onclick = () => {
        $('place').value = item.display_name;
        list.classList.add('hidden');
        setPin(Number(item.lat), Number(item.lon), { move: true, geocode: false });
        setStatus('Lokasi dipilih dari hasil pencarian.');
      };
      list.appendChild(li);
    }
    list.classList.remove('hidden');
    setStatus(`${items.length} hasil ditemukan.`);
  } catch {
    setStatus('Pencarian gagal. Periksa koneksi internet.', true);
  } finally {
    $('searchBtn').disabled = false;
  }
}

$('searchBtn').onclick = searchPlace;
$('search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchPlace(); } });

/* -------------------------------------------------------------------- GPS */

function takeGps() {
  if (!navigator.geolocation) { setStatus('Browser ini tidak mendukung GPS.', true); return; }
  setStatus('Meminta izin lokasi…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, altitude } = pos.coords;
      if (altitude !== null && Number.isFinite(altitude)) setAltitude(altitude, 'GPS perangkat');
      setNow();
      setPin(latitude, longitude, { move: true });
      setStatus('Koordinat GPS berhasil diambil.');
    },
    (err) => setStatus('GPS gagal: ' + ({
      1: 'izin lokasi ditolak', 2: 'posisi tidak tersedia', 3: 'permintaan GPS timeout',
    }[err.code] || err.message), true),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
  );
}

$('gpsBtn').onclick = takeGps;

/* -------------------------------------------------------- unduh & salin */

/** Nama file: tanggal-bulan-tahun-jam sesuai waktu & zona yang diset. */
function outputName() {
  const tz = $('timezone').value;
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour12: false,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(currentInstant()).reduce((acc, x) => (acc[x.type] = x.value, acc), {});
  const hour = p.hour === '24' ? '00' : p.hour;
  const ext = $('format').value === 'image/png' ? 'png' : 'jpg';
  return `${p.day}-${p.month}-${p.year}-${hour}.${p.minute}.${p.second}.${ext}`;
}

async function exportBlob() {
  await render();
  return new Promise((resolve) => {
    const type = $('format').value;
    canvas.toBlob((blob) => resolve(blob), type, type === 'image/jpeg' ? 0.92 : undefined);
  });
}

$('downloadBtn').onclick = async () => {
  if (!hasPhoto) { setStatus('Pilih foto terlebih dahulu.', true); return; }
  const blob = await exportBlob();
  if (!blob) { setStatus('Gagal membuat gambar.', true); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = outputName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus('Unduhan foto dimulai.');
};

$('copyBtn').onclick = async () => {
  if (!hasPhoto) { setStatus('Pilih foto terlebih dahulu.', true); return; }
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    setStatus('Browser ini tidak mendukung salin gambar; gunakan tombol unduh.', true);
    return;
  }
  await render();
  canvas.toBlob(async (blob) => {
    if (!blob) { setStatus('Gagal membuat gambar.', true); return; }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatus('Hasil disalin ke clipboard.');
    } catch {
      setStatus('Salin ke clipboard ditolak browser; gunakan tombol unduh.', true);
    }
  }, 'image/png');
};

/* ------------------------------------------------------------------ reset */

$('resetBtn').onclick = () => {
  $('place').value = SAMPLE.place;
  $('headline').value = '';
  $('alt').value = SAMPLE.alt;
  $('brand').value = SAMPLE.brand;
  $('opacity').value = '84';
  $('scale').value = '1';
  $('theme').value = 'dark';
  $('layout').value = 'card';
  $('position').value = 'bottom-right';
  syncLayoutControls();
  $('mapStyle').value = DEFAULT_STYLE;
  $('mapZoom').value = '14';
  ['showBrand', 'showTime', 'showDate', 'showAlt', 'showCoords', 'showMap', 'autoPlace']
    .forEach((id) => { $(id).checked = true; });
  ['useExif', 'autoAlt'].forEach((id) => { $(id).checked = false; });
  $('altSource').textContent = '';
  setNow();
  setPin(Number(SAMPLE.lat), Number(SAMPLE.lon), { move: true, geocode: false });
  syncRangeLabels();
  setStatus('Contoh direset.');
};

/* ------------------------------------------------------------------ init */

[
  'place', 'headline', 'lat', 'lon', 'alt', 'datetime', 'timezone', 'opacity', 'scale',
  'brand', 'theme', 'layout', 'position', 'format', 'mapZoom', 'showBrand', 'showTime',
  'showDate', 'showAlt', 'showCoords', 'showMap',
].forEach((id) => $(id).addEventListener('input', render));

['lat', 'lon'].forEach((id) => $(id).addEventListener('change', () => {
  const [lat, lon] = currentLatLng();
  setPin(lat, lon, { move: true, geocode: false });
}));

$('mapZoom').addEventListener('change', () => {
  if (map) map.setZoom(Number($('mapZoom').value));
});

/** Kontrol peta mini dimatikan pada model stempel yang memang tidak memakainya. */
function syncLayoutControls() {
  const usesMap = LAYOUTS[layoutKey()].usesMap;
  ['showMap', 'mapStyle', 'mapZoom'].forEach((id) => { $(id).disabled = !usesMap; });
  $('showMap').closest('.checkrow').style.opacity = usesMap ? '' : '.5';
}
$('layout').addEventListener('change', syncLayoutControls);
syncLayoutControls();

function syncRangeLabels() {
  $('opacityVal').textContent = `${$('opacity').value}%`;
  $('zoomVal').textContent = $('mapZoom').value;
}
['opacity', 'mapZoom'].forEach((id) => $(id).addEventListener('input', syncRangeLabels));
syncRangeLabels();

// Peta perlu dihitung ulang saat lebar layar berubah (rotasi HP, resize).
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => map && map.invalidateSize(), 180);
});

$('autoAlt').addEventListener('change', () => {
  if (!$('autoAlt').checked) return;
  const [lat, lon] = currentLatLng();
  lookupElevation(lat, lon, false);
});

$('nowBtn').onclick = () => { setNow(); render(); };
$('timezone').addEventListener('change', () => render());

$('mapStyle').value = DEFAULT_STYLE;
if (!HAS_CARTO) {
  for (const opt of $('mapStyle').options) {
    if (['voyager', 'positron', 'darkmatter'].includes(opt.value)) {
      opt.textContent += ' — butuh CARTO_BASEMAP_KEY';
    }
  }
}

setNow();
initMap();
