import { describe, expect, it } from "vitest";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import {
  nativeSimulationDevices,
  nativeTerminalCurrent,
} from "./simulation-native-devices.js";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import { nativeAcquisitionEdit } from "./simulation-native-save-edit.js";
import { generateCircuitSource } from "./simulation-circuit-source.js";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseVacaskRawfile } from "../../spice-run/src/vacask-rawfile.js";

function fixture(m = "1") {
  const project = createEmptyProject("p", "Terminal sensing", "dut");
  const doc = project.documents[0]!;
  doc.netlist!.name = "DUT";
  doc.instances.push({
    id: "r",
    reference: "R1",
    symbolId: "resistor",
    placement: null,
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { value: "1k", m },
    },
  });
  for (const [index, pin] of ["P", "N"].entries()) {
    doc.instances.push({ id: pin, symbolId: "port", placement: null });
    doc.nets.push({
      id: pin,
      terminals: [
        { instanceId: "r", pinName: String(index + 1) },
        { instanceId: pin, pinName: "P" },
      ],
    });
    doc.netlist!.terminals.push({
      id: pin,
      name: pin,
      netId: pin,
      direction: "passive",
      interfaceInstanceIds: [pin],
    });
  }
  const folder = createSimulationFolder({
    id: "f",
    name: "Sense",
    profileId: "local",
  });
  folder.input.circuitBindings = [
    {
      id: "binding",
      documentId: doc.id,
      path: "dut.inc",
      emission: "subcircuit",
    },
  ];
  const entry = folder.input.files.find((f) => f.path === folder.input.entry)!;
  entry.text = `Native current proof
ground 0
model supply vsource
VEXT (out 0) supply dc=1 mag=1
include "dut.inc"
X1 (out 0) DUT
x1 (out 0) DUT
control
abort always
options rawfile="ascii" strictsave=2
save default
analysis bias op
analysis response ac values=[1000]
endc
`;
  return { project, folder, doc, entry };
}
function choose(f: ReturnType<typeof fixture>) {
  const baseline = compileSourceSimulation(f.project, f.folder);
  if (!baseline.ok) throw Error(JSON.stringify(baseline.diagnostics));
  const devices = nativeSimulationDevices(f.project, f.folder.input);
  const senses = devices.flatMap((d) => d.currentSenses);
  const edited = nativeAcquisitionEdit(
    f.entry.text,
    f.entry.text.indexOf("analysis bias"),
    senses.map((s) => s.save),
    true,
  );
  if (!edited.ok) throw Error(edited.error.message);
  f.entry.text = edited.text;
  return senses;
}

