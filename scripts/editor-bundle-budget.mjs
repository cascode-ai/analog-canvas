// Editor first-paint byte budget.
//
// The eager set is whatever `/editor` and `/g/<id>` fetch before the first
// schematic pixel: the static shell plus every asset the path-gated preload
// script injects. That script is generated from Vite's real chunk graph by
// `apps/editor/build/editor-preload.ts`, so this measures the shipping
// decision, not a guess about it.
//
//   node scripts/editor-bundle-budget.mjs           # report, rewrite ceilings
//   node scripts/editor-bundle-budget.mjs --check   # fail on regression
//
// A budget is a ceiling, not an exact manifest: content hashes move on every
// unrelated build, so an exact comparison would fail constantly and be
// ignored. Raising a ceiling needs a recorded reason in the commit, the same
// policy `docs/specs/performance.md` states for the timing budgets.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

const check = process.argv.includes("--check");
const distDir = resolve(
  process.argv.find((a) => a.startsWith("--dist="))?.slice(7) ??
    "apps/editor/dist",
);
const budgetPath = resolve("fixtures/editor-bundle-budget/report.json");

const html = await readFile(join(distDir, "index.html"), "utf8");

/** Assets `/editor` fetches before it can paint. */
const eager = new Set();
// Static shell: the module entry, static modulepreloads and stylesheets.
for (const match of html.matchAll(
  /<(?:script|link)[^>]*?(?:src|href)="(\/assets\/[^"]+)"/g,
)) {
  eager.add(match[1]);
}
// The path-gated inline preload: [["modulepreload","/assets/x.js"], ...]
for (const match of html.matchAll(
  /\["(?:modulepreload|preload)","(\/assets\/[^"]+)"\]/g,
)) {
  eager.add(match[1]);
}
if (eager.size === 0) {
  throw new Error(
    `No eager assets found in ${join(distDir, "index.html")}. Was the editor built?`,
  );
}

const rows = [];
for (const href of eager) {
  const path = join(distDir, href.replace(/^\//u, ""));
  const bytes = await readFile(path);
  rows.push({
    file: basename(href),
    raw: bytes.byteLength,
    gzip: gzipSync(bytes, { level: 9 }).byteLength,
    brotli: brotliCompressSync(bytes).byteLength,
  });
}
rows.sort((left, right) => right.gzip - left.gzip);

const kib = (value) => Math.round((value / 1024) * 10) / 10;
const totals = {
  files: rows.length,
  rawKib: kib(rows.reduce((sum, row) => sum + row.raw, 0)),
  gzipKib: kib(rows.reduce((sum, row) => sum + row.gzip, 0)),
  brotliKib: kib(rows.reduce((sum, row) => sum + row.brotli, 0)),
};

process.stdout.write(
  `\n/editor eager payload: ${totals.files} files, ` +
    `${totals.rawKib} KiB raw, ${totals.gzipKib} KiB gzip, ${totals.brotliKib} KiB brotli\n`,
);
process.stdout.write("  largest (gzip):\n");
for (const row of rows.slice(0, 8)) {
  process.stdout.write(
    `    ${String(kib(row.gzip)).padStart(7)} KiB  ${row.file}\n`,
  );
}

if (!check) {
  // Ceilings carry a little slack so an unrelated rename does not trip them;
  // the point is to catch a step change, not to pin today's number.
  const ceiling = (value) => Math.ceil(value * 1.02);
  const report = {
    version: "0.1.0",
    note: "Ceilings for the /editor first-paint payload. Raising one requires a recorded reason; a faster or slower machine is not one.",
    budget: {
      files: totals.files,
      rawKib: ceiling(totals.rawKib),
      gzipKib: ceiling(totals.gzipKib),
      brotliKib: ceiling(totals.brotliKib),
    },
    measured: totals,
  };
  await mkdir(resolve("fixtures/editor-bundle-budget"), { recursive: true });
  await writeFile(budgetPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\nWrote ceilings to ${budgetPath}\n`);
} else {
  const report = JSON.parse(await readFile(budgetPath, "utf8"));
  const failures = [];
  for (const key of ["files", "rawKib", "gzipKib", "brotliKib"]) {
    const ceiling = report.budget[key];
    const measured = totals[key];
    if (measured > ceiling) {
      failures.push(`${key}: ${measured} exceeds the ${ceiling} ceiling`);
    }
  }
  if (failures.length > 0) {
    process.stdout.write(
      `\nEditor eager payload exceeded its budget:\n  ${failures.join("\n  ")}\n` +
        `\nLargest chunks:\n${rows
          .slice(0, 8)
          .map(
            (row) => `  ${String(kib(row.gzip)).padStart(7)} KiB  ${row.file}`,
          )
          .join("\n")}\n` +
        `\nIf the growth is intended, raise the ceiling in ${budgetPath} and say why in the commit.\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("\nWithin budget.\n");
  }
}
