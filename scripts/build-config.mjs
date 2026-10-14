/**
 * Membuat config.js dari environment variable saat build (Vercel).
 *
 *   CARTO_BASEMAP_KEY=... node scripts/build-config.mjs
 *
 * File config.js sengaja tidak di-commit supaya kunci tidak masuk ke repo.
 * Bila env kosong, config.js tetap dibuat tanpa kunci dan aplikasi memakai
 * tile OpenStreetMap.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const key = (process.env.CARTO_BASEMAP_KEY || '').trim();
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'config.js');

writeFileSync(out, `// Dibuat otomatis oleh scripts/build-config.mjs — jangan di-commit.
window.APP_CONFIG = ${JSON.stringify({ cartoKey: key }, null, 2)};
`);

console.log(key
  ? `config.js dibuat dengan kunci CARTO (…${key.slice(-4)}).`
  : 'config.js dibuat TANPA kunci CARTO — peta memakai tile OpenStreetMap.');
