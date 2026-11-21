// The headless drawing workspace (#1498) as one Node module:
// apps/editor/src/headless with every @icm package it reaches, from source.
// scripts/package-headless.mjs writes it for the workspace build and
// scripts/package-mcp.mjs as an optional release asset.
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../..");
// The MCP version the editor's Agent code reports, given as the MCP bundle
// gives it. Left to the code's fallback, the bundle would carry the whole
// distribution declaration, release digest included, so stamping the digest
// would change the very package it describes.
const { version } = JSON.parse(
  readFileSync(resolve(root, "config/agent-mcp-distribution.json"), "utf8"),
);

const HEADLESS_BUNDLE_NAME = "analog-canvas-headless.mjs";

const EXPORTERS = resolve(root, "packages/exporters");
const RASTER_ASSETS_MODULE = resolve(
  EXPORTERS,
  "src/headless-raster-assets.ts",
);
const EDITOR = resolve(root, "apps/editor");
const RNL_ASSETS_MODULE = resolve(EDITOR, "src/headless/rnl-assets.ts");
const RNL_PACKAGES = resolve(EDITOR, "src/features/netlist-export");
/** The DejaVu faces packages/exporters/src/headless-text.ts falls back to. */
const DEJAVU_FONTS = [
  "DejaVuSans.ttf",
  "DejaVuSans-Bold.ttf",
  "DejaVuSans-Oblique.ttf",
  "DejaVuSans-BoldOblique.ttf",
  "DejaVuSerif.ttf",
  "DejaVuSerif-Bold.ttf",
  "DejaVuSerif-Italic.ttf",
  "DejaVuSerif-BoldItalic.ttf",
];

/**
 * The files the WebAssembly rasterizer reads (#1498 local figures), keyed as
 * headless-raster-assets.ts asks for them: resvg's module, the schematic and
 * Document faces in packages/exporters/fonts, and the DejaVu fallbacks.
 */
export function headlessRasterAssetFiles() {
  const exporters = createRequire(resolve(EXPORTERS, "package.json"));
  const fonts = resolve(EXPORTERS, "fonts");
  const dejavu = resolve(
    dirname(exporters.resolve("dejavu-fonts-ttf/package.json")),
    "ttf",
  );
  const ttf = (directory) =>
    readdirSync(resolve(fonts, directory))
      .filter((file) => file.endsWith(".ttf"))
      .map((file) => (directory ? `${directory}/${file}` : file));
  return {
    wasm: exporters.resolve("@resvg/resvg-wasm/index_bg.wasm"),
    subset: exporters.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"),
    fonts: {
      ...Object.fromEntries(
        [...ttf(""), ...ttf("liberation-serif"), ...ttf("liberation-sans")].map(
          (file) => [`exporters/${file}`, resolve(fonts, file)],
        ),
      ),
      ...Object.fromEntries(
        DEJAVU_FONTS.map((file) => [`dejavu/${file}`, resolve(dejavu, file)]),
      ),
    },
  };
}

/** The bundle carries those files inline, compressed, so it stands alone. */
function inlineRasterAssets() {
  const packed = (path) =>
    JSON.stringify(
      gzipSync(readFileSync(path), { level: 9 }).toString("base64"),
    );
  return {
    name: "inline-headless-raster-assets",
    enforce: "pre",
    load(id) {
      if (resolve(id.split("?")[0]) !== RASTER_ASSETS_MODULE) return null;
      const { wasm, subset, fonts } = headlessRasterAssetFiles();
      return `import { gunzipSync } from "node:zlib";
const WASM = ${packed(wasm)};
const SUBSET_WASM = ${packed(subset)};
const FONTS = {
${Object.entries(fonts)
  .map(([key, path]) => `  ${JSON.stringify(key)}: ${packed(path)},`)
  .join("\n")}
};
const unpack = (text) => new Uint8Array(gunzipSync(Buffer.from(text, "base64")));
export async function loadResvgWasm() {
  return unpack(WASM);
}
export async function loadHarfBuzzSubsetWasm() {
  return unpack(SUBSET_WASM);
}
export async function loadHeadlessFont(font) {
  const text = FONTS[\`\${font.source}/\${font.file}\`];
  if (!text) throw new Error(\`The headless bundle carries no font \${font.file}\`);
  return unpack(text);
}
`;
    },
  };
}