describe("native terminal sense compilation", () => {
  it("derives stable signed branches from saves, shows them in Circuit and removes them with source undo", () => {
    const f = fixture();
    const before = structuredClone(f.project);
    const nominal = f.entry.text;
    const senses = choose(f);
    expect(new Set(senses.map((s) => s.reference)).size).toBe(4);
    const compiled = compileSourceSimulation(f.project, f.folder);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const circuit = compiled.generated[0]!.text;
    for (const sense of senses) {
      const signal = compiled.signals[sense.vector]!;
      expect(signal.label).toBe(
        `I(${sense.reference.split(":")[0]}/R1.${sense.pinName})`,
      );
      expect(signal.targets).toEqual([
        {
          rootDocumentId: f.doc.id,
          documentId: f.doc.id,
          netId: sense.pinName === "1" ? "P" : "N",
          occurrence: [],
          terminal: { instanceId: "r", pinName: sense.pinName },
        },
      ]);
    }
    // One definition, two occurrences: instrument each selected pin once, but
    // preserve all four case-sensitive acquisition paths.
    for (const sense of senses.slice(0, 2))
      expect(circuit.split(sense.senseReference)).toHaveLength(2);
    const preview = generateCircuitSource(
      f.project,
      f.folder.input.circuitBindings[0]!,
      f.folder.input,
    );
    expect(preview.ok && preview.source.text).toBe(circuit);
    expect(preview.ok && preview.source.sourceBodies).toEqual([]);
    f.doc.instances.reverse();
    expect(
      new Set(
        nativeSimulationDevices(f.project, f.folder.input).flatMap((d) =>
          d.currentSenses.map((s) => s.reference),
        ),
      ),
    ).toEqual(new Set(senses.map((s) => s.reference)));
    f.doc.instances.reverse();
    expect(f.project).toEqual(before);
    f.entry.text = nominal;
    const undo = compileSourceSimulation(f.project, f.folder);
    expect(undo.ok && undo.generated[0]!.text).not.toContain("__icm_sense_");
    expect(undo.ok && undo.signals[senses[0]!.vector]).toBeUndefined();
    f.doc.instances[0]!.reference = "R2";
    expect(compiled.signals[senses[0]!.vector]!.label).toBe("I(X1/R1.1)");
  });
  it("rejects stale generated branch names instead of silently rebinding to another terminal", () => {
    const f = fixture();
    choose(f);
    f.doc.instances.find((i) => i.id === "r")!.id = "replacement";
    for (const net of f.doc.nets)
      for (const pin of net.terminals)
        if (pin.instanceId === "r") pin.instanceId = "replacement";
    const compiled = compileSourceSimulation(f.project, f.folder);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok)
      expect(
        compiled.diagnostics.some(
          (d) => d.code === "SIMULATION_CURRENT_SENSE_UNRESOLVED",
        ),
      ).toBe(true);
  });
  it("captures an existing unit voltage-source branch without adding a sensor", () => {
    const f = fixture();
    Object.assign(f.doc.instances[0]!, {
      reference: "V1",
      symbolId: "voltage-source",
      netlist: {
        binding: { kind: "primitive", deviceClass: "voltage-source" },
        parameters: { dc: "1" },
      },
    });
    for (const net of f.doc.nets)
      for (const pin of net.terminals)
        if (pin.instanceId === "r")
          pin.pinName = pin.pinName === "1" ? "+" : "-";
    f.entry.text = f.entry.text
      .replace("VEXT (out 0) supply dc=1 mag=1\n", "")
      .replace("x1 (out 0) DUT\n", "");
    const compiled = compileSourceSimulation(f.project, f.folder);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.signals["X1:V1:flow(br)"]!.targets[0]!.terminal).toEqual({
      instanceId: "r",
      pinName: "+",
    });
    expect(compiled.signals["X1:V1:flow(br)"]!.label).toBe("I(X1/V1.+)");
    expect(compiled.generated[0]!.text).not.toContain("__icm_sense_");
  });
  it("rejects collisions without changing stable identities or lending model id semantics", () => {
    const f = fixture();
    const original = nativeSimulationDevices(f.project, f.folder.input)[0]!;
    const sense = original.currentSenses[0]!;
    f.doc.netlist!.terminals[0]!.name = sense.senseNode;
    const changed = nativeSimulationDevices(f.project, f.folder.input)[0]!;
    expect(changed.currentSenses[0]!.reference).toBe(sense.reference);
    expect(nativeTerminalCurrent(changed, "1").ok).toBe(false);
    f.entry.text = f.entry.text.replace("save default", `save ${sense.save}`);
    const compiled = compileSourceSimulation(f.project, f.folder);
    expect(compiled.ok).toBe(false);
  });
  it("accepts the native unknown alias and detects a global private-node collision", () => {
    const f = fixture();
    const sense = choose(f)[0]!;
    f.entry.text = f.entry.text.replace(sense.save, `v('${sense.vector}')`);
    const compiled = compileSourceSimulation(f.project, f.folder);
    expect(compiled.ok && compiled.generated[0]!.text).toContain(
      sense.senseReference,
    );
    f.entry.text = f.entry.text.replace(
      "ground 0",
      `ground 0\nglobal ${sense.senseNode}`,
    );
    const collision = compileSourceSimulation(f.project, f.folder);
    expect(collision.ok).toBe(false);
    if (!collision.ok) {
      const diagnostic = collision.diagnostics.find(
        (d) => d.code === "SIMULATION_CURRENT_SENSE_UNRESOLVED",
      );
      expect(diagnostic?.sourceRef?.start.line).toBeGreaterThan(0);
    }
  });
  it
    .skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)
    .each(
      [1, 3].flatMap((m) =>
        ["resistor", "nmos", "pmos"].map((kind) => ({ m, kind })),
      ),
    )(
    "measures signed terminal currents in real OP/AC: $kind m=$m",
    ({ m, kind }) => {
      const f = fixture(String(m));
      if (kind !== "resistor") {
        // Illustrative default BSIM4 verifies sensing, not a foundry model.
        const polarity = kind === "pmos" ? -1 : 1;
        f.doc.instances = [
          {
            id: "mos",
            reference: "M1",
            symbolId: kind,
            placement: null,
            netlist: {
              binding: { kind: "model", deviceClass: "mos", name: "core" },
              parameters: { w: "5u", l: "1u", m: String(m) },
            },
          },
        ];
        f.doc.nets = [];
        f.doc.netlist!.terminals = [];
        for (const pin of ["D", "G", "S", "B"]) {
          f.doc.instances.push({ id: pin, symbolId: "port", placement: null });
          f.doc.nets.push({
            id: pin,
            terminals: [
              { instanceId: "mos", pinName: pin },
              { instanceId: pin, pinName: "P" },
            ],
          });
          f.doc.netlist!.terminals.push({
            id: pin,
            name: pin,
            netId: pin,
            direction: "passive",
            interfaceInstanceIds: [pin],
          });
        }
        f.entry.text = f.entry.text
          .replace(
            "model supply vsource",
            `load "spice/bsim4v8.osdi"\nmodel core sp_bsim4v8 type=${polarity}\nmodel supply vsource`,
          )
          .replace(
            "VEXT (out 0) supply dc=1 mag=1",
            `VEXT (out 0) supply dc=${polarity * 1.8}\nVG (g 0) supply dc=${polarity} mag=1`,
          )
          .replaceAll("(out 0) DUT", "(out g 0 0) DUT")
          .replace("save default", "save default i(VEXT) i(VG)");
      }
      const senses = choose(f);
      const compiled = compileSourceSimulation(f.project, f.folder);
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      const root = mkdtempSync(join(tmpdir(), "icm-native-terminal-"));
      const startup = join(root, "startup.toml");
      writeFileSync(startup, "");
      for (const file of compiled.files) {
        const path = join(root, file.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.text);
      }
      const run = spawnSync(
        process.env.VACASK_BIN!,
        ["--tomlfile", startup, "-n", "1", "-b", "1", compiled.entry],
        {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
          timeout: 20000,
          env: {
            ...process.env,
            SIM_MODULE_PATH: process.env.VACASK_MODULES,
            ...(process.env.ICM_VACASK_LIBRARY_PATH
              ? { LD_LIBRARY_PATH: process.env.ICM_VACASK_LIBRARY_PATH }
              : {}),
          },
        },
      );
      expect(run.status, `${root}\n${run.stdout}\n${run.stderr}`).toBe(0);
      for (const file of ["bias.raw", "response.raw"]) {
        const parsed = parseVacaskRawfile(
          readFileSync(join(root, file), "utf8"),
        );
        if (!parsed.ok) throw Error(parsed.error.message);
        for (const sense of senses) {
          const vector = parsed.plots[0]!.vectors.find(
            (v) => v.variable.name === sense.vector,
          );
          expect(vector, `${file}: ${sense.vector}`).toBeDefined();
          if (kind === "resistor") {
            expect(vector!.real[0]).toBeCloseTo(
              ((sense.pinName === "1" ? 1 : -1) * m) / 1000,
              10,
            );
            if (file === "response.raw")
              expect(vector!.imag![0]).toBeCloseTo(0, 10);
          } else if (["D", "G"].includes(sense.pinName)) {
            const supply = parsed.plots[0]!.vectors.find(
              (v) =>
                v.variable.name ===
                `${sense.pinName === "D" ? "VEXT" : "VG"}:flow(br)`,
            )!;
            // Two equal occurrences share the external supply. Compare actual
            // terminal-total current, never per-model id or gm outputs.
            expect(vector!.real[0]).toBeCloseTo(-supply.real[0]! / 2, 10);
            if (file === "response.raw")
              expect(vector!.imag![0]).toBeCloseTo(-supply.imag![0]! / 2, 10);
            if (file === "bias.raw" && sense.pinName === "D")
              expect(
                vector!.real[0]! * (kind === "pmos" ? -1 : 1),
              ).toBeGreaterThan(1e-6);
          }
        }
        if (kind !== "resistor") {
          for (const occurrence of ["X1", "x1"]) {
            const pins = senses
              .filter((s) => s.reference.startsWith(`${occurrence}:`))
              .map((s) =>
                parsed.plots[0]!.vectors.find(
                  (v) => v.variable.name === s.vector,
                )!,
              );
            expect(pins).toHaveLength(4);
            expect(pins.reduce((sum, v) => sum + v.real[0]!, 0)).toBeCloseTo(
              0,
              10,
            );
            if (file === "response.raw")
              expect(pins.reduce((sum, v) => sum + v.imag![0]!, 0)).toBeCloseTo(
                0,
                10,
              );
          }
        }
      }
      rmSync(root, { recursive: true });
    },
  );
});
