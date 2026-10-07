#!/usr/bin/env node
/**
 * The DejaVu Sans faces a browser draws schematic text in (#1413): the four
 * faces of dejavu-fonts-ttf, the version whose tables label measurement uses
 * (packages/derived/src/fraction-text-metrics.ts), subset to the characters
 * schematic text uses and written as WOFF to packages/exporters/fonts/.
 *
 *   node scripts/generate-schematic-fonts.mjs [--check]
 *
 * Needs Python's fontTools (python3 -m fontTools.subset). --check rebuilds
 * into a temporary directory and fails when a committed face differs. A
 * local check: the faces change only with this script or the font package.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "packages/exporters/fonts");
const require = createRequire(join(root, "packages/exporters/package.json"));
const ttf = join(
  dirname(require.resolve("dejavu-fonts-ttf/package.json")),
  "ttf",
);

export const SCHEMATIC_FONT_FACES = [
  "DejaVuSans",
  "DejaVuSans-Bold",
  "DejaVuSans-Oblique",
  "DejaVuSans-BoldOblique",
];

/**
 * Latin with its accents and combining marks, Greek, punctuation, scripts,
 * letterlike symbols (Ω, ℃), arrows, mathematical operators and geometric
 * shapes. Keep in step with SCHEMATIC_FONT_UNICODE_RANGE in
 * packages/exporters/src/browser-fonts.ts.
 */
export const SCHEMATIC_FONT_UNICODES = [
  "U+0020-007E",
  "U+00A0-017F",
  "U+0300-036F",
  "U+0370-03FF",
  "U+2010-2027",
  "U+2030-205E",
  "U+2070-209F",
  "U+2100-214F",
  "U+2190-21FF",
  "U+2200-22FF",
  "U+25A0-25FF",
];

function subset(face, directory) {
  const result = spawnSync(
    "python3",
    [
      "-m",
      "fontTools.subset",
      join(ttf, `${face}.ttf`),
      `--unicodes=${SCHEMATIC_FONT_UNICODES.join(",")}`,
      "--flavor=woff",
      // Hinting is most of each face; browsers that use it draw well
      // without, and the advances label measurement reads are unchanged.
      "--no-hinting",
      // Every name record, the copyright and licence with them, as the
      // licence asks of a copy.
      "--name-IDs=*",
      `--output-file=${join(directory, `${face}.schematic.woff`)}`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      `fontTools could not subset ${face}: ${result.stderr || result.error}`,
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const directory = check
    ? mkdtempSync(join(tmpdir(), "schematic-fonts-"))
    : output;
  try {
    const stale = [];
    for (const face of SCHEMATIC_FONT_FACES) {
      subset(face, directory);
      if (!check) continue;
      const name = `${face}.schematic.woff`;
      if (
        !readFileSync(join(directory, name)).equals(
          readFileSync(join(output, name)),
        )
      )
        stale.push(name);
    }
    if (stale.length) {
      console.error(
        `Schematic fonts differ from their source: ${stale.join(", ")}. Run node scripts/generate-schematic-fonts.mjs`,
      );
      process.exitCode = 1;
    } else
      console.log(
        `Schematic fonts: ${SCHEMATIC_FONT_FACES.length} faces ${check ? "current" : "written"}`,
      );
  } finally {
    if (check) rmSync(directory, { recursive: true, force: true });
  }
}
