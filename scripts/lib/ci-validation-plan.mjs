function unique(values) {
  return [...new Set(values)];
}

function implementationPaths(plan) {
  const documentation = new Set(plan.groupPaths.documentation ?? []);
  return plan.paths.filter((path) => !documentation.has(path));
}

const fallbackBrowserArgs = [
  "apps/editor/e2e/component-insert.spec.ts",
  "apps/editor/e2e/runtime-crash-safety.spec.ts",
];

function canAffectBrowser(path) {
  // Unit/module tests and package metadata do not ship to the browser. Their
  // production owners still select browser coverage when those owners change,
  // while Core contracts validate these files directly.
  if (/\.test\.(?:mjs|ts|tsx)$/u.test(path)) return false;
  if (/(?:^|\/)package\.json$/u.test(path) || path === "pnpm-lock.yaml")
    return false;
  if (
    path.startsWith("apps/local-host/") ||
    path.startsWith("packages/platform-node/")
  )
    return false;
  return (
    /^(?:apps\/editor|apps\/mcp-server|packages|worker)\//u.test(path) ||
    /^(?:vite\.config\.[^/]+|wrangler(?:\.[^/]+)?\.jsonc)$/u.test(path)
  );
}

function browserImplementationPaths(plan) {
  return implementationPaths(plan).filter(canAffectBrowser);
}

function browserSelectionGates(plan) {
  return plan.selectedGates ?? plan.gates;
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
 * Core contracts still run for every implementation change. Pull requests run
 * affected browser contracts, with a small product fallback for unmapped
 * browser paths; scheduled and manual audits alone force the complete suite.
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
      e2eArgs: unique([...focusedArgs, ...fallbackBrowserArgs]).sort(),
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

/** Spread broad affected selections without charging small changes for four runners. */
export function browserShardMatrix(plan) {
  const specs = plan.e2eArgs.filter((argument) =>
    argument.endsWith(".spec.ts"),
  );
  const count = plan.mode === "full" || specs.length >= 12 ? 4 : 2;
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
