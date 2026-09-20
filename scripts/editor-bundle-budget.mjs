// Editor and Gallery first-paint byte budgets.
//
// Each eager set is the static shell plus the matching assets injected by the
// path-gated preload script. That script is generated from Vite's real chunk
// graph by `apps/editor/build/editor-preload.ts`, so this measures the shipping
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
  process.argv.find((argument) => argument.startsWith("--dist="))?.slice(7) ??
    "apps/editor/dist",
);
const budgetPath = resolve("fixtures/editor-bundle-budget/report.json");

const html = await readFile(join(distDir, "index.html"), "utf8");
const shell = new Set();
for (const match of html.matchAll(
  /<(?:script|link)[^>]*?(?:src|href)="(\/assets\/[^"]+)"/g,
)) {
  shell.add(match[1]);
}
if (shell.size === 0) {
  throw new Error(
    `No eager assets found in ${join(distDir, "index.html")}. Was the editor built?`,
  );
}

function routeAssets(route) {
  const match = new RegExp(
    `const ${route}Resources = (\\[\\[.*?\\]\\]);`,
    "s",
  ).exec(html);
  if (!match) {
    throw new Error(`No ${route} preload resources found in index.html`);
  }
  return new Set([...shell, ...JSON.parse(match[1]).map((entry) => entry[1])]);
}

const kib = (value) => Math.round((value / 1024) * 10) / 10;

async function measure(route) {
  const rows = [];
  for (const href of routeAssets(route)) {
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
  return {
    rows,
    totals: {
      files: rows.length,
      rawKib: kib(rows.reduce((sum, row) => sum + row.raw, 0)),
      gzipKib: kib(rows.reduce((sum, row) => sum + row.gzip, 0)),
      brotliKib: kib(rows.reduce((sum, row) => sum + row.brotli, 0)),
    },
  };
}

const measuredRoutes = {
  editor: await measure("editor"),
  gallery: await measure("gallery"),
};

for (const [route, { rows, totals }] of Object.entries(measuredRoutes)) {
  process.stdout.write(
    `\n/${route} eager payload: ${totals.files} files, ` +
      `${totals.rawKib} KiB raw, ${totals.gzipKib} KiB gzip, ${totals.brotliKib} KiB brotli\n`,
  );
  process.stdout.write("  largest (gzip):\n");
  for (const row of rows.slice(0, 8)) {
    process.stdout.write(
      `    ${String(kib(row.gzip)).padStart(7)} KiB  ${row.file}\n`,
    );
  }
}

if (!check) {
  // Ceilings carry a little slack so an unrelated rename does not trip them;
  // the point is to catch a step change, not to pin today's number.
  const ceiling = (value) => Math.ceil(value * 1.02);
  const routeReport = (totals) => ({
    budget: {
      files: ceiling(totals.files),
      rawKib: ceiling(totals.rawKib),
      gzipKib: ceiling(totals.gzipKib),
      brotliKib: ceiling(totals.brotliKib),
    },
    measured: totals,
  });
  const report = {
    version: "0.2.0",
    note: "Ceilings for the /editor and / Gallery first-paint payloads. Raising one requires a recorded reason; a faster or slower machine is not one.",
    routes: {
      editor: routeReport(measuredRoutes.editor.totals),
      gallery: routeReport(measuredRoutes.gallery.totals),
    },
  };
  await mkdir(resolve("fixtures/editor-bundle-budget"), { recursive: true });
  await writeFile(budgetPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\nWrote ceilings to ${budgetPath}\n`);
} else {
  const report = JSON.parse(await readFile(budgetPath, "utf8"));
  const failures = [];
  for (const [route, measurement] of Object.entries(measuredRoutes)) {
    for (const key of ["files", "rawKib", "gzipKib", "brotliKib"]) {
      const ceiling = report.routes?.[route]?.budget?.[key];
      const measured = measurement.totals[key];
      if (typeof ceiling !== "number") {
        failures.push(`/${route} ${key}: budget is missing`);
      } else if (measured > ceiling) {
        failures.push(
          `/${route} ${key}: ${measured} exceeds the ${ceiling} ceiling`,
        );
      }
    }
  }
  if (failures.length > 0) {
    process.stdout.write(
      `\nRoute eager payload exceeded its budget:\n  ${failures.join("\n  ")}\n` +
        `\nLargest Gallery chunks:\n${measuredRoutes.gallery.rows
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
