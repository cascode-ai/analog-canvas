import { readFileSync, readdirSync } from "node:fs";
import { strictUnitRun, unitSourcePaths } from "./verify-pr-selection.mjs";

function unique(values) {
  return [...new Set(values)];
}

const TEST_FILE = /\.test\.(?:[cm]?[jt]sx?)$/u;
const CI_INFRA_PATH =
  /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|vitest\.config\.ts|tsconfig[^/]*\.json|\.github\/workflows\/|config\/validation-gates\.json|scripts\/(?:ci-plan|check-core-results|ci-package-build|test-standalone-setup)\.mjs|scripts\/lib\/(?:ci-validation-plan|ci-package-build|validation-gates|verify-pr-selection)\.mjs)$/u;

const STANDALONE_SCRIPT_PATH =
  /^scripts\/(?:analyze-native-simulation-examples|build-native-simulation-examples|native-example-runner|run-native-simulation-examples|resource-seed-runtime|simulation-control-runtime)/u;

const RELEASE_SCRIPT_PATH =
  /^scripts\/(?:package-|editor-|visual-golden|export-golden|pwa-icons|agent-api-artifacts|mcp-release|check-mcp-distribution|lib\/(?:headless-bundle|mcp-release-integrity))/u;

const FULL_UNIT_SHARDS = ["1/5", "2/5", "3/5", "4/5", "5/5"];
const MAX_AFFECTED_UNIT_SOURCES = 60;

function readStandaloneTestSet() {
  try {
    const source = readFileSync("vitest.config.ts", "utf8");
    const block = /const standaloneTests = \[([\s\S]*?)\];/u.exec(source)?.[1];
    return new Set(
      block ? [...block.matchAll(/"([^"]+)"/gu)].map((match) => match[1]) : [],
    );
  } catch {
    return new Set();
  }
}

const STANDALONE_TESTS = readStandaloneTestSet();

function canAffectRegionalPython(path) {
  return (
    CI_INFRA_PATH.test(path) ||
    path.startsWith("containers/") ||
    /^wrangler(?:\.[^/]+)?\.jsonc$/u.test(path) ||
    path.startsWith("worker/regional-") ||
    path.startsWith("scripts/regional-") ||
    path === "scripts/python-tests.mjs"
  );
}

const UNIT_BUILT_PACKAGE_PATH =
  /^packages\/(?:model|derived|devices|symbols|components|project-protocol|netlist|spice|spice-run|simulation-service)\//u;

const UNIT_BUILT_WORKER_PATH =
  /^worker\/(?:index|resource-|gallery-do|component-library-do|simulation)/u;

function canAffectUnitBuilt(path) {
  return (
    CI_INFRA_PATH.test(path) ||
    STANDALONE_TESTS.has(path) ||
    (UNIT_BUILT_PACKAGE_PATH.test(path) && !TEST_FILE.test(path)) ||
    (UNIT_BUILT_WORKER_PATH.test(path) && !TEST_FILE.test(path)) ||
    path.startsWith("apps/editor/src/examples/") ||
    path === "apps/editor/package.json" ||
    path.startsWith("config/") ||
    /^containers\/(?:ngspice|canvas-cn)\//u.test(path) ||
    STANDALONE_SCRIPT_PATH.test(path) ||
    path.startsWith("scripts/lib/")
  );
}

function canAffectPerformance(path) {
  return (
    CI_INFRA_PATH.test(path) ||
    (/^packages\/(?:model|derived|edit-engine|render-svg|symbols|components|agent-adapter|project-protocol|spice|devices|math-typesetting)\//u.test(
      path,
    ) &&
      !TEST_FILE.test(path)) ||
    (/^apps\/editor\/src\/(?:canvas|document|agent|features\/clipboard)\//u.test(
      path,
    ) &&
      !TEST_FILE.test(path)) ||
    path.startsWith("apps/editor/benchmarks/") ||
    path === "scripts/performance-baseline.mjs" ||
    path === "scripts/measure-edit-workloads.mjs" ||
    /^scripts\/lib\/(?:scaling-|edit-performance|diagnostic-scaling)/u.test(
      path,
    ) ||
    /^fixtures\/(?:performance|spice-baseline)\//u.test(path)
  );
}

