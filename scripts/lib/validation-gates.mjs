import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  browserFixtureRoutes,
  browserSpecPath,
} from "./browser-fixture-routes.mjs";

const root = resolve(import.meta.dirname, "../..");
const defaultCatalogPath = resolve(root, "config/validation-gates.json");

function normalized(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function escaped(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

export function globPattern(pattern) {
  const tokens = escaped(normalized(pattern))
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000/", "(?:.*/)?")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${tokens}$`, "u");
}

export function matchesAny(path, patterns) {
  const value = normalized(path);
  return patterns.some((pattern) => globPattern(pattern).test(value));
}

export async function loadGateCatalog(path = defaultCatalogPath) {
  const catalog = JSON.parse(await readFile(path, "utf8"));
  if (catalog.schemaVersion !== 1) {
    throw new Error("validation gate catalog schemaVersion must be 1");
  }
  if (!catalog.pathGroups || !catalog.gates || !catalog.fullFallback) {
    throw new Error("validation gate catalog is missing required sections");
  }
  const ids = catalog.gates.map((gate) => gate.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("validation gate ids must be unique");
  }
  const manualSpecs = new Set(
    (catalog.manualChecks ?? []).flatMap((check) => check.specs),
  );
  for (const gate of catalog.gates) {
    if (!Array.isArray(gate.command) || gate.command.length === 0) {
      throw new Error(`${gate.id}: command must be a non-empty array`);
    }
    if (!["preflight", "affected", "final"].includes(gate.stage)) {
      throw new Error(`${gate.id}: unsupported stage ${gate.stage}`);
    }
    for (const argument of [...gate.command, ...(gate.ci?.e2eArgs ?? [])]) {
      if (manualSpecs.has(argument))
        throw new Error(
          `${gate.id}: manual spec in ordinary gate: ${argument}`,
        );
    }
    for (const group of gate.groups ?? []) {
      if (!catalog.pathGroups[group]) {
        throw new Error(`${gate.id}: unknown path group ${group}`);
      }
    }
    for (const argument of gate.ci?.e2eArgs ?? []) {
      if (typeof argument !== "string" || !browserSpecPath.test(argument)) {
        throw new Error(`${gate.id}: unsafe CI browser argument ${argument}`);
      }
    }
  }
  return catalog;
}

/** A path is in a group when one pattern names it and no `!pattern` removes it. */
export function inPathGroup(path, patterns) {
  const removed = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));
  return (
    matchesAny(
      path,
      patterns.filter((pattern) => !pattern.startsWith("!")),
    ) && !matchesAny(path, removed)
  );
}

function groupMatches(paths, catalog) {
  return Object.fromEntries(
    Object.entries(catalog.pathGroups).map(([name, patterns]) => [
      name,
      paths.filter((path) => inPathGroup(path, patterns)),
    ]),
  );
}

function applies(gate, context) {
  if (gate.when === "docs-only") return context.docsOnly;
  if (gate.when === "non-doc") return !context.docsOnly;
  return (gate.groups ?? []).some(
    (group) => context.groupPaths[group]?.length > 0,
  );
}

function matchedReasons(gate, context) {
  if (gate.when === "docs-only") return ["all changed paths are documentation"];
  if (gate.when === "non-doc")
    return ["the change contains non-documentation paths"];
  return (gate.groups ?? []).flatMap((group) =>
    context.groupPaths[group].map((path) => `${group}: ${path}`),
  );
}

function browserFixtureGate({ byFixture, specs }, manualChecks) {
  if (!byFixture.size) return null;
  const manualSpecs = new Set(manualChecks.flatMap((check) => check.specs));
  // Keep any catalog route for a fixture used only by a named environment lane.
  const ordinaryRoutes = [...byFixture].filter(
    ([, users]) =>
      !users.length || users.some((spec) => !manualSpecs.has(spec)),
  );
  if (!ordinaryRoutes.length) return null;
  const selected = ordinaryRoutes.some(([, users]) => !users.length)
    ? specs
    : ordinaryRoutes.flatMap(([, users]) => users);
  const e2eArgs = [...new Set(selected)]
    .filter((spec) => !manualSpecs.has(spec))
    .sort();
  if (!e2eArgs.length) return null;
  return {
    id: "browser-fixtures",
    stage: "affected",
    command: ["pnpm", "test:e2e:local", ...e2eArgs],
    ci: { e2eArgs },
    matchedPaths: ordinaryRoutes.map(([path]) => path),
    reasons: ordinaryRoutes.map(([path, users]) =>
      users.length
        ? `browser fixture: ${path}`
        : `unresolved browser fixture: ${path}`,
    ),
  };
}