/**
 * The RNL core's WebAssembly and the Canvas package the editor ships. A local
 * workspace writes SPICE+RNL and Spectre+RNL without a page, so the bundle
 * carries both itself, as it carries the rasterizer's assets.
 */
function inlineRnlAssets(runtimeDirectory) {
  const packed = (path) =>
    JSON.stringify(
      gzipSync(readFileSync(path), { level: 9 }).toString("base64"),
    );
  const wasm = resolve(runtimeDirectory, "rnl_runtime_wasm.wasm");
  const packages = Object.fromEntries(
    readdirSync(RNL_PACKAGES)
      .filter((file) => /^analog-canvas-extensions-.+\.rnl$/u.test(file))
      .map((file) => [
        file.slice("analog-canvas-extensions-".length, -".rnl".length),
        resolve(RNL_PACKAGES, file),
      ]),
  );
  return {
    name: "inline-headless-rnl-assets",
    enforce: "pre",
    load(id) {
      if (resolve(id.split("?")[0]) !== RNL_ASSETS_MODULE) return null;
      return `import { gunzipSync } from "node:zlib";
const WASM = ${packed(wasm)};
const PACKAGES = {
${Object.entries(packages)
  .map(([version, path]) => `  ${JSON.stringify(version)}: ${packed(path)},`)
  .join("\n")}
};
const unpack = (text) => new Uint8Array(gunzipSync(Buffer.from(text, "base64")));
export async function loadHeadlessRnlCoreWasm() {
  return unpack(WASM);
}
export async function loadHeadlessRnlPackage(version) {
  const text = PACKAGES[version];
  if (!text) throw new Error(\`No Canvas RNL package \${version} is bundled\`);
  return unpack(text);
}
`;
    },
  };
}

/**
 * One file, with no chunks beside it, so it can be copied on its own. What
 * the editor loads only on demand (formula typesetting, browser-only export)
 * is inlined and still evaluated only when called.
 */
export async function bundleHeadless(
  outDir,
  { emptyOutDir = true, fileName = HEADLESS_BUNDLE_NAME } = {},
) {
  const editorRequire = createRequire(resolve(EDITOR, "package.json"));
  const runtimeDirectory = dirname(
    editorRequire.resolve("@rich-netlist/runtime/package.json"),
  );
  const licenseDirectory = resolve(runtimeDirectory, "LICENSES");
  const notices = [
    resolve(runtimeDirectory, "LICENSE"),
    ...readdirSync(licenseDirectory)
      .sort()
      .map((file) => resolve(licenseDirectory, file)),
  ]
    .map((file) => readFileSync(file, "utf8").trim())
    .join("\n\n");
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    plugins: [inlineRasterAssets(), inlineRnlAssets(runtimeDirectory)],
    define: { __ANALOG_CANVAS_MCP_VERSION__: JSON.stringify(version) },
    resolve: { conditions: ["development"] },
    ssr: {
      noExternal: true,
      resolve: {
        conditions: ["development"],
        externalConditions: ["development"],
      },
    },
    build: {
      ssr: resolve(root, "apps/editor/src/headless/index.ts"),
      outDir,
      emptyOutDir,
      target: "node24",
      minify: false,
      rollupOptions: {
        output: { entryFileNames: fileName, codeSplitting: false },
      },
    },
  });
  const bundle = resolve(outDir, fileName);
  appendFileSync(
    bundle,
    "\n/*! @rich-netlist/runtime license notices\n" +
      notices.replaceAll("*/", "* /") +
      "\n*/\n",
  );
  return bundle;
}
