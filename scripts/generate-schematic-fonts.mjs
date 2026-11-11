#!/usr/bin/env node
/**
 * Browser subsets and shared metrics for Metropolis and its DejaVu Sans
 * symbol fallback, and for the faces a Document may choose instead (#1725):
 * Liberation Serif (served as ICM Serif), Liberation Sans (ICM Sans) and
 * Latin Modern Roman (ICM Modern). Also writes the authored round-period face
 * for Node, and Latin Modern's TrueType subsets for the PDF and Node.
 *
 *   node scripts/generate-schematic-fonts.mjs [--check]
 *
 * Metropolis is read through a copy whose underscore nothing kerns
 * (scripts/unkern-metropolis-underscore.py); the committed sources stay as
 * published.
 *
 * Needs Python's fontTools (python3 -m fontTools.subset) with brotli, which
 * WOFF2 is compressed with (pip install fonttools brotli; the committed faces
 * were written with fontTools 4.60.2 and brotli 1.2.0). --check rebuilds
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

const STYLE_SUFFIXES = {
  plain: "Regular",
  bold: "Bold",
  italic: "Italic",
  boldItalic: "BoldItalic",
};

/**
 * The faces a Document may choose instead of Metropolis, each read from its
 * unmodified originals in `directory`. A subset is a modified copy, which
 * the OFL's Reserved Font Name (Liberation) and the GUST Font License (Latin
 * Modern) ask to be renamed: `renames` are the family names each subset's
 * name records replace, in turn, and `family` names its files. jsPDF embeds
 * TrueType outlines only, so a CFF face (`truetype`) also gets TrueType
 * subsets, `<family>-<style>.ttf`, for the PDF and Node.
 */
