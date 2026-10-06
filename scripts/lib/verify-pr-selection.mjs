/** Which changed paths each step of `pnpm verify:pr` looks at. */

/** What `pnpm format:check` covers: code, JSON and YAML, not Markdown. */
/**
 * The files `format:check` reads, by the same globs as package.json, so the
 * merge queue and this check agree. docs/, fixtures/ and worker/ are not
 * among them: generated files there, such as the Agent API artifacts and the
 * Agent distribution manifest, keep their generator's layout.
 */
const FORMAT_CHECKED = [
  /^apps\/.+\.(?:ts|tsx|json|css|html)$/u,
  /^packages\/.+\.(?:ts|tsx|json)$/u,
  /^references\/.+\.json$/u,
  /^scripts\/.+\.mjs$/u,
  /^[^/]+\.(?:json|yaml)$/u,
];

export function formattedPaths(paths) {
  return paths.filter((path) =>
    FORMAT_CHECKED.some((pattern) => pattern.test(path)),
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
 * Whether the unit step runs strictly. `vitest related` passes when it finds
 * no test, as a change no test imports needs, but that also passes a
 * describe left empty by deleting its last case, which the full run in the
 * merge queue fails ("No test found in suite"). A changed test file is
 * always found, so a change with one runs strictly.
 */
export function strictUnitRun(paths) {
  return paths.some((path) => /\.test\.[cm]?[jt]sx?$/u.test(path));
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

/**
 * The census check groups a change needs, by what it touches: copying and
 * placement (`copy`, which includes supply markers), instance labels
 * (`transform`, a quarter turn and a mirror the labels must follow) and
 * netlist extraction (`netlist`, with the Gallery's netlist mark).
 */
export function censusChecks(paths) {
  const checks = new Set();
  for (const path of censusPaths(paths)) {
    if (path.startsWith("packages/netlist/src/")) checks.add("netlist");
    else if (path.startsWith("apps/editor/src/features/")) checks.add("copy");
    else checks.add("transform");
  }
  return [...checks].sort();
}

/** Spec files under the editor's Playwright directory. */
export function browserSpecPaths(paths) {
  return paths.filter((path) =>
    /^apps\/editor\/e2e\/.+\.spec\.ts$/u.test(path),
  );
}

/**
 * Line numbers, in the new file, that a unified diff with `-U0` touches. A
 * pure deletion counts as the line it followed.
 */
export function changedLines(diffText) {
  const lines = [];
  for (const match of diffText.matchAll(
    /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gmu,
  )) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count === 0) lines.push(Math.max(start, 1));
    else
      for (let line = start; line < start + count; line += 1) lines.push(line);
  }
  return lines;
}

/**
 * Where a Playwright spec declares its tests: a `test(` whose first argument
 * is the title, so a `test.skip(condition, …)` or `test.slow()` inside a body
 * does not count, nor does `test.describe(`.
 */
export function testStartLines(source) {
  return source
    .split("\n")
    .flatMap((text, index) =>
      /^\s*test(?:\.(?:only|skip|fixme|fail))?\(\s*["'`]/u.test(text)
        ? [index + 1]
        : [],
    );
}

/**
 * The browser cases a change touches in one spec file, as Playwright
 * `file:line` arguments: each test a changed line falls in, counted from its
 * `test(` to the next one. A change above the first test, such as an import
 * or a helper the tests share, runs the whole file.
 */
export function changedBrowserCases(file, source, lines) {
  if (!lines.length) return [];
  const starts = testStartLines(source);
  if (!starts.length || lines.some((line) => line < starts[0])) return [file];
  const touched = new Set(
    lines.map((line) => starts.findLast((start) => start <= line)),
  );
  return [...touched]
    .sort((left, right) => left - right)
    .map((line) => `${file}:${line}`);
}
