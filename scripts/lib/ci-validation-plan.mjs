import { readFileSync, readdirSync } from "node:fs";

function unique(values) {
  return [...new Set(values)];
}

function implementationPaths(plan) {
  const documentation = new Set(plan.groupPaths.documentation ?? []);
  return plan.paths.filter((path) => !documentation.has(path));
}

/**
 * The browser smoke for product paths no focused route covers: scoped crash
 * recovery, and two cases that start a new circuit with its Library and live
 * Netlist and place a part that connects to a pin, through the edit engine,
 * derived connectivity and the saved Project. A case is named by its title;
 * Playwright selects one test by its file and line.
 */
const fallbackBrowserSpecs = ["apps/editor/e2e/runtime-crash-safety.spec.ts"];
const fallbackBrowserTests = [
  [
    "apps/editor/e2e/component-insert.spec.ts",
    "a part set down beside a pin is pulled onto it and connects",
  ],
  [
    "apps/editor/e2e/component-insert.spec.ts",
    "new circuits open Library and Netlist, keep the saved preference, and mirror Library annotations in the menu",
  ],
];

/**
 * The `file:line` argument that selects the test a spec declares under
 * `title`. A renamed or removed test fails the plan instead of silently
 * selecting nothing.
 */
export function locateSpecTest(
  spec,
  title,
  read = (path) => readFileSync(path, "utf8"),
) {
  const declaration = `test(${JSON.stringify(title)},`;
  const index = read(spec)
    .split("\n")
    .findIndex((line) => line.trim().startsWith(declaration));
  if (index < 0) throw new Error(`${spec} declares no test "${title}"`);
  return `${spec}:${index + 1}`;
}

function fallbackBrowserArgs(focusedArgs) {
  const selected = new Set(focusedArgs);
  return [
    ...fallbackBrowserSpecs,
    // A spec the focused routes already run whole needs no single case.
    ...fallbackBrowserTests
      .filter(([spec]) => !selected.has(spec))
      .map(([spec, title]) => locateSpecTest(spec, title)),
  ];
}

function canAffectBrowser(path) {
  // Unit/module tests and package metadata do not ship to the browser. Their
  // production owners still select browser coverage when those owners change,
  // while Core contracts validate these files directly.
  if (/\.test\.(?:mjs|ts|tsx)$/u.test(path)) return false;
  if (/(?:^|\/)package\.json$/u.test(path) || path === "pnpm-lock.yaml")
    return false;
  if (path.startsWith("apps/local-host/")) return false;
  return (
    /^(?:apps\/editor|apps\/mcp-server|packages|worker)\//u.test(path) ||
    /^(?:vite\.config\.[^/]+|wrangler(?:\.[^/]+)?\.jsonc)$/u.test(path)
  );
}

function browserImplementationPaths(plan) {
  return implementationPaths(plan).filter(canAffectBrowser);
}

function browserSelectionGates(plan) {
  const browserPaths = new Set(browserImplementationPaths(plan));
  // The gate plan also classifies unit tests under their production owners.
  // In a mixed batch, only browser-impacting paths may activate those owners'
  // browser contracts; Core still validates every implementation/test path.
  return (plan.selectedGates ?? plan.gates).filter((gate) =>
    (gate.groups ?? []).some((group) =>
      (plan.groupPaths[group] ?? []).some((path) => browserPaths.has(path)),
    ),
  );
}

function e2eArgs(plan) {
  return unique(
    browserSelectionGates(plan).flatMap((gate) => gate.ci?.e2eArgs ?? []),
  ).sort();
}

function e2eCoveredPaths(plan) {
  return new Set(
    browserSelectionGates(plan)
      .filter((gate) => (gate.ci?.e2eArgs?.length ?? 0) > 0)
      .flatMap((gate) =>
        (gate.groups ?? []).flatMap((group) => plan.groupPaths[group] ?? []),
      ),
  );
}

/**
 * Convert the repository gate plan into the intentionally smaller PR choice.
 * Core contracts still run for every implementation change. Pull requests and
 * their merge-queue groups run affected browser contracts, with a small product
 * fallback for unmapped browser paths. CI never forces the complete suite;
 * `--force-full` remains for local planning.
 */