export const DOCUMENT_FONT_FACES = [
  {
    id: "serif",
    directory: "liberation-serif",
    family: "ICMSerif",
    renames: [["Liberation Serif", "ICM Serif"]],
    styles: {
      plain: "LiberationSerif-Regular.ttf",
      bold: "LiberationSerif-Bold.ttf",
      italic: "LiberationSerif-Italic.ttf",
      boldItalic: "LiberationSerif-BoldItalic.ttf",
    },
    metrics: "schematicSerifTextMetrics",
    metricsPath:
      "packages/derived/src/schematic-serif-text-metrics.generated.ts",
    coverage: "serifGlyphs",
    coveragePath: "packages/exporters/src/serif-coverage.generated.ts",
  },
  {
    id: "sans",
    directory: "liberation-sans",
    family: "ICMSans",
    renames: [["Liberation Sans", "ICM Sans"]],
    styles: {
      plain: "LiberationSans-Regular.ttf",
      bold: "LiberationSans-Bold.ttf",
      italic: "LiberationSans-Italic.ttf",
      boldItalic: "LiberationSans-BoldItalic.ttf",
    },
    metrics: "schematicSansTextMetrics",
    metricsPath:
      "packages/derived/src/schematic-sans-text-metrics.generated.ts",
    coverage: "sansGlyphs",
    coveragePath: "packages/exporters/src/sans-coverage.generated.ts",
  },
  {
    id: "latin-modern",
    directory: "latin-modern",
    family: "ICMModern",
    // The Macintosh full name first, then the family names.
    renames: [
      ["Latin Modern Roman 10", "ICM Modern"],
      ["Latin Modern Roman", "ICM Modern"],
      ["LM Roman 10", "ICM Modern"],
    ],
    styles: {
      plain: "lmroman10-regular.otf",
      bold: "lmroman10-bold.otf",
      italic: "lmroman10-italic.otf",
      boldItalic: "lmroman10-bolditalic.otf",
    },
    truetype: true,
    metrics: "schematicLatinModernTextMetrics",
    metricsPath:
      "packages/derived/src/schematic-latin-modern-text-metrics.generated.ts",
    coverage: "latinModernGlyphs",
    coveragePath: "packages/exporters/src/latin-modern-coverage.generated.ts",
  },
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

/** Metropolis with an unkerned underscore, read in place of the sources. */
function unkernedMetropolis() {
  const directory = mkdtempSync(join(tmpdir(), "metropolis-"));
  const result = spawnSync(
    "python3",
    [
      join(root, "scripts/unkern-metropolis-underscore.py"),
      join(output, "metropolis"),
      directory,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      `Cannot unkern the Metropolis underscore: ${result.stderr}`,
    );
  return directory;
}

function subset(face, directory, metropolis, source, flavor = "woff2") {
  const result = spawnSync(
    "python3",
    [
      "-m",
      "fontTools.subset",
      source ??
        join(face.startsWith("Metropolis-") ? metropolis : ttf, `${face}.ttf`),
      `--unicodes=${SCHEMATIC_FONT_UNICODES.join(",")}`,
      // WOFF2 is about a quarter smaller than WOFF, and every browser the
      // editor supports reads it (#1673).
      ...(flavor === "woff2" ? ["--flavor=woff2"] : []),
      // Hinting is most of each face; browsers that use it draw well
      // without, and the advances label measurement reads are unchanged.
      "--no-hinting",
      // Every name record, the copyright and licence with them, as the
      // licence asks of a copy.
      "--name-IDs=*",
      `--output-file=${join(
        directory,
        flavor === "woff2" ? `${face}.schematic.woff2` : `${face}.ttf`,
      )}`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      `fontTools could not subset ${face}: ${result.stderr || result.error}`,
    );
}

/** Run one of the font scripts on `path`, in place. */
function python(script, args, what) {
  const result = spawnSync(
    "python3",
    [join(root, "scripts", script), ...args],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error(`Cannot ${what}: ${result.stderr}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const directory = check
    ? mkdtempSync(join(tmpdir(), "schematic-fonts-"))
    : output;
  const metropolis = unkernedMetropolis();
  try {
    const stale = [];
    const period = Buffer.from(schematicRoundPeriodFontBase64, "base64");
    const periodPath = join(output, "ICMRoundPeriod.ttf");
    writeFileSync(join(directory, "ICMRoundPeriod.ttf"), period);
    if (check) {
      if (!readFileSync(periodPath).equals(period)) stale.push(periodPath);
    }
    for (const face of SCHEMATIC_FONT_FACES) {
      subset(face, directory, metropolis);
      if (!check) continue;
      const name = `${face}.schematic.woff2`;
      if (
        !readFileSync(join(directory, name)).equals(
          readFileSync(join(output, name)),
        )
      )
        stale.push(name);
    }
    for (const chosen of DOCUMENT_FONT_FACES)
      for (const [style, source] of Object.entries(chosen.styles)) {
        const face = `${chosen.family}-${STYLE_SUFFIXES[style]}`;
        const original = join(output, chosen.directory, source);
        const names = [];
        subset(face, directory, metropolis, original);
        names.push(`${face}.schematic.woff2`);
        if (chosen.truetype) {
          subset(face, directory, metropolis, original, "truetype");
          python(
            "convert-cff-to-truetype.py",
            [join(directory, `${face}.ttf`)],
            `convert ${face} to TrueType`,
          );
          names.push(`${face}.ttf`);
        }
        for (const name of names) {
          python(
            "rename-font-family.py",
            [join(directory, name), ...chosen.renames.flat()],
            `rename ${name}`,
          );
          if (
            check &&
            !readFileSync(join(directory, name)).equals(
              readFileSync(join(output, name)),
            )
          )
            stale.push(name);
        }
      }
    const nodeFaces = spawnSync(
      "python3",
      [
        join(root, "scripts/generate-headless-fonts.py"),
        metropolis,
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
        metropolis,
        ttf,
        JSON.stringify(SCHEMATIC_FONT_UNICODES),
      ],
      { encoding: "utf8" },
    );
    if (tables.status !== 0)
      throw new Error(`Cannot read schematic metrics: ${tables.stderr}`);
    const { metrics, primaryGlyphs } = JSON.parse(tables.stdout);
    const chosenTables = DOCUMENT_FONT_FACES.map((chosen) => {
      const result = spawnSync(
        "python3",
        [
          join(root, "scripts/generate-schematic-metrics.py"),
          join(output, chosen.directory),
          ttf,
          JSON.stringify(SCHEMATIC_FONT_UNICODES),
          JSON.stringify(chosen.styles),
        ],
        { encoding: "utf8" },
      );
      if (result.status !== 0)
        throw new Error(`Cannot read ${chosen.id} metrics: ${result.stderr}`);
      return { chosen, ...JSON.parse(result.stdout) };
    });
    for (const [path, declaration] of [
      [
        "packages/derived/src/schematic-text-metrics.generated.ts",
        `export const schematicTextMetrics = ${JSON.stringify(metrics)};`,
      ],
      [
        "packages/exporters/src/metropolis-coverage.generated.ts",
        `export const metropolisGlyphs = ${JSON.stringify(primaryGlyphs)};`,
      ],
      ...chosenTables.flatMap(({ chosen, ...tables }) => [
        [
          chosen.metricsPath,
          `export const ${chosen.metrics} = ${JSON.stringify(tables.metrics)};`,
        ],
        [
          chosen.coveragePath,
          `export const ${chosen.coverage} = ${JSON.stringify(tables.primaryGlyphs)};`,
        ],
      ]),
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
        `Schematic fonts: ${SCHEMATIC_FONT_FACES.length + 4 * DOCUMENT_FONT_FACES.length} faces ${check ? "current" : "written"}`,
      );
  } finally {
    if (check) rmSync(directory, { recursive: true, force: true });
    rmSync(metropolis, { recursive: true, force: true });
  }
}
