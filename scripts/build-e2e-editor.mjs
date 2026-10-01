#!/usr/bin/env node
/**
 * Build the editor that browser tests load (the default; see
 * playwright.config.ts).
 *
 * The bundle behaves as the dev server does (development React, local
 * fallbacks, no service worker, every surface enabled), but a page loads a
 * few prebuilt chunks instead of hundreds of modules transformed on first
 * request. It is written to apps/editor/dist-e2e and never shipped.
 *
 * The modules some specs import into the page (e2e/helpers/page-modules.ts)
 * are built beside it at /e2e-harness/<name>.js; e2e/helpers/harness-url.ts
 * names the right URL.
 */
import { fileURLToPath } from "node:url";

import { pageModules } from "../apps/editor/e2e/helpers/page-modules.ts";

// import.meta.env.DEV follows NODE_ENV, not --mode, so set it before Vite loads.
process.env.NODE_ENV = "development";
const { build } = await import("vite");

const root = fileURLToPath(new URL("../apps/editor/", import.meta.url));
const harnesses = Object.keys(pageModules);

/**
 * An entry imported as a module gets no <link> for the styles it imports, as
 * an HTML page would. Load them before the module finishes evaluating, so a
 * harness is laid out by the time a test mounts and measures it.
 */
const harnessStyles = {
  name: "e2e-harness-styles",
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk" || !harnesses.includes(chunk.name)) continue;
      const styles = new Set();
      const seen = new Set();
      const visit = (name) => {
        const item = bundle[name];
        if (seen.has(name) || item?.type !== "chunk") return;
        seen.add(name);
        item.viteMetadata?.importedCss.forEach((css) => styles.add(css));
        item.imports.forEach(visit);
      };
      visit(chunk.fileName);
      if (!styles.size) continue;
      chunk.code =
        `await Promise.all(${JSON.stringify([...styles])}.map((href) =>` +
        ` new Promise((resolve, reject) => document.head.append(` +
        `Object.assign(document.createElement("link"), {` +
        ` rel: "stylesheet", href: "/" + href, onload: resolve, onerror: reject })))));\n` +
        chunk.code;
    }
  },
};

await build({
  root,
  mode: "development",
  logLevel: "warn",
  plugins: [harnessStyles],
  build: {
    outDir: "dist-e2e",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        index: `${root}index.html`,
        ...Object.fromEntries(
          harnesses.map((name) => [name, `${root}${pageModules[name]}`]),
        ),
      },
      // A harness is imported for its mount function.
      preserveEntrySignatures: "exports-only",
      output: {
        entryFileNames: (chunk) =>
          harnesses.includes(chunk.name)
            ? "e2e-harness/[name].js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});
