import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  LegacyProjectSimulationSetupSchema,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  SimulationExperimentConfigSchema,
  type LegacyProjectSimulationSetup as ProjectSimulationFolder,
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
      ...Object.fromEntries(
        Object.entries(ota).filter(([key]) => key !== "simulationSetups"),
      ),
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      simulationFolders: [],
    });
    const before = JSON.stringify(project);
    expect(legacySetups().length).toBeGreaterThan(1);
    for (const original of legacySetups()) {
      const converted = migrateSimulationSetupToSource(project, original);
      expect(converted.folder.id).toBe(original.id);
      expect(converted.folder.name).toBe(original.name);
      expect(migrateSimulationSetupToSource(project, original)).toEqual(
        converted,
      );
      const config = SimulationExperimentConfigSchema.parse(
        JSON.parse(
          converted.folder.input.files.find(
            (f) => f.path === converted.folder.input.configPath,
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
          converted.folder.input.files.find((f) => f.path === "run.cir")!.text,
        ).toContain(command.command);
      expect(converted.folder.input.circuitBindings).toMatchObject([
        { emission: "top-level", documentId: original.input.rootDocumentId },
      ]);
    }
    expect(JSON.stringify(project)).toBe(before);
  });

  it("retains incomplete intent instead of substituting a runnable example", () => {
    const project = CircuitProjectSchema.parse({
      ...Object.fromEntries(
        Object.entries(ota).filter(([key]) => key !== "simulationSetups"),
      ),
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      simulationFolders: [],
    });
    const folder = structuredClone(legacySetups()[0]!);
    if (folder.input.kind !== "structured")
      throw Error("expected structured fixture");
    folder.input.rootDocumentId = "removed";
    const converted = migrateSimulationSetupToSource(project, folder);
    expect(converted.warnings.length).toBeGreaterThan(0);
    expect(converted.folder.input.circuitBindings[0]!.documentId).toBe(
      "removed",
    );
    expect(
      converted.folder.input.files.find((f) => f.path === "run.cir")!.text,
    ).toContain("op");
  });

  it("preserves raw file bytes and dependency identity despite config filename collisions", () => {
    const project = CircuitProjectSchema.parse({
      ...Object.fromEntries(
        Object.entries(ota).filter(([key]) => key !== "simulationSetups"),
      ),
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      simulationFolders: [],
    });
    const folder: ProjectSimulationFolder = {
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
    const converted = migrateSimulationSetupToSource(project, folder);
    expect(converted.folder.input.configPath).toBe("experiment-2.json");
    if (folder.input.kind !== "raw") throw Error("expected raw fixture");
    expect(converted.folder.input.files.slice(0, 2)).toEqual(
      folder.input.files,
    );
    expect(converted.folder.input.dependencies).toEqual(
      folder.input.dependencies,
    );
    expect(converted.warnings[0]).toContain("did not apply");
  });

  it("shares exact planning output with the existing hashed compiler", async () => {
    const project = CircuitProjectSchema.parse({
      ...Object.fromEntries(
        Object.entries(ota).filter(([key]) => key !== "simulationSetups"),
      ),
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      simulationFolders: [],
    });
    const folder = legacySetups()[0]!;
    const plan = buildSimulationPlan(project, folder);
    const compiled = await compileStructuredSimulation(project, folder);
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
      ...Object.fromEntries(
        Object.entries(ota).filter(([key]) => key !== "simulationSetups"),
      ),
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      simulationFolders: [],
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
