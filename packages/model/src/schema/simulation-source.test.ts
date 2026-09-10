import { describe, expect, it } from "vitest";
import {
  ProjectSourceSimulationSetupSchema,
  SimulationExperimentConfigSchema,
  SimulationSourceExpressionSchema,
  type ProjectSourceSimulationSetup,
} from "./simulation-source.js";

function setup(): ProjectSourceSimulationSetup {
  return {
    id: "experiment",
    name: "AC",
    version: 4,
    input: {
      kind: "source",
      entry: "run.cir",
      configPath: "experiment.json",
      files: [
        { path: "run.cir", text: ".control\nac dec\n" },
        { path: "experiment.json", text: "{" },
      ],
      circuitBindings: [
        {
          id: "dut",
          path: "circuit.spice",
          documentId: "deleted-cell",
          emission: "subcircuit",
        },
      ],
      dependencies: [],
    },
  };
}

describe("source experiment persistence", () => {
  it("preserves broken SPICE/JSON and missing Cell/entry for repair", () => {
    const authored = setup();
    authored.input.entry = "removed.cir";
    expect(
      ProjectSourceSimulationSetupSchema.parse(
        JSON.parse(JSON.stringify(authored)),
      ),
    ).toEqual(authored);
  });

  it("does not persist generated text, derived configuration, or old analysis state", () => {
    for (const [key, value] of [
      ["analyses", [{ kind: "op" }]],
      ["environment", { profileId: "p" }],
      ["config", {}],
    ]) {
      const authored = setup();
      expect(
        ProjectSourceSimulationSetupSchema.safeParse({
          ...authored,
          input: { ...authored.input, [String(key)]: value },
        }).success,
      ).toBe(false);
    }
  });

  it.each([
    "../bad",
    "C:/secret",
    "/tmp/x",
    "a\\b",
    ".spiceinit",
    "a/../b",
    "a\u0000b",
  ])("refuses unsafe path %s", (path) => {
    const authored = setup();
    authored.input.files.push({ path, text: "" });
    expect(ProjectSourceSimulationSetupSchema.safeParse(authored).success).toBe(
      false,
    );
  });

  it("rejects duplicate ownership across author, generator and dependency paths", () => {
    const authored = setup();
    authored.input.files.push({ path: "circuit.spice", text: "override" });
    expect(ProjectSourceSimulationSetupSchema.safeParse(authored).success).toBe(
      false,
    );
    authored.input.files.pop();
    authored.input.dependencies.push({
      id: "models",
      mountPath: "run.cir",
      sha256: "a".repeat(64),
    });
    expect(ProjectSourceSimulationSetupSchema.safeParse(authored).success).toBe(
      false,
    );
  });

  it("does not permit competing drawn Testbench roots or generated entry/config", () => {
    const authored = setup();
    authored.input.entry = "circuit.spice";
    expect(ProjectSourceSimulationSetupSchema.safeParse(authored).success).toBe(
      false,
    );
    authored.input.entry = "run.cir";
    authored.input.circuitBindings = ["a", "b"].map((id) => ({
      id,
      documentId: id,
      path: `${id}.spice`,
      emission: "top-level",
    }));
    expect(ProjectSourceSimulationSetupSchema.safeParse(authored).success).toBe(
      false,
    );
  });

  it("does not apply session TTL/input limits to persisted Project text", () => {
    const authored = setup();
    authored.input.files = Array.from({ length: 25 }, (_, index) => ({
      path: `${index}.cir`,
      text: "x".repeat(45_000),
    }));
    expect(ProjectSourceSimulationSetupSchema.safeParse(authored).success).toBe(
      true,
    );
  });
});

describe("derived experiment configuration", () => {
  const config = () => ({ version: 1, environment: { profileId: "profile" } });

  it("uses defaults without adding a persisted copy", () => {
    expect(SimulationExperimentConfigSchema.parse(config())).toMatchObject({
      runPlan: { mode: "nominal" },
      collection: { rawfile: "out.raw" },
      variables: [],
      outputs: [],
      measurements: [],
    });
  });

  it("rejects duplicate source values and configuration authorities", () => {
    expect(
      SimulationExperimentConfigSchema.safeParse({
        ...config(),
        environment: { profileId: "profile", temperatureC: 27 },
      }).success,
    ).toBe(false);
    expect(
      SimulationExperimentConfigSchema.safeParse({ ...config(), analyses: [] })
        .success,
    ).toBe(false);
    const variable = {
      id: "v",
      name: "bias",
      sourcePath: "run.cir",
      bindings: [],
      value: "1.8",
    };
    expect(
      SimulationExperimentConfigSchema.safeParse({
        ...config(),
        variables: [variable],
      }).success,
    ).toBe(false);
  });

  it("keeps stale variable and measurement references for prepare diagnostics", () => {
    expect(
      SimulationExperimentConfigSchema.safeParse({
        ...config(),
        runPlan: {
          mode: "sweep",
          axes: [{ kind: "variable", variableId: "deleted", values: ["1"] }],
        },
        measurements: [
          {
            id: "gain",
            label: "Gain",
            outputId: "deleted",
            analysis: "op",
            method: { kind: "value" },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("requires explicit scope for Canvas objects and distinguishes native vectors", () => {
    const expression = {
      kind: "current",
      documentId: "dut",
      instanceId: "m1",
      pinName: "D",
      occurrence: [],
    };
    expect(SimulationSourceExpressionSchema.safeParse(expression).success).toBe(
      false,
    );
    expect(
      SimulationSourceExpressionSchema.parse({
        ...expression,
        circuit: { bindingId: "dut", callPath: ["XDUT2"] },
      }),
    ).toMatchObject({ circuit: { callPath: ["XDUT2"] } });
    expect(
      SimulationSourceExpressionSchema.parse({
        kind: "vector",
        vector: "v(out)",
      }),
    ).toEqual({ kind: "vector", vector: "v(out)" });
  });

  it("bounds expression depth during parsing", () => {
    let expression: unknown = { kind: "constant", value: 1 };
    for (let depth = 1; depth < 32; depth++)
      expression = { kind: "negate", operand: expression };
    expect(SimulationSourceExpressionSchema.safeParse(expression).success).toBe(
      true,
    );
    expect(
      SimulationSourceExpressionSchema.safeParse({
        kind: "negate",
        operand: expression,
      }).success,
    ).toBe(false);
  });

  it("rejects two variables claiming the same exact parameter", () => {
    const bindings = [{ documentId: "d", instanceId: "m", parameter: "w" }];
    expect(
      SimulationExperimentConfigSchema.safeParse({
        ...config(),
        variables: ["a", "b"].map((id) => ({
          id,
          name: id,
          sourcePath: "run.cir",
          bindings,
        })),
      }).success,
    ).toBe(false);
  });
});
