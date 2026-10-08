import { describe, expect, it } from "vitest";
import { createSimulationFolder } from "@icm/model";
import { externalModelFixture } from "./external-model-fixture.test-support.js";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import {
  generateCircuitSource,
  planCircuitSourceEdit,
} from "./simulation-circuit-source.js";
import { locateSimulationText } from "./simulation-source-map.js";
import { transformProjectModelSource } from "./model-source-transform.js";

function fixture() {
  const project = externalModelFixture();
  const source = project.modelSources![0]!;
  source.files[0]!.text =
    '.include "helper.spice"\n.subckt gain_block A B params: gain=2\nE1 drive 0 a 0 {GAIN}\nR1 drive b 1k\nC1 B 0 {1/(6.283185307179586*1k*1000)}\nXHELP a b HELPER\n.ends gain_block\n';
  source.draft = {
    entry: source.entry,
    baseRevision: 1,
    files: [{ path: source.entry, text: "INVALID DRAFT" }],
  };
  const folder = createSimulationFolder({
    id: "f",
    name: "Native",
    profileId: "candidate",
  });
  folder.input.entry = "run.sim";
  folder.input.files = [
    {
      path: "experiment.json",
      text: JSON.stringify({
        version: 2,
        environment: { profileId: "candidate" },
      }),
    },
    {
      path: "run.sim",
      text: 'External model\ninclude "circuit.inc"\ncontrol\nanalysis proof op\nendc\n',
    },
  ];
  folder.input.circuitBindings = [
    {
      id: "dut",
      path: "circuit.inc",
      documentId: project.topDocumentId!,
      emission: "subcircuit",
    },
  ];
  return { project, folder, source };
}

