// Each target names the environment-dependent assertions, not the pure tests
// beside them. A missing, renamed or skipped target fails qualification.
export const environmentTestLanes = {
  sg13g2: {
    runner: "vitest",
    checks: [
      {
        file: "packages/simulation-service/src/sg13g2-execution.test.ts",
        targets: [
          "matches the independent DUT numerically through the real selected-Profile transport",
          "passes the production smoke over real HTTP with the qualified executor",
        ],
      },
    ],
  },
  "mcp-sg13g2": {
    runner: "playwright",
    files: ["apps/mcp-server/dist/main.js"],
    checks: [
      {
        file: "apps/editor/e2e/sg13g2-simulation.spec.ts",
        targets: [
          "SG13 Properties use qualified targets, model defaults and physical Process presets",
          "GUI and public MCP run thirteen SG13G2 devices and a gate",
        ],
      },
    ],
  },
  "browser-performance": {
    runner: "playwright",
    values: { ICM_PERF: "1" },
    files: ["apps/editor/dist/index.html"],
    checks: [
      {
        file: "apps/editor/e2e/performance.spec.ts",
        targets: [
          "records mixed-selection drag and pan frame cost",
          "records copy-to-ghost and drop-to-next-ghost on a dense Project",
        ],
      },
    ],
  },
  ngspice: {
    runner: "vitest",
    filesFromEnv: ["NGSPICE_BIN"],
    commands: [["ngspice", "--version"]],
    checks: [
      {
        file: "containers/ngspice/pin-order-op.test.mjs",
        targets: [
          "executes the prepared hierarchy and distinguishes correct from exchanged amplifier inputs in real ngspice",
        ],
      },
      {
        file: "packages/netlist/src/block-supplies.test.ts",
        targets: [
          "an unpowered ideal op-amp under ngspice",
          "an ideal comparator whose high level is VDD under ngspice",
        ],
      },
      {
        file: "packages/netlist/src/gate-cell.test.ts",
        targets: [
          "a gate or op-amp bound to a transistor-level Cell under ngspice",
        ],
      },
      {
        file: "packages/netlist/src/ideal-logic-gate-models.test.ts",
        targets: ["ideal logic bodies under ngspice"],
      },
      {
        file: "packages/netlist/src/ideal-signal-block-models.test.ts",
        targets: ["generated block bodies under ngspice"],
      },
      {
        file: "packages/netlist/src/simulation-compile.test.ts",
        targets: ["running a compiled deck"],
      },
      {
        file: "packages/edit-engine/src/bus-netlist.test.ts",
        targets: ["ngspice proves four independent DC values"],
      },
      {
        file: "packages/netlist/src/delay-cell-acceptance.test.ts",
        targets: ["Delay Cell in real ngspice"],
      },
      {
        file: "packages/netlist/src/model-contract-acceptance.test.ts",
        targets: [
          "OP/DC/AC/TRAN in real ngspice",
          "oscillator at ±5 V in real ngspice",
          "executes the fully differential comparator in ngspice",
        ],
      },
      {
        file: "packages/devices/src/reviewed-external.test.ts",
        targets: ["agrees with every cell of the libraries' own netlists"],
      },
    ],
  },
  windows: {
    runner: "vitest",
    platform: "win32",
    checks: [
      {
        file: "apps/desktop/src/windows-association.test.ts",
        targets: ["Windows project association"],
      },
      {
        file: "scripts/gallery-private-snapshot.test.mjs",
        targets: ["refuses an exposed file inside a private Windows directory"],
      },
    ],
  },
};
