/** Which changed paths each step of `pnpm verify:pr` looks at. */

/** What `pnpm format:check` covers: code, JSON and YAML, not Markdown. */
export function formattedPaths(paths) {
  return paths.filter((path) =>
    /\.(?:[cm]?[jt]sx?|json|jsonc|ya?ml|css)$/u.test(path),
  );
}

/** Files `vitest related` can trace: workspace code and its tests. */
export function unitSourcePaths(paths) {
  return paths.filter(
    (path) =>
      /^(?:apps|packages|worker|scripts|containers)\//u.test(path) &&
      /\.(?:[cm]?[jt]sx?)$/u.test(path) &&
      !/(?:^|\/)e2e\//u.test(path) &&
      !/\.generated\.[cm]?[jt]s$/u.test(path),
  );
}

/**
 * Paths for which AGENTS.md runs the Gallery census: copying, placement,
 * instance labels and netlist extraction.
 */
export function censusPaths(paths) {
  return paths.filter(
    (path) =>
      path.startsWith("apps/editor/src/features/clipboard/") ||
      path.startsWith("apps/editor/src/features/component-insert/") ||
      path === "packages/derived/src/instance-label-placement.ts" ||
      path === "packages/edit-engine/src/transaction-instance-annotations.ts" ||
      (path.startsWith("packages/netlist/src/") && !/\.test\.ts$/u.test(path)),
  );
}