const EDITOR_RUNTIME_PACKAGE_PATH =
  /^packages\/(?:model|derived|edit-engine|render-svg|exporters|symbols|components|devices|math-typesetting|project-protocol|spice|netlist|rnl|agent-adapter)\//u;

const GOLDEN_PACKAGE_PATH =
  /^packages\/(?:model|derived|render-svg|exporters|symbols|components|math-typesetting)\//u;

const AGENT_ARTIFACT_PACKAGE_PATH =
  /^packages\/(?:agent-adapter|model|devices|components|symbols)\//u;

const MCP_PACKAGE_PATH =
  /^packages\/(?:agent-adapter|model|derived|edit-engine|devices|symbols|components|project-protocol|netlist|spice|rnl|render-svg|exporters)\//u;

function isEditorSource(path) {
  return (
    path.startsWith("apps/editor/") &&
    !path.startsWith("apps/editor/e2e/") &&
    !TEST_FILE.test(path)
  );
}

function canAffectReleaseDesktop(path) {
  return (
    CI_INFRA_PATH.test(path) ||
    (path.startsWith("apps/desktop/") && !TEST_FILE.test(path)) ||
    isEditorSource(path) ||
    (EDITOR_RUNTIME_PACKAGE_PATH.test(path) && !TEST_FILE.test(path)) ||
    /^vite\.desktop\.config\./u.test(path)
  );
}

function canAffectReleaseEditor(path) {
  return (
    CI_INFRA_PATH.test(path) ||
    isEditorSource(path) ||
    (EDITOR_RUNTIME_PACKAGE_PATH.test(path) && !TEST_FILE.test(path)) ||
    /^fixtures\/editor-production-smoke\//u.test(path) ||
    /^scripts\/editor-/u.test(path) ||
    /^vite(?:\.[^/]+)?\.config\./u.test(path)
  );
}

function canAffectReleaseGolden(path) {
  return (
    CI_INFRA_PATH.test(path) ||
    (GOLDEN_PACKAGE_PATH.test(path) && !TEST_FILE.test(path)) ||
    (path.startsWith("fixtures/") &&
      !path.startsWith("fixtures/editor-production-smoke/")) ||
    /^scripts\/(?:visual-golden|export-golden|pwa-icons)/u.test(path)
  );
}

function canAffectReleaseAgentArtifacts(path) {
  return (
    CI_INFRA_PATH.test(path) ||
    (AGENT_ARTIFACT_PACKAGE_PATH.test(path) && !TEST_FILE.test(path)) ||
    (path.startsWith("apps/mcp-server/") && !TEST_FILE.test(path)) ||
    path === "scripts/agent-api-artifacts.mjs"
  );
}

function canAffectReleaseMcp(path) {
  return (
    CI_INFRA_PATH.test(path) ||
    (path.startsWith("apps/mcp-server/") && !TEST_FILE.test(path)) ||
    (path.startsWith("apps/editor/src/agent/") && !TEST_FILE.test(path)) ||
    (MCP_PACKAGE_PATH.test(path) && !TEST_FILE.test(path)) ||
    path === "config/agent-mcp-distribution.json" ||
    /^scripts\/(?:package-mcp|package-release|mcp-release|check-mcp-distribution|lib\/(?:headless-bundle|mcp-release-integrity))/u.test(
      path,
    )
  );
}

const MCP_BROWSER_SPECS = new Set([
  "apps/editor/e2e/agent-connection.spec.ts",
  "apps/editor/e2e/sg13g2-simulation.spec.ts",
]);

function browserSelectionNeedsMcp(mode, e2eArgs) {
  if (mode === "full") return true;
  return e2eArgs.some((arg) => MCP_BROWSER_SPECS.has(arg.split(":")[0]));
}

function allCoreScopes(enabled) {
  return {
    regionalPython: enabled,
    unitBuilt: enabled,
    performance: enabled,
    release: enabled,
    releaseDesktop: enabled,
    releaseEditor: enabled,
    releaseGolden: enabled,
    releaseAgentArtifacts: enabled,
    releaseMcp: enabled,
    build: enabled,
    unitMode: enabled ? "full" : "none",
    unitArgs: [],
    unitStrict: false,
  };
}

