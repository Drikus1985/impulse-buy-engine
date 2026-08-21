#!/usr/bin/env node
/**
 * Stamps the built service worker with the files it has to pre-cache.
 *
 * A service worker only intercepts requests made *after* it activates, so on a
 * first visit the app's own JavaScript and CSS are fetched before it is
 * running and never reach the cache. The next load with no signal then finds a
 * cached shell pointing at assets that are not there. Naming the built files at
 * build time — their names are content-hashed and unknown until then — fixes
 * that, and doubles as the cache version, so every deploy retires the last
 * cache instead of serving a stale mix.
 *
 * Runs automatically after `npm run build`.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SW = path.join(DIST, 'sw.js');

if (!fs.existsSync(SW)) {
  console.error('No dist/sw.js — run the build first.');
  process.exit(1);
}

/** Every static file the app needs, as scope-relative paths. */
function collect(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...collect(path.join(dir, entry.name), `${rel}/`));
    } else if (entry.name !== 'sw.js') {
      out.push(rel);
    }
  }
  return out;
}

const assets = collect(DIST).sort();
const version = crypto.createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);

const source = fs.readFileSync(SW, 'utf8');
const stamped = source
  .replace('__PRECACHE_ASSETS__', JSON.stringify(assets))
  .replace('__CACHE_VERSION__', `anf-${version}`);

if (stamped === source) {
  console.error('Service worker has no placeholders to fill — did public/sw.js change?');
  process.exit(1);
}

fs.writeFileSync(SW, stamped);
console.log(`sw.js  cache anf-${version}, ${assets.length} files pre-cached`);
