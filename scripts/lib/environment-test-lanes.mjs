// Each target names the environment-dependent assertions, not the pure tests
// beside them. A missing, renamed or skipped target fails qualification.
export const environmentTestLanes = {
  "vacask-source": {
    runner: "vitest",
    values: { ICM_PYTHON: "python3" },
    filesFromEnv: ["ICM_VACASK_BSIM4_SOURCE"],
    directoriesFromEnv: [
      "ICM_VACASK_CONVERTER_SOURCE",
      "ICM_SKY130_MODEL_SOURCE",
    ],
    commands: [["python3", "--version"]],
    checks: [
      {
        file: "scripts/lib/vacask-bsim4-chainrule.test.mjs",
        targets: [
          "repairs the real pinned package without mutating it, and tolerates checkout line endings",
        ],
      },
      {
        file: "scripts/vacask-sky130-convert.test.mjs",
        targets: [
          "source model binning semantics",
          "source real division",
          "pinned native SKY130 conversion",
        ],
      },
    ],
  },
  "mcp-native": {
    runner: "playwright",
    values: { ICM_E2E_VACASK_REAL: "1" },
    filesFromEnv: ["VACASK_BIN"],
    directoriesFromEnv: ["VACASK_MODULES"],
    files: ["apps/mcp-server/dist/main.js"],
    checks: [
      {
        file: "apps/editor/e2e/mcp-native-simulation.spec.ts",
        targets: [
          "public MCP connects to the real local relay and executes native source",
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
  vacask: {
    runner: "vitest",
    filesFromEnv: ["VACASK_BIN"],
    directoriesFromEnv: ["VACASK_MODULES"],
    checks: [
      {
        file: "packages/netlist/src/vacask-language.test.ts",
        targets: [
          "runs helper-authored sources, RCL, OP/AC/TRAN/Noise and a DC sweep in native VACASK",
        ],
      },
      {
        file: "packages/netlist/src/vacask-printer.test.ts",
        targets: [
          "executes all four controlled sources and local probe references in repeated hierarchy",
          "executes printer-generated hierarchy, multiplicity and waveform sources in native VACASK",
        ],
      },
      {
        file: "packages/netlist/src/vacask-source.test.ts",
        targets: [
          "matches native section/include semantics in the actual kernel",
        ],
      },
      {
        file: "packages/netlist/src/vacask-source-scopes.test.ts",
        targets: [
          "binds the resolver's native node and instance paths to actual kernel output",
        ],
      },
      {
        file: "packages/netlist/src/simulation-native-current.test.ts",
        targets: ["measures signed terminal currents in real OP/AC:"],
      },
      {
        file: "packages/netlist/src/simulation-native-devices.test.ts",
        targets: [
          "executes public compiler plus native OP helper and matches independently captured N/P output keys and values",
        ],
      },
      {
        file: "packages/netlist/src/simulation-source-vacask.test.ts",
        targets: [
          "executes the PUBLIC compiler with reversed include order and run point",
        ],
      },
      {
        file: "packages/simulation-service/src/prepare-source.test.ts",
        targets: [
          "runs ambient points across native option resets and DC sweeps without changing tnom",
          "executes prepared Profile corner points with actual native section-dependent numbers",
        ],
      },
      {
        file: "packages/simulation-service/src/prepare-external-vacask.test.ts",
        targets: ["External models with real VACASK OP/DC/AC/TRAN"],
      },
      {
        file: "packages/netlist/src/delay-cell-acceptance.test.ts",
        targets: ["Delay Cell in real vacask"],
      },
      {
        file: "packages/netlist/src/model-contract-acceptance.test.ts",
        targets: [
          "preserves SDE noise-space LTE tolerance through native switch projections",
          "output error control at a native switch edge",
          "preserves ordinary native",
          "rejects switch-only",
          "model in native VACASK",
          "executes the fully differential comparator in vacask",
          "measures native transformer polarity and gain",
          "phase control without changing annotation semantics",
          "and preserves the RC state",
        ],
      },
    ],
  },
};