function isE2eSpec(path) {
  return /^apps\/editor\/e2e\/.+\.spec\.[cm]?[jt]sx?$/u.test(path);
}

function isE2eHelper(path) {
  return (
    path.startsWith("apps/editor/e2e/") &&
    /\.(?:[cm]?[jt]sx?)$/u.test(path) &&
    !isE2eSpec(path)
  );
}

function planCoreScopes(
  plan,
  changedImplementationPaths,
  { forceFull, exists },
) {
  if (
    forceFull ||
    plan.requiresFull ||
    changedImplementationPaths.some((path) => CI_INFRA_PATH.test(path))
  ) {
    return allCoreScopes(true);
  }

  const regionalPython = changedImplementationPaths.some(
    canAffectRegionalPython,
  );
  const unitBuilt = changedImplementationPaths.some(canAffectUnitBuilt);
  const performance = changedImplementationPaths.some(canAffectPerformance);
  const releaseDesktop = changedImplementationPaths.some(
    canAffectReleaseDesktop,
  );
  const releaseEditor = changedImplementationPaths.some(canAffectReleaseEditor);
  const releaseGolden = changedImplementationPaths.some(canAffectReleaseGolden);
  const releaseAgentArtifacts = changedImplementationPaths.some(
    canAffectReleaseAgentArtifacts,
  );
  const releaseMcp = changedImplementationPaths.some(canAffectReleaseMcp);
  const release =
    releaseDesktop ||
    releaseEditor ||
    releaseGolden ||
    releaseAgentArtifacts ||
    releaseMcp;
  const build = unitBuilt || performance || release;
  const flags = {
    regionalPython,
    unitBuilt,
    performance,
    release,
    releaseDesktop,
    releaseEditor,
    releaseGolden,
    releaseAgentArtifacts,
    releaseMcp,
    build,
  };

  // Include non-spec e2e helpers (e.g. bipolar-project.ts, label-census.ts)
  // because unit tests import them, and exclude standalone tests (handled by
  // core_unit_built) so core_unit never demands a match in modules/isolated.
  const baseSources = unique([
    ...unitSourcePaths(changedImplementationPaths),
    ...changedImplementationPaths.filter(isE2eHelper),
  ]).filter((path) => !STANDALONE_TESTS.has(path));

  // Subprocess-tested CLI scripts (spawnSync/execFileSync) have no static ES
  // import graph; attach their sibling *.test.mjs when present.
  const siblingScriptTests = baseSources
    .filter(
      (path) => /^scripts\/[^/]+\.mjs$/u.test(path) && !TEST_FILE.test(path),
    )
    .map((path) => path.replace(/\.mjs$/u, ".test.mjs"))
    .filter((testPath) => !STANDALONE_TESTS.has(testPath) && exists(testPath));
  const sources = unique([...baseSources, ...siblingScriptTests]);

  const accounted = new Set([
    ...baseSources,
    ...changedImplementationPaths.filter(
      (path) => isE2eSpec(path) || STANDALONE_TESTS.has(path),
    ),
  ]);
  const untraceable = changedImplementationPaths.some(
    (path) => !accounted.has(path) || path.startsWith("apps/desktop/scripts/"),
  );
  const requiresFullUnits =
    Boolean(plan.groupPaths.highRisk?.length) ||
    untraceable ||
    baseSources.some((path) => !exists(path)) ||
    sources.some((path) => /\s/u.test(path)) ||
    sources.length > MAX_AFFECTED_UNIT_SOURCES;

  if (requiresFullUnits) {
    return { ...flags, unitMode: "full", unitArgs: [], unitStrict: false };
  }
  if (sources.length === 0) {
    return { ...flags, unitMode: "none", unitArgs: [], unitStrict: false };
  }
  return {
    ...flags,
    unitMode: "affected",
    unitArgs: sources.sort(),
    unitStrict: strictUnitRun(sources),
  };
}