export function planCiValidation(plan, { forceFull = false } = {}) {
  if (forceFull) {
    return {
      heavy: true,
      browser: true,
      mode: "full",
      e2eArgs: [],
      reasons: ["full validation was requested by the workflow event"],
    };
  }

  const changedImplementationPaths = implementationPaths(plan);
  if (changedImplementationPaths.length === 0) {
    return {
      heavy: false,
      browser: false,
      mode: "documentation",
      e2eArgs: [],
      reasons: ["the change contains no implementation paths"],
    };
  }

  const changedBrowserPaths = browserImplementationPaths(plan);
  if (changedBrowserPaths.length === 0) {
    return {
      heavy: true,
      browser: false,
      mode: "non-browser",
      e2eArgs: [],
      reasons: ["the implementation change cannot affect the browser product"],
    };
  }

  const focusedArgs = e2eArgs(plan);
  const coveredPaths = e2eCoveredPaths(plan);
  const uncoveredPaths = changedBrowserPaths.filter(
    (path) => !coveredPaths.has(path),
  );
  if (focusedArgs.length === 0 || uncoveredPaths.length > 0) {
    return {
      heavy: true,
      browser: true,
      mode: "fallback",
      e2eArgs: unique([
        ...focusedArgs,
        ...fallbackBrowserArgs(focusedArgs),
      ]).sort(),
      reasons: [
        ...focusedArgs.map((arg) => `focused browser contract: ${arg}`),
        "the small browser fallback covers unmapped product impact",
        ...uncoveredPaths.map((path) => `uncovered browser impact: ${path}`),
      ],
    };
  }

  return {
    heavy: true,
    browser: true,
    mode: "focused",
    e2eArgs: focusedArgs,
    reasons: focusedArgs.map((arg) => `focused browser contract: ${arg}`),
  };
}

/**
 * Tests a spec file declares, read from its source. A loop that declares
 * several counts once, so this is a floor; it only sizes the shards.
 */
export function countSpecTests(path) {
  try {
    return (
      readFileSync(path, "utf8").match(
        /^\s*test(?:\.(?:only|skip|fixme))?\(/gmu,
      ) ?? []
    ).length;
  } catch {
    return 0;
  }
}

const E2E_DIRECTORY = "apps/editor/e2e";
/** Tests per shard: a shard of about this many finds its end in a few minutes. */
const BROWSER_TESTS_PER_SHARD = 25;
const MIN_BROWSER_SHARDS = 2;
const MAX_BROWSER_SHARDS = 8;
/** A selection this small runs on one shard; a second would run nothing. */
const SINGLE_SHARD_TESTS = 8;

/**
 * Tests the browser arguments select: a spec file counts its declared
 * tests, a `file:line` argument one, and anything else none.
 */
function countSelectedTests(e2eArgs, countTests = countSpecTests) {
  return e2eArgs.reduce(
    (sum, argument) =>
      sum +
      (argument.endsWith(".spec.ts")
        ? countTests(argument)
        : /\.spec\.ts:\d+$/u.test(argument)
          ? 1
          : 0),
    0,
  );
}

/**
 * Size the browser shards to the tests selected, about 25 to a shard, from
 * two for a small change up to eight; a selection of a few tests runs on
 * one. The slowest shard sets the queue's
 * pace, and Playwright splits the selected tests into equal runs, so a large
 * selection on few shards made one of them wait on a whole slow spec.
 */
export function browserShardMatrix(plan, countTests = countSpecTests) {
  const specs =
    plan.mode === "full"
      ? readdirSync(E2E_DIRECTORY)
          .filter((name) => name.endsWith(".spec.ts"))
          .map((name) => `${E2E_DIRECTORY}/${name}`)
      : plan.e2eArgs;
  const tests = countSelectedTests(specs, countTests);
  const count =
    tests <= SINGLE_SHARD_TESTS
      ? 1
      : Math.min(
          MAX_BROWSER_SHARDS,
          Math.max(
            MIN_BROWSER_SHARDS,
            Math.ceil(tests / BROWSER_TESTS_PER_SHARD),
          ),
        );
  return Array.from({ length: count }, (_, index) => `${index + 1}/${count}`);
}

export function formatCiValidationPlan(plan) {
  const lines = [
    "CI validation plan",
    `Mode: ${plan.mode}`,
    `Implementation jobs: ${plan.heavy ? "enabled" : "skipped"}`,
    `Browser job: ${plan.browser ? "enabled" : "skipped"}`,
    `Browser selection: ${plan.e2eArgs.length > 0 ? plan.e2eArgs.join(" ") : plan.mode === "full" ? "all specs" : "none"}`,
    ...plan.reasons.map((reason) => `  - ${reason}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function formatCiValidationPlanMarkdown(plan) {
  const browserSelection =
    plan.e2eArgs.length > 0
      ? plan.e2eArgs.map((arg) => `\`${arg}\``).join(", ")
      : plan.mode === "full"
        ? "all specs"
        : "none";
  return [
    "## CI execution plan",
    "",
    `- Mode: **${plan.mode}**`,
    `- Implementation jobs: ${plan.heavy ? "enabled" : "skipped"}`,
    `- Browser job: ${plan.browser ? "enabled" : "skipped"}`,
    `- Browser selection: ${browserSelection}`,
    "",
    ...plan.reasons.map((reason) => `- ${reason}`),
    "",
  ].join("\n");
}
