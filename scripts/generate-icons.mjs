#!/usr/bin/env node
/**
 * Generates the PWA + Apple-touch icons from the SVG sources in /public/icons.
 * Run with: node scripts/generate-icons.mjs
 */
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

async function makePng(svgPath, outPath, size) {
  const svg = await readFile(svgPath);
  const buf = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 163, g: 230, b: 53, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(outPath, buf);
  console.log(`✓ ${outPath} (${size}x${size}, ${buf.length} bytes)`);
}

async function main() {
  const rounded = resolve(root, "public/icons/icon.svg");
  const flat = resolve(root, "public/icons/icon-padded.svg");

  await makePng(rounded, resolve(root, "public/icons/icon-192.png"), 192);
  await makePng(rounded, resolve(root, "public/icons/icon-512.png"), 512);
  await makePng(flat, resolve(root, "public/icons/apple-touch-icon.png"), 180);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