export function unitShardMatrix(plan) {
  return plan.unitMode === "full" ? FULL_UNIT_SHARDS : ["1/1"];
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
  if (
    /^playwright\.config\.[^/]+$/u.test(path) ||
    path === "scripts/build-e2e-editor.mjs"
  )
    return true;
  // Unit/module tests and package metadata do not ship to the browser. Their
  // production owners still select browser coverage when those owners change,
  // while Core contracts validate these files directly.
  if (/\.test\.(?:mjs|ts|tsx)$/u.test(path)) return false;
  if (/(?:^|\/)package\.json$/u.test(path) || path === "pnpm-lock.yaml")
    return false;
  return (
    /^(?:apps\/editor|apps\/mcp-server|packages|worker)\//u.test(path) ||
    /^(?:vite\.config\.[^/]+|wrangler(?:\.[^/]+)?\.jsonc)$/u.test(path)
  );
}

function browserImplementationPaths(plan) {
  return implementationPaths(plan).filter(canAffectBrowser);
}

/**
 * Convert the repository gate plan into the intentionally smaller PR choice.
 * Core contracts still run for every implementation change. Pull requests and
 * their merge-queue groups run affected browser contracts, with a small product
 * fallback for unmapped product paths. Unresolved fixture use is conservative;
 * `--force-full` remains for local planning.
 */
export function planCiValidation(
  plan,
  { forceFull = false, exists = () => true } = {},
) {
  if (forceFull) {
    return {
      heavy: true,
      browser: true,
      browserNeedsMcp: true,
      mode: "full",
      e2eArgs: [],
      ...planCoreScopes(plan, plan.paths, { forceFull: true, exists }),
      reasons: ["full validation was requested by the workflow event"],
    };
  }

  const changedImplementationPaths = implementationPaths(plan);
  if (changedImplementationPaths.length === 0) {
    return {
      heavy: false,
      browser: false,
      browserNeedsMcp: false,
      mode: "documentation",
      e2eArgs: [],
      ...allCoreScopes(false),
      reasons: ["the change contains no implementation paths"],
    };
  }

  const coreScopes = planCoreScopes(plan, changedImplementationPaths, {
    forceFull: false,
    exists,
  });

  const changedBrowserPaths = browserImplementationPaths(plan);
  if (changedBrowserPaths.length === 0) {
    return {
      heavy: true,
      browser: false,
      browserNeedsMcp: false,
      mode: "non-browser",
      e2eArgs: [],
      ...coreScopes,
      reasons: ["the implementation change cannot affect the browser product"],
    };
  }

  const browserGates = (plan.selectedGates ?? plan.gates).filter(
    (gate) =>
      gate.ci?.e2eArgs?.length && gate.matchedPaths.some(canAffectBrowser),
  );
  const focusedArgs = unique(
    browserGates.flatMap((gate) => gate.ci.e2eArgs),
  ).sort();
  const coveredPaths = new Set(
    browserGates.flatMap((gate) => gate.matchedPaths),
  );
  const uncoveredPaths = changedBrowserPaths.filter(
    (path) => !coveredPaths.has(path),
  );
  if (focusedArgs.length === 0 || uncoveredPaths.length > 0) {
    const e2eArgs = unique([
      ...focusedArgs,
      ...fallbackBrowserArgs(focusedArgs),
    ]).sort();
    return {
      heavy: true,
      browser: true,
      browserNeedsMcp: browserSelectionNeedsMcp("fallback", e2eArgs),
      mode: "fallback",
      e2eArgs,
      ...coreScopes,
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
    browserNeedsMcp: browserSelectionNeedsMcp("focused", focusedArgs),
    mode: "focused",
    e2eArgs: focusedArgs,
    ...coreScopes,
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
    `Unit mode: ${plan.unitMode}`,
    `Optional core jobs: build=${plan.build} unit_built=${plan.unitBuilt} performance=${plan.performance} release=${plan.release} regional_python=${plan.regionalPython}`,
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
    `- Unit mode: **${plan.unitMode}**`,
    `- Optional core jobs: build=${plan.build}, unit_built=${plan.unitBuilt}, performance=${plan.performance}, release=${plan.release}, regional_python=${plan.regionalPython}`,
    `- Browser job: ${plan.browser ? "enabled" : "skipped"}`,
    `- Browser selection: ${browserSelection}`,
    "",
    ...plan.reasons.map((reason) => `- ${reason}`),
    "",
  ].join("\n");
}