export function planValidation(paths, catalog) {
  const uniquePaths = [
    ...new Set(
      paths
        .map(normalized)
        .filter(Boolean)
        .filter((path) => !matchesAny(path, catalog.ignoredPaths ?? [])),
    ),
  ].sort();
  const groupPaths = groupMatches(uniquePaths, catalog);
  const documentation = new Set(groupPaths.documentation ?? []);
  const nonDocumentationPaths = uniquePaths.filter(
    (path) => !documentation.has(path),
  );
  const docsOnly = uniquePaths.length > 0 && nonDocumentationPaths.length === 0;
  const context = { docsOnly, groupPaths };
  const fixtures = browserFixtureRoutes(root, nonDocumentationPaths);
  const manualChecks = catalog.manualChecks ?? [];
  const fixtureGate = browserFixtureGate(fixtures, manualChecks);
  const matchedFixtures = new Set(fixtureGate?.matchedPaths);
  const browserContext = {
    docsOnly,
    groupPaths: Object.fromEntries(
      Object.entries(groupPaths).map(([group, paths]) => [
        group,
        paths.filter((path) => !matchedFixtures.has(path)),
      ]),
    ),
  };
  const knownPaths = new Set(
    Object.values(groupPaths)
      .flat()
      .filter((path) => !documentation.has(path)),
  );
  const unknownPaths = nonDocumentationPaths.filter(
    (path) => !knownPaths.has(path),
  );
  const gateContractPaths = (
    catalog.fullFallback.gateContractGroups ?? []
  ).flatMap((group) => groupPaths[group] ?? []);
  const fullReasons = [
    ...gateContractPaths.map((path) => `gate contract changed: ${path}`),
    ...unknownPaths.map(
      (path) => `unclassified non-documentation path: ${path}`,
    ),
  ];

  const selected = catalog.gates.flatMap((gate) => {
    const browser = Boolean(gate.ci?.e2eArgs?.length);
    const gateContext = browser ? browserContext : context;
    if (!uniquePaths.length || !applies(gate, gateContext)) return [];
    const matched = { ...gate, reasons: matchedReasons(gate, gateContext) };
    if (browser)
      matched.matchedPaths = (gate.groups ?? []).flatMap(
        (group) => gateContext.groupPaths[group],
      );
    return [matched];
  });

  if (fixtureGate) {
    const firstBrowser = selected.findIndex((gate) => gate.ci?.e2eArgs?.length);
    selected.splice(
      firstBrowser < 0 ? selected.length : firstBrowser,
      0,
      fixtureGate,
    );
  }

  if (fullReasons.length > 0) {
    for (const id of [
      catalog.fullFallback.preflightGate,
      catalog.fullFallback.affectedGate,
      catalog.fullFallback.finalGate,
    ].filter(Boolean)) {
      if (!selected.some((gate) => gate.id === id)) {
        const gate = catalog.gates.find((candidate) => candidate.id === id);
        if (!gate)
          throw new Error(`full fallback references unknown gate ${id}`);
        selected.push({ ...gate, reasons: fullReasons });
      }
    }
  }

  const superseded = new Set(selected.flatMap((gate) => gate.supersedes ?? []));
  if (
    fixtureGate &&
    selected.some((gate) => gate.id === catalog.fullFallback.finalGate)
  )
    superseded.add(fixtureGate.id);
  const gates = selected.filter((gate) => !superseded.has(gate.id));

  return {
    paths: uniquePaths,
    docsOnly,
    groupPaths,
    unknownPaths,
    requiresFull: fullReasons.length > 0,
    fullReasons,
    selectedGates: selected,
    manualChecks: manualChecks.flatMap((check) => {
      const reasons = applies(check, context)
        ? matchedReasons(check, context)
        : [];
      for (const [path, users] of fixtures.byFixture)
        if (check.specs.some((spec) => users.includes(spec)))
          reasons.push(`browser fixture: ${path}`);
      return uniquePaths.length && reasons.length
        ? [{ ...check, reasons }]
        : [];
    }),
    gates,
  };
}

/** Batch compatible browser selections; flags and other commands keep their order. */
export function executionGates(plan, stage) {
  const runs = [];
  let browser;
  for (const gate of plan.gates.filter((item) => item.stage === stage)) {
    const [program, script, ...specs] = gate.command;
    if (
      program !== "pnpm" ||
      script !== "test:e2e:local" ||
      !specs.length ||
      !specs.every((spec) => browserSpecPath.test(spec))
    ) {
      runs.push(gate);
      browser = undefined;
      continue;
    }
    if (!browser) {
      browser = {
        ...gate,
        id: "browser-workflows",
        command: [program, script],
        reasons: [],
      };
      runs.push(browser);
    }
    browser.command = [...new Set([...browser.command, ...specs])];
    browser.reasons = [...new Set([...browser.reasons, ...gate.reasons])];
  }
  return runs;
}

function gitPaths(args, cwd = root) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" })
      .split(/\r?\n/u)
      .filter(Boolean);
  } catch (error) {
    throw new Error(
      `Unable to inspect changed paths with git ${args.join(" ")}: ${error.message}`,
    );
  }
}