describe("Project external models in native VACASK", () => {
  it.each(["AC 1", "SIN(0 1 1k)", "DC 0 AC 1 SIN(0 1 1k)"])(
    "normalizes an independent native source body: %s",
    (body) => {
      const { project, folder, source } = fixture();
      source.files[1]!.text = `.subckt helper A B\nV1 A B ${body}\n.ends helper\n`;
      const compiled = compileSourceSimulation(project, folder);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      if (compiled.ok) {
        const text = compiled.generated[0]!.text;
        expect(text).not.toContain("value=");
        if (body.includes("SIN")) expect(text).toContain('type="sine"');
        if (body.includes("AC")) expect(text).toContain("mag=1");
      }
    },
  );
  it("refuses unbound independent source expressions at their owner", () => {
    const { project, folder, source } = fixture();
    source.files[1]!.text =
      ".subckt helper A B\nV1 A B value={UNKNOWN}\n.ends helper\n";
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok)
      expect(compiled.diagnostics).toContainEqual(
        expect.objectContaining({
          path: "helper.spice",
          sourceRef: expect.objectContaining({
            start: expect.objectContaining({ line: 2 }),
          }),
        }),
      );
  });
  it.each([
    "DC 0 SIN(1 1 1k)",
    "DC 0 SIN(0 1 1k 0 0 90)",
    "DC 0 PULSE(1 2 1u 1n 1n 1u 2u)",
    "DC 0 PWL(0 1 1u 2)",
  ])(
    "refuses independent DC bias that differs from native waveform bias: %s",
    (body) => {
      const { project, folder, source } = fixture();
      source.files[1]!.text = `.subckt helper A B\nV1 A B ${body}\n.ends helper\n`;
      const compiled = compileSourceSimulation(project, folder);
      expect(compiled.ok).toBe(false);
      if (!compiled.ok)
        expect(compiled.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "MODEL_SOURCE_DIALECT",
            path: "helper.spice",
            message: expect.stringContaining("DC bias"),
          }),
        );
    },
  );
  it("locates converted Spectre formal defaults at their native parameter statement", () => {
    const { project, folder, source } = fixture();
    source.language = "spectre";
    source.files = [
      {
        path: source.entry,
        text: "subckt gain_block (A B)\nparameters gain=UNKNOWN\nE1 (B 0 A 0) vcvs gain=gain\nends gain_block\n",
      },
    ];
    const bad = compileSourceSimulation(project, folder);
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(
        bad.diagnostics.find((d) => d.code === "MODEL_SOURCE_DIALECT"),
        JSON.stringify(bad),
      ).toMatchObject({ sourceRef: { start: { line: 2 } } });
    source.files[0]!.text = source.files[0]!.text.replace("UNKNOWN", "2");
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    if (compiled.ok) {
      const file = compiled.generated[0]!;
      expect(
        locateSimulationText(
          compiled.sourceMaps.find((m) => m.path === file.path)!,
          file.text.indexOf("parameters gain=2"),
        ),
      ).toMatchObject({
        kind: "model-source",
        startOffset: source.files[0]!.text.indexOf("parameters gain=2"),
      });
    }
  });
  it("locates Spectre defaults in an included native parameter file", () => {
    const { project, folder, source } = fixture();
    source.language = "spectre";
    source.files = [
      {
        path: source.entry,
        text: 'subckt gain_block (A B)\ninclude "params.scs"\nE1 (B 0 A 0) vcvs gain=gain\nends gain_block\n',
      },
      { path: "params.scs", text: "parameters gain=UNKNOWN\n" },
    ];
    const bad = compileSourceSimulation(project, folder);
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(
        bad.diagnostics.find((d) => d.code === "MODEL_SOURCE_DIALECT"),
      ).toMatchObject({
        path: "params.scs",
        sourceRef: { start: { line: 1, offset: 0 } },
      });
    source.files[1]!.text = "parameters gain=2\n";
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    if (compiled.ok) {
      const file = compiled.generated[0]!;
      expect(
        locateSimulationText(
          compiled.sourceMaps.find((m) => m.path === file.path)!,
          file.text.indexOf("parameters gain=2"),
        ),
      ).toMatchObject({
        kind: "model-source",
        path: "params.scs",
        startOffset: 0,
      });
    }
  });
  it("emits one closure across multiple bindings and avoids native primitive name collisions", () => {
    const { project, folder } = fixture();
    folder.input.circuitBindings.push({
      ...folder.input.circuitBindings[0]!,
      id: "other",
      path: "other.inc",
    });
    folder.input.files[1]!.text = folder.input.files[1]!.text.replace(
      'include "circuit.inc"',
      'model __icm_vcvs vsource\ninclude "other.inc"\ninclude "circuit.inc"',
    );
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    if (!compiled.ok) return;
    const text = compiled.generated.map((f) => f.text).join("\n");
    expect(text.match(/^subckt gain_block\b/gm)).toHaveLength(1);
    expect(text.match(/^subckt helper\b/gm)).toHaveLength(1);
    expect(text).toMatch(/E1 \(drive 0 A 0\) __icm_vcvs_/);
  });
  it.each([
    [".subckt helper A B\nR1 A B 1k gain=2\n.ends helper", "Unqualified"],
    [".subckt helper A B C\nR1 A B 1k\n.ends helper", "declares 3 ports"],
    [".subckt helper A B\nX1 A B missing\n.ends helper", "not defined"],
    [".subckt helper A B\nR1 A B {UNKNOWN}\n.ends helper", "not declared"],
    [".subckt helper A B\nR1 A B 1k\nr1 B A 2k\n.ends helper", "Duplicate"],
  ])(
    "refuses incorrect owned helper semantics without executing them: %s",
    (body, message) => {
      const { project, folder, source } = fixture();
      source.files[1]!.text = body;
      const compiled = compileSourceSimulation(project, folder);
      expect(compiled.ok).toBe(false);
      if (!compiled.ok)
        expect(
          compiled.diagnostics.find((d) => d.severity === "error"),
        ).toMatchObject({
          code: "MODEL_SOURCE_DIALECT",
          path: message === "declares 3 ports" ? source.entry : "helper.spice",
          message: expect.stringContaining(message),
        });
    },
  );
  it.each(["UNKNOWN", "GAIN"])(
    "refuses unbound/case-mismatched native Spectre parameter %s",
    (reference) => {
      const { project, folder, source } = fixture();
      source.language = "spectre";
      source.files = [
        {
          path: source.entry,
          text: `subckt gain_block (A B)\nparameters gain=2\nE1 (B 0 A 0) vcvs gain=${reference}\nends gain_block\n`,
        },
      ];
      const compiled = compileSourceSimulation(project, folder);
      expect(compiled.ok).toBe(false);
      if (!compiled.ok)
        expect(
          compiled.diagnostics.find((d) => d.severity === "error"),
        ).toMatchObject({
          code: "MODEL_SOURCE_DIALECT",
          path: source.entry,
          sourceRef: { start: { line: 3 } },
        });
    },
  );
  it("keeps converted Spectre helper navigation on the helper owner", () => {
    const { project, folder, source } = fixture();
    source.files[0]!.text = source.files[0]!.text.replaceAll("{GAIN}", "{gain}")
      .replaceAll(" a ", " A ")
      .replaceAll(" b ", " B ")
      .replace(" HELPER", " helper");
    const converted = transformProjectModelSource(source, {
      language: "spectre",
    });
    expect(converted.ok, JSON.stringify(converted)).toBe(true);
    if (!converted.ok) return;
    project.modelSources = [converted.source];
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    if (!compiled.ok) return;
    const file = compiled.generated[0]!;
    expect(
      locateSimulationText(
        compiled.sourceMaps.find((m) => m.path === file.path)!,
        file.text.indexOf("RHELP"),
      ),
    ).toMatchObject({
      kind: "model-source",
      path: "helper.spice",
      derived: true,
    });
  });
  it("projects native Spectre without changing its applied language or executing a draft", () => {
    const { project, folder, source } = fixture();
    source.language = "spectre";
    source.files = [
      {
        path: source.entry,
        text: "subckt gain_block (A B)\nparameters gain=2\nE1 (B 0 A 0) vcvs gain=gain\nends gain_block\n",
      },
    ];
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    if (compiled.ok)
      expect(compiled.generated[0]!.text).toMatch(
        /E1 \(B 0 A 0\).*gain=\(gain\)/,
      );
    expect(source.language).toBe("spectre");
  });
  it("keeps draft-only changes out of execution identity", () => {
    const { project, folder, source } = fixture();
    const applied = compileSourceSimulation(project, folder);
    delete source.draft;
    const clean = compileSourceSimulation(project, folder);
    expect(applied.ok && clean.ok).toBe(true);
    if (applied.ok && clean.ok) {
      expect(applied.files).toEqual(clean.files);
      expect(applied.electricalHash).toBe(clean.electricalHash);
    }
  });
  it("refuses an unsupported helper construct at its native owner, even behind a pending draft warning", () => {
    const { project, folder, source } = fixture();
    source.files[1]!.text =
      ".subckt helper A B\nBHELP B A V={v(A,B)}\n.ends helper\n";
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok)
      expect(
        compiled.diagnostics.find((d) => d.severity === "error"),
      ).toMatchObject({
        code: "MODEL_SOURCE_DIALECT",
        path: "helper.spice",
        sourceRef: { start: { line: 2 } },
        modelSource: { sourceId: source.id, revision: 1 },
      });
  });
  it("compiles the applied owned closure once with native parameter/node identity and mapped ownership", () => {
    const { project, folder, source } = fixture();
    const before = structuredClone({ project, folder });
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    if (!compiled.ok) return;
    const file = compiled.generated[0]!;
    expect(file.text.match(/^subckt gain_block\b/gm)).toHaveLength(1);
    expect(file.text.match(/^subckt helper\b/gm)).toHaveLength(1);
    expect(file.text).toMatch(/E1 \(drive 0 A 0\).*gain=\(gain\)/);
    expect(file.text).toMatch(/R1 \(drive B\).*r=1000/);
    expect(file.text).toMatch(/XHELP \(A B\) helper/);
    expect(file.text).not.toContain("INVALID DRAFT");
    expect(compiled.requiredModels).not.toContain("gain_block");
    expect(compiled.warnings).toContainEqual(
      expect.objectContaining({ code: "MODEL_SOURCE_DRAFT_PENDING" }),
    );
    const map = compiled.sourceMaps.find((m) => m.path === file.path)!;
    expect(locateSimulationText(map, file.text.indexOf("RHELP"))).toMatchObject(
      {
        kind: "model-source",
        sourceId: source.id,
        revision: 1,
        path: "helper.spice",
        derived: true,
      },
    );
    const preview = generateCircuitSource(
      project,
      folder.input.circuitBindings[0]!,
      folder.input,
      "vacask",
    );
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.source.text).toBe(file.text);
      expect(preview.source.modelLocations?.length).toBeGreaterThan(0);
      expect(
        planCircuitSourceEdit(
          preview.source,
          preview.source.text.replace("r=1000000", "r=2000000"),
        ),
      ).toMatchObject({ ok: false, code: "MODEL_SOURCE_EDIT_REQUIRES_OWNER" });
    }
    expect({ project, folder }).toEqual(before);
  });
});
