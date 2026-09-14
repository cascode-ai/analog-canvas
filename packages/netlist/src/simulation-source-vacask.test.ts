import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  createEmptyDocument,
  createSimulationFolder,
} from "@icm/model";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import {
  generateCircuitSource,
  planCircuitSourceEdit,
} from "./simulation-circuit-source.js";
import { parseVacaskRawfile } from "../../spice-run/src/vacask-rawfile.js";
import { nativeParameterDeclarationEdit } from "./simulation-native-parameter-edit.js";

function fixture() {
  const project = createEmptyProject("p", "Native sources", "a");
  project.documents.push(createEmptyDocument("b", "CellB"));
  for (const [index, d] of project.documents.entries()) {
    d.netlist!.name = index === 0 ? "CellA" : "CellB";
    d.instances.push(
      { id: "P", symbolId: "port", placement: null },
      { id: "N", symbolId: "port", placement: null },
      {
        id: "R",
        symbolId: "resistor",
        reference: "R",
        placement: null,
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: index === 0 ? "1k" : "2k" },
        },
      },
    );
    for (const [name, pinName] of [
      ["P", "1"],
      ["N", "2"],
    ]) {
      const id = `net-${name}`;
      d.nets.push({
        id,
        terminals: [
          { instanceId: name!, pinName: "P" },
          { instanceId: "R", pinName: pinName! },
        ],
      });
      d.netlist!.terminals.push({
        id: name!,
        name: name!,
        netId: id,
        direction: "passive",
        interfaceInstanceIds: [name!],
      });
    }
  }
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
      text: `Native multi-binding fixture
model voltage vsource
model __icm_resistor vsource
V1 (Left 0) voltage dc=1
V2 (Right 0) voltage dc=2
include "b.inc"
include "a.inc"
X1 (Left 0) CellA
X2 (Right 0) CellB
control
abort always
options rawfile="ascii" strictsave=2
save default
analysis proof op
endc
`,
    },
  ];
  folder.input.circuitBindings = [
    { id: "ba", documentId: "a", path: "a.inc", emission: "subcircuit" },
    { id: "bb", documentId: "b", path: "b.inc", emission: "subcircuit" },
  ];
  return { project, folder };
}
describe("public native source compilation", () => {
  it("shows the exact compiled multi-binding files and reverses mega without SPICE milli interpretation", () => {
    const { project, folder } = fixture();
    const compiled = compileSourceSimulation(project, folder);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    for (const binding of folder.input.circuitBindings) {
      const generated = generateCircuitSource(project, binding, folder.input);
      if (!generated.ok) throw Error(JSON.stringify(generated.diagnostics));
      expect(generated.source.text).toBe(
        compiled.generated.find((f) => f.bindingId === binding.id)!.text,
      );
      const span = generated.source.parameters.find(
        (p) => p.parameter === "value",
      )!;
      const next =
        generated.source.text.slice(0, span.startOffset) +
        "1M" +
        generated.source.text.slice(span.endOffset);
      expect(planCircuitSourceEdit(generated.source, next)).toMatchObject({
        ok: true,
        changes: [{ parameter: "value", value: "1000000" }],
      });
    }
  });
  it("shares generated primitive definitions across bindings without changing source bytes or the Project", () => {
    const { project, folder } = fixture();
    const before = JSON.stringify({ project, folder });
    const compiled = compileSourceSimulation(project, folder);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.language).toBe("vacask");
    expect(compiled.authority).toBe("code");
    expect(compiled.generated).toHaveLength(2);
    const generated = compiled.generated.map((f) => f.text).join("\n");
    expect(generated.match(/^load "resistor.osdi"/gm)).toHaveLength(1);
    expect(generated.match(/^model __icm_resistor_ resistor/gm)).toHaveLength(
      1,
    );
    expect(generated).toContain("subckt CellA (P N)");
    expect(generated).toContain("subckt CellB (P N)");
    expect(generated).not.toContain(".subckt");
    expect(
      compiled.files.find((f) => f.path === folder.input.entry)!.text,
    ).toBe(folder.input.files[1]!.text);
    expect(compiled.config.collection.rawfile).toBeNull();
    expect(compiled.outputs).toEqual([]);
    expect(compiled.vectors).toEqual([]);
    expect(JSON.stringify({ project, folder })).toBe(before);
    for (const file of compiled.generated)
      for (const parameter of file.parameters)
        expect(
          file.text.slice(parameter.startOffset, parameter.endOffset),
        ).toBe(parameter.rawValue);
  });
  it("allows code-only experiments and preserves unfamiliar native commands", () => {
    const { project, folder } = fixture();
    folder.input.circuitBindings = [];
    folder.input.files[1]!.text =
      "Title\ncontrol\nvar Result = unknown_function(2)\nendc\n";
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled).toMatchObject({
      ok: true,
      generated: [],
      reachedDocumentIds: [],
    });
    if (compiled.ok)
      expect(compiled.files[0]!.text).toBe(folder.input.files[1]!.text);
  });
  it("rejects legacy executable settings and syntax without losing their original bytes", () => {
    const { project, folder } = fixture();
    folder.input.files[0]!.text = JSON.stringify({
      version: 1,
      environment: { profileId: "old" },
    });
    const original = JSON.stringify(folder);
    expect(compileSourceSimulation(project, folder)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "SIMULATION_LEGACY_SOURCE" }],
    });
    expect(JSON.stringify(folder)).toBe(original);
    folder.input.files[0]!.text = JSON.stringify({
      version: 2,
      environment: { profileId: "candidate" },
    });
    folder.input.files[1]!.text = "Old title\n.control\nop\n.endc\n.end\n";
    const result = compileSourceSimulation(project, folder);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(
        result.diagnostics.every(
          (d) => d.sourceRef && d.code === "VACASK_SOURCE_SYNTAX",
        ),
      ).toBe(true);
  });
  it("refuses stale drafts and hidden electrical overrides while keeping nominal source intact", () => {
    const { project, folder } = fixture();
    const result = compileSourceSimulation(project, folder, {
      environment: { corner: "ff" },
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "SIMULATION_NATIVE_VARIANT_UNSUPPORTED" }],
    });
    folder.input.drafts = [
      {
        path: folder.input.entry,
        base: folder.input.files[1]!.text,
        text: "unfinished",
      },
    ];
    expect(compileSourceSimulation(project, folder)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "SIMULATION_SOURCE_DRAFT_PENDING" }],
    });
  });
  it("diagnoses shadowed global generated masters, but does not outlaw local native definitions", () => {
    const { project, folder } = fixture();
    folder.input.files[1]!.text += "\nsubckt CellA (p n)\nends\n";
    expect(compileSourceSimulation(project, folder)).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        {
          code: "SIMULATION_GENERATED_DEFINITION_SHADOWED",
          severity: "error",
          message: expect.any(String),
          path: "run.sim",
          sourceRef: expect.any(Object),
        },
      ]),
    });
    folder.input.files[1]!.text = folder.input.files[1]!.text.replace(
      "subckt CellA (p n)\nends",
      "subckt Local (p n)\nsubckt CellA (p n)\nends\nends",
    );
    expect(compileSourceSimulation(project, folder).ok).toBe(true);
  });
});