function untrackedPaths(ignoredPaths, cwd) {
  const entries = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    { cwd, encoding: "utf8" },
  )
    .split("\0")
    .filter((entry) => entry.startsWith("?? "))
    .map((entry) => normalized(entry.slice(3)));

  return entries.flatMap((path) => {
    if (matchesAny(path, ignoredPaths)) return [];
    if (!path.endsWith("/")) return [path];
    return gitPaths(
      ["ls-files", "--others", "--exclude-standard", "--", path],
      cwd,
    );
  });
}

export function collectChangedPaths(
  base,
  { ignoredPaths = [], cwd = root } = {},
) {
  return [
    ...new Set([
      ...gitPaths(
        ["diff", "--name-only", "--diff-filter=ACMRD", `${base}...HEAD`],
        cwd,
      ),
      ...gitPaths(["diff", "--name-only", "--diff-filter=ACMRD"], cwd),
      ...gitPaths(
        ["diff", "--cached", "--name-only", "--diff-filter=ACMRD"],
        cwd,
      ),
      ...untrackedPaths(ignoredPaths, cwd),
    ]),
  ];
}

export function renderCommand(command, base) {
  return command.map((part) => part.replaceAll("{base}", base));
}

export function windowsCommandLine(command) {
  const unsafe = command.find(
    (part) => !/^[A-Za-z0-9_./:@=,+*{}~-]+$/u.test(part),
  );
  if (unsafe) {
    throw new Error(
      `Refusing to pass an unsafe validation-gate argument to cmd.exe: ${unsafe}`,
    );
  }
  return command.join(" ");
}

function manualEvidenceLines(plan) {
  if (!plan.manualChecks?.length) return [];
  return [
    "",
    "Manual evidence (separate from automatic / required merge checks):",
    ...plan.manualChecks.flatMap((check) => [
      `  - ${check.id}: ${check.workflow} / ${check.job}${check.workflowInputs ? ` ${JSON.stringify(check.workflowInputs)}` : ""}`,
      `    Local command after preparation: ${check.command.join(" ")}`,
      `    Requires: ${check.requires}`,
    ]),
  ];
}

export function formatGatePlan(plan, { base = "origin/main" } = {}) {
  const lines = [
    `Validation gate plan (base: ${base})`,
    `Changed paths: ${plan.paths.length}`,
    `Mode: ${plan.docsOnly ? "documentation-only" : "implementation"}`,
    `Full fallback: ${plan.requiresFull ? "required" : "not required"}`,
  ];
  if (plan.fullReasons.length > 0) {
    lines.push(...plan.fullReasons.map((reason) => `  - ${reason}`));
  }
  for (const stage of ["preflight", "affected", "final"]) {
    const gates = executionGates(plan, stage);
    lines.push(`${stage}:`);
    if (gates.length === 0) lines.push("  - (none)");
    for (const gate of gates) {
      lines.push(
        `  - ${gate.id}: ${renderCommand(gate.command, base).join(" ")}`,
      );
      for (const reason of gate.reasons.slice(0, 3)) {
        lines.push(`      ${reason}`);
      }
      if (gate.reasons.length > 3) {
        lines.push(`      +${gate.reasons.length - 3} more matching paths`);
      }
    }
  }
  return `${[...lines, ...manualEvidenceLines(plan)].join("\n")}\n`;
}

export function formatGatePlanMarkdown(plan, { base = "origin/main" } = {}) {
  const lines = [
    "## Advisory validation gate plan",
    "",
    `- Base: \`${base}\``,
    `- Changed paths: ${plan.paths.length}`,
    `- Mode: ${plan.docsOnly ? "documentation-only" : "implementation"}`,
    `- Full fallback: ${plan.requiresFull ? "required" : "not required"}`,
    "",
    "| Stage | Gate | Command |",
    "| --- | --- | --- |",
  ];
  for (const gate of ["preflight", "affected", "final"].flatMap((stage) =>
    executionGates(plan, stage),
  )) {
    lines.push(
      `| ${gate.stage} | \`${gate.id}\` | \`${renderCommand(gate.command, base).join(" ")}\` |`,
    );
  }
  if (plan.gates.length === 0) lines.push("| - | - | No changed paths |\n");
  if (plan.fullReasons.length > 0) {
    lines.push("", "Full-fallback reasons:", "");
    lines.push(...plan.fullReasons.map((reason) => `- ${reason}`));
  }
  return `${[...lines, ...manualEvidenceLines(plan)].join("\n")}\n`;
}

export function runGateCommand(gate, { base = "origin/main" } = {}) {
  const [program, ...args] = renderCommand(gate.command, base);
  const windows = process.platform === "win32";
  const executable = windows ? (process.env.ComSpec ?? "cmd.exe") : program;
  const spawnArgs = windows
    ? ["/d", "/s", "/c", windowsCommandLine([program, ...args])]
    : args;
  process.stdout.write(`\n[gate:${gate.id}] ${[program, ...args].join(" ")}\n`);
  const result = spawnSync(executable, spawnArgs, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${gate.id} failed with exit code ${result.status}`);
  }
}
