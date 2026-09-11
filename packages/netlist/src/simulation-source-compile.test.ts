import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  LegacyProjectSimulationSetupSchema,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  SimulationExperimentConfigSchema,
  ProjectSimulationFolderSchema,
  type ProjectSimulationFolder,
} from "@icm/model";
import ota from "../../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json";
const legacySetups = () =>
  ota.simulationSetups.map((s) => LegacyProjectSimulationSetupSchema.parse(s));
import { migrateSimulationSetupToSource } from "./simulation-source-migration.js";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import { buildSimulationPlan } from "./simulation-compile.js";

const project = () =>
  CircuitProjectSchema.parse({
    ...Object.fromEntries(
      Object.entries(ota).filter(([key]) => key !== "simulationSetups"),
    ),
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    simulationFolders: [],
  });
function config(folder: ProjectSimulationFolder) {
  return SimulationExperimentConfigSchema.parse(
    JSON.parse(
      folder.input.files.find((f) => f.path === folder.input.configPath)!.text,
    ),
  );
}
function raw(text: string) {
  return ProjectSimulationFolderSchema.parse({
    id: "raw",
    name: "Raw",
    version: 4,
    input: {
      kind: "source",
      entry: "run.cir",
      configPath: "experiment.json",
      files: [
        { path: "run.cir", text },
        {
          path: "experiment.json",
          text: JSON.stringify({
            version: 1,
            environment: { profileId: "p" },
            outputs: [
              {
                id: "v",
                label: "Custom",
                expression: { kind: "vector", vector: "v(out)" },
              },
            ],
          }),
        },
      ],
      circuitBindings: [],
      dependencies: [],
    },
  });
}
describe("source simulation compiler", () => {
  it("never prepares stale committed bytes while an unapplied saved draft exists", () => {
    const folder = raw("* test\n.control\nop\nwrite out.raw\n.endc\n.end\n");
    expect(compileSourceSimulation(project(), folder).ok).toBe(true);
    const text = folder.input.files[0]!.text;
    folder.input.drafts = [{ path: "run.cir", base: text, text: "unfinished" }];
    const refused = compileSourceSimulation(project(), folder);
    expect(refused.ok).toBe(false);
    if (!refused.ok)
      expect(refused.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "SIMULATION_SOURCE_DRAFT_PENDING",
            path: "run.cir",
          }),
        ]),
      );
    expect(folder.input.files[0]!.text).toBe(text);
    folder.input.drafts = [];
    expect(compileSourceSimulation(project(), folder).ok).toBe(true);
  });
  it("accepts only known intrinsic Noise outputs, not arbitrary missing ids", () => {
    const folder = raw("* test\n.control\nop\nwrite out.raw\n.endc\n.end\n");
    const settings = config(folder);
    const file = folder.input.files.find(
      (f) => f.path === folder.input.configPath,
    )!;
    for (const outputId of [
      "noise-output-density",
      "noise-input-density",
      "noise-typo",
    ]) {
      settings.measurements = [
        {
          id: "m",
          label: "Peak",
          outputId,
          analysis: "noise",
          method: { kind: "maximum" },
        },
      ];
      file.text = JSON.stringify(settings);
      const result = compileSourceSimulation(project(), folder);
      expect(result.ok).toBe(outputId !== "noise-typo");
      if (!result.ok)
        expect(
          result.diagnostics.some(
            (d) => d.code === "SIMULATION_MEASUREMENT_OUTPUT_MISSING",
          ),
        ).toBe(true);
    }
  });
  it("preserves native code and native vector ownership without requiring a Canvas", () => {
    const text =
      "* native\r\nV1 in 0 1\r\nR1 in out 1k\r\nR2 out 0 1k\r\n.control\r\nop\r\nwrite out.raw\r\n.endc\r\n.end\r\n";
    const compiled = compileSourceSimulation(project(), raw(text));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.files[0]!.text).toBe(text);
    expect(compiled.generated).toEqual([]);
    expect(compiled.vectors[0]).toMatchObject({
      vector: "v(out)",
      quantity: "native",
    });
    expect(compiled.outputs[0]!.label).toBe("Custom");
  });
  it("keeps each migrated OTA experiment compilable with the same acquisition identities", () => {
    const before = project();
    for (const folder of legacySetups()) {
      if (folder.input.kind !== "structured") continue;
      const migrated = migrateSimulationSetupToSource(before, folder).folder;
      const compiled = compileSourceSimulation(before, migrated);
      expect(
        compiled.ok,
        JSON.stringify(compiled.ok ? [] : compiled.diagnostics),
      ).toBe(true);
      if (!compiled.ok) continue;
      const original = buildSimulationPlan(before, folder);
      expect(original.ok).toBe(true);
      if (!original.ok) continue;
      expect(compiled.vectors.map((v) => v.vector).sort()).toEqual(
        original.vectors.map((v) => v.vector).sort(),
      );
      expect(compiled.outputs.map(({ id, label }) => ({ id, label }))).toEqual(
        original.outputs.map(({ id, label }) => ({ id, label })),
      );
      expect(compiled.config.measurements).toEqual(original.measurements);
      for (const generated of compiled.generated)
        for (const span of generated.parameters)
          expect(generated.text.slice(span.startOffset, span.endOffset)).toBe(
            span.rawValue,
          );
      expect(compiled.authoredFiles).toEqual(migrated.input.files);
    }
    expect(before).toEqual(project());
  });
  it("does not widen an explicit native save list to all when adding Canvas captures", () => {
    const before = project();
    const original = legacySetups().find(
      (s) => s.input.kind === "structured" && s.input.outputs.length,
    )!;
    const folder = migrateSimulationSetupToSource(before, original).folder;
    const entry = folder.input.files.find(
      (f) => f.path === folder.input.entry,
    )!;
    entry.text = entry.text.replace(".control", ".control\nsave v(0)");
    const compiled = compileSourceSimulation(before, folder);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const prepared = compiled.files.find(
      (f) => f.path === folder.input.entry,
    )!.text;
    expect(prepared).toContain("save v(0)");
    expect(prepared).not.toContain(".save all");
  });
  it("distinguishes two authored DUT calls and maps formal ports to actual top-level nodes", () => {
    const before = project();
    const original = legacySetups().find(
      (s) => s.input.kind === "structured" && s.input.outputs.length,
    )!;
    const folder = migrateSimulationSetupToSource(before, original).folder;
    const binding = folder.input.circuitBindings[0]!;
    const base = buildSimulationPlan(before, original);
    if (!base.ok) throw Error(JSON.stringify(base.diagnostics));
    const root = base.circuit.cells.find((c) => c.ports.length > 0)!;
    binding.documentId = root.id;
    binding.emission = "subcircuit";
    const settings = config(folder);
    settings.deviceOperatingPoints = [];
    settings.measurements = [];
    const internalNet = root.nets.find(
      (net) =>
        net.scope !== "global" &&
        !root.ports.some((port) => port.netName === net.name),
    )!;
    settings.outputs = ["XLEFT", "XRIGHT"].map((call, id) => ({
      id: String(id),
      label: call,
      expression: {
        kind: "voltage",
        documentId: root.id,
        occurrence: [],
        anchor: { kind: "base-net", netId: internalNet.id },
        circuit: { bindingId: binding.id, callPath: [call] },
      },
    }));
    folder.input.files.find((f) => f.path === folder.input.configPath)!.text =
      JSON.stringify(settings);
    const ports = root.ports.map((_, i) => `input${i}`).join(" ");
    folder.input.files.find((f) => f.path === folder.input.entry)!.text =
      `* calls\n.include "${binding.path}"\nXLEFT ${ports} ${root.name}\nXRIGHT ${ports} ${root.name}\n.control\nop\nwrite out.raw\n.endc\n.end\n`;
    const compiled = compileSourceSimulation(before, folder);
    expect(
      compiled.ok,
      JSON.stringify(compiled.ok ? [] : compiled.diagnostics),
    ).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.vectors.some((v) => v.vector.startsWith("v(xleft."))).toBe(
      true,
    );
    expect(compiled.vectors.some((v) => v.vector.startsWith("v(xright."))).toBe(
      true,
    );
  });
  it("returns source diagnostics for broken author/config text instead of throwing", () => {
    const folder = raw('* title\n.include "missing.spice"\n');
    expect(compileSourceSimulation(project(), folder)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "SIMULATION_FILE_MISSING" }],
    });
    folder.input.files.find((f) => f.path === folder.input.configPath)!.text =
      "{";
    expect(compileSourceSimulation(project(), folder)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "SIMULATION_CONFIG_JSON" }],
    });
  });
});
