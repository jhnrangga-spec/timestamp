/* GPS Timestamp Studio — stempel GPS + peta mini di atas foto.
   Semua pemrosesan foto terjadi di browser; hanya tile peta & geocoding
   yang mengambil data dari OpenStreetMap. */

const $ = (id) => document.getElementById(id);

const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const photo = new Image();
let hasPhoto = false;

const SAMPLE = {
  place: 'Jailolo, Halmahera Barat, Maluku Utara, Indonesia',
  lat: '1.096827',
  lon: '127.470366',
  alt: '22.4',
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

/* ------------------------------------------------------------------- tabs */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.tabpanel').forEach((p) => {
      p.classList.toggle('is-active', p.dataset.panel === tab.dataset.tab);
    });
    if (tab.dataset.tab === 'pin' && map) setTimeout(() => map.invalidateSize(), 60);
  };
});

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
  dark:   { bg: '0,0,0',       title: '#ffffff', body: '#eaeaea', accent: null },
  light:  { bg: '255,255,255', title: '#101620', body: '#39445a', accent: null },
  accent: { bg: '0,0,0',       title: '#ffffff', body: '#eaeaea', accent: '#76e0c2' },
};

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

function draw(mini) {
  const w = photo.naturalWidth;
  const h = photo.naturalHeight;
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(photo, 0, 0, w, h);

  const { base, pad, mapSide } = stampGeometry(w, h);
  const theme = STAMP_THEMES[$('theme').value] || STAMP_THEMES.dark;
  const d = currentInstant();
  const tz = $('timezone').value;

  const place = $('place').value.trim() || 'Lokasi tidak diketahui';
  const headline = $('headline').value.trim() || place.split(',').slice(0, 2).join(',').trim();
  const withMap = $('showMap').checked && !!mini;

  const panelW = w - pad * 2;
  const innerW = panelW - pad * 2;
  const textW = Math.max(base * 6, innerW - (withMap ? mapSide + base * 0.9 : 0));

  // --- susun baris teks ---
  const lines = [];
  ctx.font = `700 ${base * 1.18}px Arial, sans-serif`;
  for (const t of wrapText(ctx, headline, textW, 1)) {
    lines.push({ text: t, size: base * 1.18, weight: 700, color: theme.title, lh: 1.32 });
  }
  if (place && place !== headline) {
    ctx.font = `400 ${base * 0.78}px Arial, sans-serif`;
    for (const t of wrapText(ctx, place, textW, 2)) {
      lines.push({ text: t, size: base * 0.78, weight: 400, color: theme.body, lh: 1.3 });
    }
  }
  if ($('showCoords').checked) {
    const text = `Lat ${coordLabel($('lat').value.trim(), 'N', 'S')}   Long ${coordLabel($('lon').value.trim(), 'E', 'W')}`;
    lines.push({ text, size: base * 0.8, weight: 500, color: theme.body, lh: 1.32 });
  }
  if ($('showAlt').checked) {
    const alt = $('alt').value.trim() || '—';
    lines.push({ text: `Ketinggian ${alt} meter`, size: base * 0.78, weight: 400, color: theme.body, lh: 1.32 });
  }
  if ($('showDate').checked || $('showTime').checked) {
    const bits = [];
    if ($('showDate').checked) bits.push(fmtDate(d, tz));
    if ($('showTime').checked) bits.push(`${fmtTime(d, tz)} ${tzLabel(d, tz)}`);
    lines.push({ text: bits.join('  ·  '), size: base * 0.8, weight: 500, color: theme.title, lh: 1.32 });
  }
  if ($('showTime').checked) {
    lines.push({ text: `${gmtOffsetLabel(d, tz)}  ·  GMT ${fmtTime(d, 'UTC')}`, size: base * 0.72, weight: 400, color: theme.body, lh: 1.3 });
  }

  const textH = lines.reduce((sum, l) => sum + l.size * l.lh, 0);
  const contentH = Math.max(withMap ? mapSide : 0, textH);
  const panelH = contentH + pad * 1.2;
  const x = pad;
  const y = h - panelH - pad * 0.8;
  const radius = Math.min(base * 0.8, panelH * 0.22);

  // --- latar kotak ---
  ctx.save();
  ctx.fillStyle = `rgba(${theme.bg},${Number($('opacity').value) / 100})`;
  ctx.beginPath();
  ctx.roundRect(x, y, panelW, panelH, radius);
  ctx.fill();
  if (theme.accent) {
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(3, base * 0.14), panelH, radius * 0.4);
    ctx.fillStyle = theme.accent;
    ctx.fill();
  }
  ctx.restore();

  // --- peta mini ---
  let textX = x + pad;
  if (withMap) {
    const mx = x + pad;
    const my = y + (panelH - mapSide) / 2;
    const r = Math.min(base * 0.45, mapSide * 0.12);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(mx, my, mapSide, mapSide, r);
    ctx.clip();
    ctx.drawImage(mini, mx, my, mapSide, mapSide);
    ctx.restore();
    ctx.save();
    ctx.lineWidth = Math.max(1, base * 0.06);
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath();
    ctx.roundRect(mx, my, mapSide, mapSide, r);
    ctx.stroke();
    ctx.restore();
    textX = mx + mapSide + base * 0.9;
  }

  // --- teks ---
  ctx.textBaseline = 'top';
  let ty = y + (panelH - textH) / 2;
  for (const line of lines) {
    ctx.fillStyle = line.color;
    ctx.font = `${line.weight} ${line.size}px Arial, sans-serif`;
    ctx.fillText(line.text, textX, ty, textW);
    ty += line.size * line.lh;
  }

  // --- label kamera, di atas kotak ---
  if ($('showBrand').checked) {
    const brand = $('brand').value.trim();
    if (brand) {
      ctx.font = `700 ${base * 0.72}px Arial, sans-serif`;
      const bw = Math.min(panelW * 0.6, ctx.measureText(brand).width + base * 1.1);
      const bh = base * 1.3;
      const bx = x + panelW - bw;
      const by = y - bh - base * 0.3;
      ctx.fillStyle = 'rgba(245,245,245,.92)';
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, bh * 0.28);
      ctx.fill();
      ctx.fillStyle = '#1d2430';
      ctx.textBaseline = 'middle';
      ctx.fillText(brand, bx + base * 0.55, by + bh / 2, bw - base * 1.1);
      ctx.textBaseline = 'top';
    }
  }

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
  const wantMap = $('showMap').checked && Number.isFinite(lat) && Number.isFinite(lon);
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

function loadPhotoFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { setStatus('File harus berupa gambar.', true); return; }
  const url = URL.createObjectURL(file);
  photo.onload = () => {
    hasPhoto = true;
    URL.revokeObjectURL(url);
    setStatus(`Foto siap (${photo.naturalWidth}×${photo.naturalHeight} px).`);
    render();
  };
  photo.onerror = () => { URL.revokeObjectURL(url); setStatus('Foto tidak bisa dibuka.', true); };
  photo.src = url;
}

$('photo').addEventListener('change', (e) => loadPhotoFile(e.target.files?.[0]));

const wrap = $('previewWrap');
['dragenter', 'dragover'].forEach((ev) => wrap.addEventListener(ev, (e) => {
  e.preventDefault(); wrap.classList.add('drag');
}));
['dragleave', 'drop'].forEach((ev) => wrap.addEventListener(ev, () => wrap.classList.remove('drag')));
wrap.addEventListener('drop', (e) => { e.preventDefault(); loadPhotoFile(e.dataTransfer?.files?.[0]); });

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
      if (altitude !== null && Number.isFinite(altitude)) $('alt').value = altitude.toFixed(1);
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
$('mapGpsBtn').onclick = takeGps;

/* -------------------------------------------------------- unduh & salin */

function outputName() {
  return `foto-gps-timestamp.${$('format').value === 'image/png' ? 'png' : 'jpg'}`;
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
  $('mapStyle').value = DEFAULT_STYLE;
  $('mapZoom').value = '14';
  ['showBrand', 'showTime', 'showDate', 'showAlt', 'showCoords', 'showMap', 'autoPlace']
    .forEach((id) => { $(id).checked = true; });
  setNow();
  setPin(Number(SAMPLE.lat), Number(SAMPLE.lon), { move: true, geocode: false });
  setStatus('Contoh direset.');
};

/* ------------------------------------------------------------------ init */

[
  'place', 'headline', 'lat', 'lon', 'alt', 'datetime', 'timezone', 'opacity', 'scale',
  'brand', 'theme', 'format', 'mapZoom', 'showBrand', 'showTime', 'showDate', 'showAlt',
  'showCoords', 'showMap',
].forEach((id) => $(id).addEventListener('input', render));

['lat', 'lon'].forEach((id) => $(id).addEventListener('change', () => {
  const [lat, lon] = currentLatLng();
  setPin(lat, lon, { move: true, geocode: false });
}));

$('mapZoom').addEventListener('change', () => {
  if (map) map.setZoom(Number($('mapZoom').value));
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
