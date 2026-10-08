// Unused files and exports (#1535). `pnpm deadcode` runs Knip twice, and
// `pnpm verify:pr` runs it before the unit tests:
//
// - `knip`: every file and export something imports, tests included. An
//   export only its own file uses drops `export` (a type may keep it).
// - `knip --production`: only what the product reaches from its entries (the
//   patterns ending in "!"). A symbol only tests use is dead: delete it with
//   its tests or, when a test is the point (a contract it pins, a harness
//   tests share), tag the export `@internal` with the reason. A module's own
//   helper exported for its unit test counts as used.
//
// Workspace packages are private, so a package export nothing imports is
// unused even when an entry re-exports it. An entry point other tools load
// (a package subpath for Node hosts, a repository-only library) tags its
// export `@public` with the reason.
import { readdirSync } from "node:fs";

const production = process.argv.some(
  (arg) => arg === "--production" || arg === "-p",
);

// Scripts and tools import packages' built output (`../packages/x/dist/y.js`),
// which an unbuilt checkout lacks: read each package's source instead.
const builtPackageSources = Object.fromEntries(
  readdirSync("packages").flatMap((name) =>
    ["../", "../../", "../../../"].map((up) => [
      `${up}packages/${name}/dist/*`,
      [`packages/${name}/src/*`],
    ]),
  ),
);

// Fixtures and helpers that only tests load.
const testSupport = [
  "!**/*.test-support.ts!",
  "!**/test-support/**!",
  "!**/*.test-fixture.ts!",
];

/** @type {import("knip").KnipConfig} */
export default {
  // Files and exports only; dependencies are not checked here.
  include: ["files", "exports", "types", "enumMembers", "namespaceMembers"],
  ignoreExportsUsedInFile: production ? true : { interface: true, type: true },
  workspaces: {
    ".": {
      entry: [
        "scripts/*.mjs!",
        "worker/index.ts!",
        "containers/*/entrypoint.mjs!",
        "containers/ngspice/gateway.mjs!",
        "containers/simulation/*.mjs!",
        "containers/vacask/image-smoke.mjs!",
        "tools/**/*.mjs!",
      ],
      project: [
        "scripts/**/*.mjs!",
        "worker/**/*.ts!",
        "containers/**/*.mjs!",
        "tools/**/*.mjs!",
        "!scripts/lib/native-cross-project-fixture.mjs!",
        ...testSupport,
      ],
      paths: builtPackageSources,
      // The image runs this smoke against files mounted at these paths.
      ignoreUnresolved: [
        "/opt/harness/vacask-harness.mjs",
        "/proof/native-example-acceptance.mjs",
      ],
    },
    "apps/editor": {
      // Its config loads the dev-server plugins, which load built packages.
      vite: false,
      entry: [
        "src/main.tsx!",
        "src/entries/*.{ts,tsx}!",
        "src/**/*.worker.ts!",
        "src/headless/index.ts!",
        "analytics/worker.ts!",
        "vite.config.ts!",
        "vite.desktop.config.ts!",
        "dev/agent-worker.ts",
        "census/*.ts",
        "e2e/**/*.spec.ts",
        // Specs load these by URL (e2e/helpers/page-modules.ts).
        "e2e/helpers/*-harness.tsx",
      ],
      project: [
        "src/**/*.{ts,tsx}!",
        "analytics/**/*.{ts,tsx}!",
        "build/**/*.ts!",
        "dev/**/*.ts",
        "e2e/**/*.{ts,tsx,mjs}",
        "census/**/*.ts",
        // Sample Projects the tests open.
        "!src/demos/**!",
        ...testSupport,
      ],
    },
    "apps/mcp-server": {
      project: ["src/**/*.ts!", ...testSupport],
    },
    "apps/local-host": {
      project: ["src/**/*.ts!", ...testSupport],
    },
    "apps/desktop": {
      entry: ["src/main.ts!", "scripts/*.mjs!"],
      project: ["src/**/*.ts!", "scripts/**/*.mjs!"],
    },
    "packages/*": {
      includeEntryExports: true,
      project: ["src/**/*.{ts,tsx}!", ...testSupport],
    },
  },
};
