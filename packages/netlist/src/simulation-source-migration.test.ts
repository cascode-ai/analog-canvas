import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  LegacyProjectSimulationSetupSchema,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  SimulationExperimentConfigSchema,
  type LegacyProjectSimulationSetup as ProjectSimulationSetup,
} from "@icm/model";
import ota from "../../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json";
const legacySetups = () =>
  ota.simulationSetups.map((s) => LegacyProjectSimulationSetupSchema.parse(s));
import { migrateSimulationSetupToSource } from "./simulation-source-migration.js";
import {
  buildSimulationPlan,
  compileStructuredSimulation,
} from "./simulation-compile.js";
import { printSpiceNetlist, printSpiceWithLocations } from "./printers.js";

describe("legacy experiment source migration", () => {
  it("preserves all OTA experiment identities, analyses and acquired objects offline", () => {
    const project = CircuitProjectSchema.parse({
      ...ota,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      simulationSetups: [],
    });
    const before = JSON.stringify(project);
    expect(legacySetups().length).toBeGreaterThan(1);
    for (const original of legacySetups()) {
      const converted = migrateSimulationSetupToSource(project, original);
      expect(converted.setup.id).toBe(original.id);
      expect(converted.setup.name).toBe(original.name);
      expect(migrateSimulationSetupToSource(project, original)).toEqual(
        converted,
      );
      const config = SimulationExperimentConfigSchema.parse(
        JSON.parse(
          converted.setup.input.files.find(
            (f) => f.path === converted.setup.input.configPath,
          )!.text,
        ),
      );
      if (original.input.kind !== "structured") continue;
      expect(config.outputs.map((o) => [o.id, o.label])).toEqual(
        original.input.outputs.map((o) => [o.id, o.label]),
      );
      expect(config.measurements).toEqual(original.input.measurements ?? []);
      expect(config.runPlan).toEqual(original.input.runPlan);
      const plan = buildSimulationPlan(project, original);
      expect(plan.ok, JSON.stringify(converted.warnings)).toBe(true);
      if (!plan.ok) continue;
      for (const command of plan.commands)
        expect(
          converted.setup.input.files.find((f) => f.path === "run.cir")!.text,
        ).toContain(command.command);
      expect(converted.setup.input.circuitBindings).toMatchObject([
        { emission: "top-level", documentId: original.input.rootDocumentId },
      ]);
    }
    expect(JSON.stringify(project)).toBe(before);
  });

  it("retains incomplete intent instead of substituting a runnable example", () => {
    const project = CircuitProjectSchema.parse({
      ...ota,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      simulationSetups: [],
    });
    const setup = structuredClone(legacySetups()[0]!);
    if (setup.input.kind !== "structured")
      throw Error("expected structured fixture");
    setup.input.rootDocumentId = "removed";
    const converted = migrateSimulationSetupToSource(project, setup);
    expect(converted.warnings.length).toBeGreaterThan(0);
    expect(converted.setup.input.circuitBindings[0]!.documentId).toBe(
      "removed",
    );
    expect(
      converted.setup.input.files.find((f) => f.path === "run.cir")!.text,
    ).toContain("op");
  });

  it("preserves raw file bytes and dependency identity despite config filename collisions", () => {
    const project = CircuitProjectSchema.parse({
      ...ota,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      simulationSetups: [],
    });
    const setup: ProjectSimulationSetup = {
      id: "raw",
      name: "Raw",
      version: 3,
      input: {
        kind: "raw",
        entry: "run.cir",
        environment: { profileId: "p", corner: "tt", temperatureC: 35 },
        files: [
          {
            path: "run.cir",
            text: "* title\r\n.control\r\nop\r\n.endc\r\n.end\r\n",
          },
          { path: "experiment.json", text: "user bytes" },
        ],
        dependencies: [
          {
            id: "models",
            mountPath: "experiment-1.json",
            sha256: "a".repeat(64),
          },
        ],
      },
    };
    const converted = migrateSimulationSetupToSource(project, setup);
    expect(converted.setup.input.configPath).toBe("experiment-2.json");
    if (setup.input.kind !== "raw") throw Error("expected raw fixture");
    expect(converted.setup.input.files.slice(0, 2)).toEqual(setup.input.files);
    expect(converted.setup.input.dependencies).toEqual(
      setup.input.dependencies,
    );
    expect(converted.warnings[0]).toContain("did not apply");
  });

  it("shares exact planning output with the existing hashed compiler", async () => {
    const project = CircuitProjectSchema.parse({
      ...ota,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      simulationSetups: [],
    });
    const setup = legacySetups()[0]!;
    const plan = buildSimulationPlan(project, setup);
    const compiled = await compileStructuredSimulation(project, setup);
    expect(plan.ok && compiled.ok).toBe(true);
    if (!plan.ok || !compiled.ok) return;
    const { inputRevision, ...request } = compiled.request;
    expect(inputRevision).toMatch(/^[a-f0-9]{64}$/u);
    expect(request).toEqual(plan.request);
  });
});

describe("generated parameter source locations", () => {
  it("uses printer-owned exact spans without changing structural output", () => {
    const project = CircuitProjectSchema.parse({
      ...ota,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      simulationSetups: [],
    });
    const plan = buildSimulationPlan(project, legacySetups()[0]!);
    if (!plan.ok) throw Error(JSON.stringify(plan.diagnostics));
    for (const topLevel of [true, false]) {
      const printed = printSpiceWithLocations(plan.circuit, topLevel);
      if (!topLevel) expect(printed.text).toBe(printSpiceNetlist(plan.circuit));
      expect(printed.parameters.length).toBeGreaterThan(10);
      for (const span of printed.parameters) {
        expect(printed.text.slice(span.startOffset, span.endOffset)).toBe(
          span.rawValue,
        );
        const instance = plan.circuit.cells
          .find((c) => c.id === span.documentId)!
          .instances.find((i) => i.id === span.instanceId)!;
        expect(
          instance.parameters.find((p) => p.name === span.parameter)!.rawValue,
        ).toBe(span.rawValue);
      }
    }
  });
});
