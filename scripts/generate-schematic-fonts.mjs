#!/usr/bin/env node
/**
 * Browser subsets and shared metrics for Metropolis and its DejaVu Sans
 * symbol fallback. Also writes the authored round-period face for Node.
 *
 *   node scripts/generate-schematic-fonts.mjs [--check]
 *
 * Needs Python's fontTools (python3 -m fontTools.subset). --check rebuilds
 * into a temporary directory and fails when a committed face differs. A
 * local check: the faces change only with this script or the font package.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { schematicRoundPeriodFontBase64 } from "../packages/derived/src/schematic-font.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "packages/exporters/fonts");
const require = createRequire(join(root, "packages/exporters/package.json"));
const ttf = join(
  dirname(require.resolve("dejavu-fonts-ttf/package.json")),
  "ttf",
);

export const SCHEMATIC_FONT_FACES = [
  "Metropolis-Regular",
  "Metropolis-Bold",
  "Metropolis-RegularItalic",
  "Metropolis-BoldItalic",
  "DejaVuSans",
  "DejaVuSans-Bold",
  "DejaVuSans-Oblique",
  "DejaVuSans-BoldOblique",
];

const NODE_FONT_FACES = ["Regular", "RegularItalic", "Bold", "BoldItalic"].map(
  (style) => `ICMSchematic-${style}.ttf`,
);

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
      join(
        face.startsWith("Metropolis-") ? join(output, "metropolis") : ttf,
        `${face}.ttf`,
      ),
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
    const period = Buffer.from(schematicRoundPeriodFontBase64, "base64");
    const periodPath = join(output, "ICMRoundPeriod.ttf");
    writeFileSync(join(directory, "ICMRoundPeriod.ttf"), period);
    if (check) {
      if (!readFileSync(periodPath).equals(period)) stale.push(periodPath);
    }
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
    const nodeFaces = spawnSync(
      "python3",
      [
        join(root, "scripts/generate-headless-fonts.py"),
        join(output, "metropolis"),
        ttf,
        join(directory, "ICMRoundPeriod.ttf"),
        directory,
      ],
      { encoding: "utf8" },
    );
    if (nodeFaces.status !== 0)
      throw new Error(`Cannot compose headless fonts: ${nodeFaces.stderr}`);
    if (check)
      for (const name of NODE_FONT_FACES)
        if (
          !readFileSync(join(directory, name)).equals(
            readFileSync(join(output, name)),
          )
        )
          stale.push(name);
    const tables = spawnSync(
      "python3",
      [
        join(root, "scripts/generate-schematic-metrics.py"),
        join(output, "metropolis"),
        ttf,
        JSON.stringify(SCHEMATIC_FONT_UNICODES),
      ],
      { encoding: "utf8" },
    );
    if (tables.status !== 0)
      throw new Error(`Cannot read schematic metrics: ${tables.stderr}`);
    const { metrics, primaryGlyphs } = JSON.parse(tables.stdout);
    for (const [path, declaration] of [
      [
        "packages/derived/src/schematic-text-metrics.generated.ts",
        `export const schematicTextMetrics = ${JSON.stringify(metrics)};`,
      ],
      [
        "packages/exporters/src/metropolis-coverage.generated.ts",
        `export const metropolisGlyphs = ${JSON.stringify(primaryGlyphs)};`,
      ],
    ]) {
      const content = await format(
        `// Generated by scripts/generate-schematic-fonts.mjs. Do not edit.\n${declaration}\n`,
        { parser: "typescript" },
      );
      const destination = join(root, path);
      if (check) {
        if (readFileSync(destination, "utf8") !== content) stale.push(path);
      } else writeFileSync(destination, content);
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
