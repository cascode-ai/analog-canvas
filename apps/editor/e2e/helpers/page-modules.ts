/**
 * Modules a browser spec imports into the page by URL: component harnesses,
 * and storage modules exercised against the browser's own IndexedDB and
 * locks. The dev server serves them from source (the path here, under
 * apps/editor); scripts/build-e2e-editor.mjs builds each to
 * /e2e-harness/<name>.js. Use harness-url.ts for the URL.
 */
export const pageModules = {
  "simulation-code-harness": "e2e/helpers/simulation-code-harness.tsx",
  "simulation-output-harness": "e2e/helpers/simulation-output-harness.tsx",
  "browser-simulation-archive-store":
    "src/features/simulation/browser-simulation-archive-store.ts",
  "browser-simulation-artifact-store":
    "src/features/simulation/browser-simulation-artifact-store.ts",
  "browser-simulation-storage-lock":
    "src/features/simulation/browser-simulation-storage-lock.ts",
} as const;
