// Rasterises public/icons/icon.svg to PNGs. Needs `sharp` (resolved from the parent repo); run: node web/make-icons.mjs
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../package.json', import.meta.url));
const sharp = require('sharp');
const dir = fileURLToPath(new URL('./public/icons/', import.meta.url));
const svg = readFileSync(dir + 'icon.svg');
const full = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toFile(dir + `icon-${size}.png`);
await full(192);
await full(512);
// iOS applies its own rounding: ship a full-bleed square.
const flat = Buffer.from(svg.toString().replace('rx="112"', 'rx="0"'));
await sharp(flat, { density: 384 }).resize(180, 180).png().toFile(dir + 'apple-touch-icon.png');
// maskable: content inside the central safe zone on a full-bleed background.
const inner = await sharp(flat, { density: 384 }).resize(360, 360).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#b04a27' } })
  .composite([{ input: inner, left: 76, top: 76 }]).png().toFile(dir + 'icon-maskable-512.png');
writeFileSync(dir + '.generated', 'by web/make-icons.mjs\n');
