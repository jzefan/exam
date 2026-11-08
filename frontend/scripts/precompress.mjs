#!/usr/bin/env node
/**
 * Emit `.gz` siblings for every text asset in dist/.
 *
 * nginx `gzip_static on` then answers with the pre-compressed file directly:
 * no per-request CPU on the 2-core edge box, no recompression of the same
 * 178KB vendor chunk for every student. `gzip on` stays enabled as the fallback
 * for anything that has no .gz (or for clients without Accept-Encoding).
 *
 * Runs after `vite build`; nothing here is imported by the app.
 */
import { gzipSync } from "node:zlib";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIST = path.resolve(process.argv[2] ?? "dist");

// Already-compressed formats are skipped: gzipping them only burns build time.
const SKIP_EXTENSIONS = new Set([
  ".gz",
  ".br",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".zip",
  ".pdf",
  ".mp4",
  ".webm",
]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

let files = 0;
let rawBytes = 0;
let gzBytes = 0;

for await (const file of walk(DIST)) {
  if (SKIP_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    continue;
  }
  const source = await readFile(file);
  // Tiny files (a few hundred bytes) gain nothing and only add HTTP overhead.
  if (source.byteLength < 512) {
    continue;
  }
  const compressed = gzipSync(source, { level: 9 });
  if (compressed.byteLength >= source.byteLength) {
    continue;
  }
  await writeFile(`${file}.gz`, compressed);
  files += 1;
  rawBytes += source.byteLength;
  gzBytes += compressed.byteLength;
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)}MB`;
console.log(
  `precompress: ${files} files ${mb(rawBytes)} -> ${mb(gzBytes)} ` +
    `(${rawBytes ? Math.round((1 - gzBytes / rawBytes) * 100) : 0}% smaller)`,
);