it.skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)(
  "executes the PUBLIC compiler's generated files in native VACASK with reversed include order",
  () => {
    const { project, folder } = fixture();
    const entry = folder.input.files.find(
      (f) => f.path === folder.input.entry,
    )!;
    const declaration = nativeParameterDeclarationEdit(entry.text, true);
    entry.text = (
      declaration.text.slice(0, declaration.anchor) +
      "VBIAS=1" +
      declaration.text.slice(declaration.anchor)
    ).replace("voltage dc=1", "voltage dc=VBIAS");
    const preview = generateCircuitSource(
      project,
      folder.input.circuitBindings[0]!,
      folder.input,
    );
    if (!preview.ok) throw Error(JSON.stringify(preview.diagnostics));
    const span = preview.source.parameters.find(
      (p) => p.parameter === "value",
    )!;
    const next =
      preview.source.text.slice(0, span.startOffset) +
      "1M" +
      preview.source.text.slice(span.endOffset);
    const planned = planCircuitSourceEdit(preview.source, next);
    if (!planned.ok) throw Error(planned.message);
    for (const change of planned.changes)
      project.documents
        .find((d) => d.id === change.documentId)!
        .instances.find((i) => i.id === change.instanceId)!.netlist!.parameters[
        change.parameter
      ] = change.value;
    const compiled = compileSourceSimulation(project, folder);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const cwd = mkdtempSync(join(tmpdir(), "icm-public-native-compile-"));
    for (const file of compiled.files)
      writeFileSync(join(cwd, file.path), file.text);
    const startup = join(cwd, "startup.toml");
    writeFileSync(startup, "# controlled public compiler qualification\n");
    const run = spawnSync(
      process.env.VACASK_BIN!,
      ["--tomlfile", startup, "-n", "1", "-b", "1", compiled.entry],
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
        env: { ...process.env, SIM_MODULE_PATH: process.env.VACASK_MODULES },
      },
    );
    writeFileSync(join(cwd, "stdout.log"), run.stdout ?? "");
    writeFileSync(join(cwd, "stderr.log"), run.stderr ?? "");
    expect(run.error, cwd).toBeUndefined();
    expect(run.status, `${cwd}\n${run.stdout}\n${run.stderr}`).toBe(0);
    const raw = parseVacaskRawfile(
      readFileSync(join(cwd, "proof.raw"), "utf8"),
    );
    if (!raw.ok) throw Error(raw.error.message);
    const values = new Map(
      raw.plots[0]!.vectors.map((v) => [v.variable.name, v.real[0]]),
    );
    expect(values.get("Left")).toBe(1);
    expect(values.get("Right")).toBe(2);
    expect(values.get("V1:flow(br)")).toBeCloseTo(-0.000001, 12);
    expect(values.get("V2:flow(br)")).toBeCloseTo(-0.001, 12);
  },
);
