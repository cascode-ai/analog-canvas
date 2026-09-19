import { LegacyProjectSimulationSetupSchema } from "@icm/model";
import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  createSimulationFolder,
  CircuitProjectSchema,
  ProjectSimulationFolderSchema,
  type ProjectSimulationFolder,
} from "@icm/model";
import {
  currentFiveTransistorOtaCircuitSource,
  legacyFiveTransistorOta as ota,
} from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";
const legacySetups = () =>
  ota.simulationSetups.map((s) => LegacyProjectSimulationSetupSchema.parse(s));
import { migrateSimulationSetupToSource } from "./simulation-source-migration.js";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { buildSimulationPlan } from "./simulation-compile.js";
import { simulationSignals } from "./simulation-signal-names.js";

const project = () =>
  CircuitProjectSchema.parse(currentFiveTransistorOtaCircuitSource());
function nativeConfig(folder: ProjectSimulationFolder) {
  folder.input.files.find((f) => f.path === folder.input.configPath)!.text =
    JSON.stringify({ version: 2, environment: { profileId: "p" } });
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
            version: 2,
            environment: { profileId: "p" },
          }),
        },
      ],
      circuitBindings: [],
      dependencies: [],
    },
  });
}
describe("source simulation compiler", () => {
  it.each(["ngspice", "vacask"] as const)(
    "preserves missing parameter evidence for %s",
    (engine) => {
      const p = createEmptyProject("p", "Missing bias", "d");
      const d = p.documents[0]!;
      d.instances.push({
        id: "source",
        reference: "I1",
        symbolId: "current-source",
        placement: null,
        netlist: {
          binding: { kind: "primitive", deviceClass: "current-source" },
          parameters: { waveform: "dc" },
        },
      });
      d.nets.push(
        { id: "p", terminals: [{ instanceId: "source", pinName: "+" }] },
        { id: "n", terminals: [{ instanceId: "source", pinName: "-" }] },
      );
      const folder = createSimulationFolder({
        id: "f",
        name: "Missing",
        profileId: "local",
        documentId: d.id,
      });
      if (engine === "ngspice")
        folder.input.files.find((f) => f.path === folder.input.entry)!.text =
          "Missing\n.include circuit.spice\n.control\nop\n.endc\n.end\n";
      const compiled =
        engine === "ngspice"
          ? compileNgspiceSourceSimulation(p, folder)
          : compileSourceSimulation(p, folder);
      expect(compiled.ok).toBe(false);
      if (compiled.ok) throw new Error("Missing DC must be diagnosed");
      expect(compiled.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "MISSING_REQUIRED_PARAMETER",
            field: "d.source.dc",
            primary: expect.objectContaining({
              kind: "instance",
              objectId: "source",
              documentId: "d",
            }),
          }),
        ]),
      );
      expect(
        compiled.diagnostics
          .filter((item) => item.code === "GENERATED_NET_NAME")
          .every((item) => item.severity === "info"),
      ).toBe(true);
    },
  );
  it.each(["pulse", "sin", "pwl"])(
    "explains mode-specific DC for %s without blocking or rewriting the native program",
    (waveform) => {
      const p = createEmptyProject("p", "Bias modes", "d");
      const d = p.documents[0]!;
      d.instances.push({
        id: "source",
        reference: "V1",
        symbolId: "voltage-source",
        placement: null,
        netlist: {
          binding: { kind: "primitive", deviceClass: "voltage-source" },
          parameters: {
            waveform,
            dc: "3",
            low: "0",
            high: "1",
            delay: "1u",
            rise: "1n",
            fall: "1n",
            width: "1u",
            period: "3u",
            offset: "1",
            amplitude: "1",
            frequency: "1k",
            pwlPoints: "0 0, 1m 1",
          },
        },
      });
      d.nets.push(
        { id: "p", terminals: [{ instanceId: "source", pinName: "+" }] },
        { id: "n", terminals: [{ instanceId: "source", pinName: "-" }] },
      );
      const folder = createSimulationFolder({
        id: "f",
        name: "Native modes",
        profileId: "local",
        documentId: d.id,
      });
      const before = structuredClone({ p, folder });
      const compiled = compileSourceSimulation(p, folder);
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      const notices = compiled.warnings.filter(
        (w) => w.code === "SIMULATION_NATIVE_SOURCE_DC_MODE",
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        severity: "info",
        path: "circuit.spice",
        field: `${d.id}.source.dc`,
      });
      expect(notices[0]!.message).toContain('alter instance("V1") type="dc"');
      expect({ p, folder }).toEqual(before);
      expect(compiled.authoredFiles).toEqual(folder.input.files);
      expect(
        compiled.files.find((f) => f.path === folder.input.entry)!.text,
      ).not.toContain("alter instance");
      d.instances[0]!.netlist!.parameters.waveform = "dc";
      const dc = compileSourceSimulation(p, folder);
      expect(
        dc.ok &&
          dc.warnings.some(
            (w) => w.code === "SIMULATION_NATIVE_SOURCE_DC_MODE",
          ),
      ).toBe(false);
    },
  );
  it("never prepares stale committed bytes while an unapplied saved draft exists", () => {
    const folder = raw("Test\ncontrol\nanalysis bias op\nendc\n");
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
  it("rejects JSON measurement authority, including former intrinsic Noise output ids", () => {
    const folder = raw("Test\ncontrol\nanalysis bias op\nendc\n");
    const file = folder.input.files.find(
      (f) => f.path === folder.input.configPath,
    )!;
    for (const outputId of [
      "noise-output-density",
      "noise-input-density",
      "noise-typo",
    ]) {
      const measurements = [
        {
          id: "m",
          label: "Peak",
          outputId,
          analysis: "noise",
          method: { kind: "maximum" },
        },
      ];
      file.text = JSON.stringify({
        version: 2,
        environment: { profileId: "p" },
        measurements,
      });
      const result = compileSourceSimulation(project(), folder);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(
          result.diagnostics.some(
            (d) => d.code === "SIMULATION_CONFIG_INVALID",
          ),
        ).toBe(true);
    }
  });
  it("preserves native code and native vector ownership without requiring a Canvas", () => {
    const text =
      "Native\r\nmodel voltage vsource\r\nmodel resistance resistor\r\nV1 (In 0) voltage dc=1\r\nR1 (In Out) resistance r=1k\r\nR2 (Out 0) resistance r=1k\r\ncontrol\r\nsave v(Out)\r\nanalysis bias op\r\nendc\r\n";
    const compiled = compileSourceSimulation(project(), raw(text));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.files[0]!.text).toBe(text);
    expect(compiled.generated).toEqual([]);
    // Acquisition lives in source and observed native output, not JSON copies.
    expect(compiled.vectors).toEqual([]);
    expect(compiled.outputs).toEqual([]);
  });
  it("preserves legacy OTA acquisition intent without relabelling ngspice source as native", () => {
    const before = project();
    for (const folder of legacySetups()) {
      if (folder.input.kind !== "structured") continue;
      const migrated = migrateSimulationSetupToSource(before, folder).folder;
      const saved = structuredClone(migrated);
      const compiled = compileSourceSimulation(before, migrated);
      expect(
        compiled.ok,
        JSON.stringify(compiled.ok ? [] : compiled.diagnostics),
      ).toBe(false);
      expect(compiled).toMatchObject({
        ok: false,
        diagnostics: [{ code: "SIMULATION_LEGACY_SOURCE" }],
      });
      const original = buildSimulationPlan(before, folder);
      expect(original.ok).toBe(true);
      if (!original.ok) continue;
      const retained = JSON.parse(
        migrated.input.files.find((f) => f.path === migrated.input.configPath)!
          .text,
      );
      expect(retained.measurements).toEqual(original.measurements);
      expect(
        retained.outputs.map(
          ({ id, label }: { id: string; label: string }) => ({ id, label }),
        ),
      ).toEqual(original.outputs.map(({ id, label }) => ({ id, label })));
      expect(migrated).toEqual(saved);
    }
    expect(before).toEqual(project());
  });
  it("does not widen an explicit native save list when including Canvas-generated topology", () => {
    const before = project();
    const original = legacySetups().find(
      (s) => s.input.kind === "structured" && s.input.outputs.length,
    )!;
    const folder = migrateSimulationSetupToSource(before, original).folder;
    nativeConfig(folder);
    const entry = folder.input.files.find(
      (f) => f.path === folder.input.entry,
    )!;
    entry.text = `Explicit acquisition\ninclude "${folder.input.circuitBindings[0]!.path}"\ncontrol\nsave v(0)\nanalysis bias op\nendc\n`;
    const compiled = compileSourceSimulation(before, folder);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const prepared = compiled.files.find(
      (f) => f.path === folder.input.entry,
    )!.text;
    expect(prepared).toContain("save v(0)");
    expect(prepared).not.toContain("save all");
    expect(prepared).not.toContain("save default");
    expect(prepared).toBe(entry.text);
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
    nativeConfig(folder);
    const internalNet = root.nets.find(
      (net) =>
        net.scope !== "global" &&
        !root.ports.some((port) => port.netName === net.name),
    )!;
    const ports = root.ports.map((_, i) => `input${i}`).join(" ");
    folder.input.files.find((f) => f.path === folder.input.entry)!.text =
      `Calls\ninclude "${binding.path}"\nXLEFT (${ports}) ${root.name}\nXRIGHT (${ports}) ${root.name}\ncontrol\nsave v('XLEFT:${internalNet.name}') v('XRIGHT:${internalNet.name}')\nanalysis bias op\nendc\n`;
    const compiled = compileSourceSimulation(before, folder);
    expect(
      compiled.ok,
      JSON.stringify(compiled.ok ? [] : compiled.diagnostics),
    ).toBe(true);
    if (!compiled.ok) return;
    const signals = simulationSignals(before, folder.input);
    for (const call of ["XLEFT", "XRIGHT"]) {
      expect(signals[`${call}:${internalNet.name}`]?.targets).toContainEqual(
        expect.objectContaining({ documentId: root.id, netId: internalNet.id }),
      );
    }
    for (const [index] of root.ports.entries())
      expect(signals[`input${index}`]).toBeDefined();
  });
  it("returns source diagnostics for broken author/config text instead of throwing", () => {
    const folder = raw('Title\ninclude "missing.spice"\n');
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
