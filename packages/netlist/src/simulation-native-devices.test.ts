import { describe, expect, it } from "vitest";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileNativeDeviceOperatingPoints,
  nativeDeviceOpAcquisitions,
  nativeSimulationDevices,
  nativeTerminalCurrent,
} from "./simulation-native-devices.js";
import { nativeAcquisitionEdit } from "./simulation-native-save-edit.js";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import { parseVacaskRawfile } from "../../spice-run/src/vacask-rawfile.js";
import { readVacaskSimulationData } from "@icm/spice-run";
import { evaluateSimulationOutputs } from "../../simulation-service/src/output-evaluation.js";
import { SimulationOutputDataSchema } from "../../simulation-service/src/contract.js";
import { CapabilitiesSchema } from "../../simulation-service/src/contract.js";
import { prepareSourceExecutionInput } from "../../simulation-service/src/prepare-source.js";
import {
  inspectNativeModelLibrarySymbols,
  type NativeModelLibrarySymbols,
} from "./vacask-model-symbols.js";
import { sha256Hex } from "@icm/derived";
import { sourceProbeChoices } from "../../../apps/editor/src/features/simulation/source-probe-choices.js";

// Illustrative default BSIM4, not a substitute for any foundry model.
function fixture(pmos = false) {
  const project = createEmptyProject("p", "Native model identity", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "DUT";
  document.instances.push({
    id: "mos",
    reference: "M1",
    symbolId: pmos ? "pmos" : "nmos",
    placement: null,
    netlist: {
      binding: { kind: "model", deviceClass: "mos", name: "core" },
      parameters: { w: "5u", l: "1u" },
    },
  });
  for (const pin of ["D", "G", "S", "B"]) {
    document.instances.push({ id: pin, symbolId: "port", placement: null });
    document.nets.push({
      id: pin,
      terminals: [
        { instanceId: "mos", pinName: pin },
        { instanceId: pin, pinName: "P" },
      ],
    });
    document.netlist!.terminals.push({
      id: pin,
      name: pin,
      netId: pin,
      direction: "passive",
      interfaceInstanceIds: [pin],
    });
  }
  const folder = createSimulationFolder({
    id: "f",
    name: "Native OP",
    profileId: "candidate",
  });
  folder.input.entry = "run.sim";
  folder.input.circuitBindings = [
    {
      id: "binding",
      documentId: document.id,
      path: "dut.inc",
      emission: "subcircuit",
    },
  ];
  folder.input.files = [
    {
      path: folder.input.configPath,
      text: JSON.stringify({
        version: 2,
        environment: { profileId: "candidate" },
      }),
    },
    {
      path: "run.sim",
      text: `Illustrative native OP identity
ground 0
load "spice/bsim4v8.osdi"
model core sp_bsim4v8 type=${pmos ? -1 : 1}
model voltage vsource
VD (d 0) voltage dc=${pmos ? -1.8 : 1.8}
VG (g 0) voltage dc=${pmos ? -1 : 1}
include "dut.inc"
X1 (d g 0 0) DUT
x1 (d g 0 0) DUT
control
abort always
options rawfile="ascii" strictsave=2
save default
analysis proof op
endc
`,
    },
  ];
  return { project, folder, document, source: folder.input.files[1]! };
}

describe("native Canvas device acquisitions", () => {
  it("shares digest/section-bound symbols with the picker, respecting conditional loads and authored shadows", () => {
    const { project, folder, source } = fixture();
    const library: NativeModelLibrarySymbols = {
      dependencyId: "models",
      sha256: "a".repeat(64),
      section: "tt",
      masters: [
        { name: "core", primitives: [{ path: [], module: "sp_bsim4v8" }] },
      ],
    };
    source.text = source.text.replace(
      "model core sp_bsim4v8 type=1",
      'include "library.inc" section=tt',
    );
    folder.input.dependencies = [
      { id: "models", sha256: library.sha256, mountPath: "library.inc" },
    ];
    const devices = () =>
      nativeSimulationDevices(project, folder.input, [library]);
    expect(devices().flatMap(nativeDeviceOpAcquisitions)).toHaveLength(18);
    expect(
      sourceProbeChoices(project, folder.input, [library]).filter(
        (p) => p.kind === "device-op",
      ),
    ).toHaveLength(18);
    for (const replacement of [
      'include "library.inc" section=ff',
      '@if enabled\ninclude "library.inc" section=tt\n@end',
      'include "library.inc" section=tt\nmodel core resistor',
    ]) {
      const original = source.text;
      source.text = source.text.replace(
        'include "library.inc" section=tt',
        replacement,
      );
      expect(devices().flatMap(nativeDeviceOpAcquisitions)).toEqual([]);
      source.text = original;
    }
    folder.input.dependencies[0]!.sha256 = "b".repeat(64);
    expect(devices().flatMap(nativeDeviceOpAcquisitions)).toEqual([]);
    const caps = {
      configured: true,
      inputs: ["source"],
      analyses: ["op"],
      parsedAnalyses: ["op"],
      maxTimeoutMs: 10000,
      maxInputBytes: 100000,
      cancel: true,
      profiles: [
        {
          id: "candidate",
          corners: ["tt"],
          dependencies: [{ id: "models", sha256: library.sha256 }],
          modelSymbols: [library],
        },
      ],
    };
    expect(CapabilitiesSchema.safeParse(caps).success).toBe(true);
    caps.profiles[0]!.dependencies[0]!.sha256 = "b".repeat(64);
    expect(CapabilitiesSchema.safeParse(caps).success).toBe(false);
  });
  it("uses exact occurrence paths and returns separate model-native save selectors and raw keys", () => {
    const { project, folder } = fixture();
    const before = structuredClone({ project, folder });
    const devices = nativeSimulationDevices(project, folder.input).filter(
      (d) => d.polarity,
    );
    expect(devices.map((d) => d.reference)).toEqual(["X1:M1", "x1:M1"]);
    for (const device of devices) {
      expect(device.nativeDevice).toBe(device.reference);
      expect(nativeDeviceOpAcquisitions(device)).toContainEqual({
        reference: device.reference,
        parameter: "gm",
        vector: `${device.reference}.gm`,
        save: `p('${device.reference}',gm)`,
        semantics: "model-native",
      });
      expect(nativeTerminalCurrent(device, "D")).toMatchObject({
        ok: false,
        message: expect.stringContaining("zero-volt sense source"),
      });
      expect(nativeTerminalCurrent(device, "G").ok).toBe(false);
    }
    expect({ project, folder }).toEqual(before);
    const compiled = compileSourceSimulation(project, folder);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.vectors).toHaveLength(18);
    expect(compiled.deviceOperatingPoints.map((d) => d.reference)).toEqual([
      "X1:M1",
      "x1:M1",
    ]);
    expect(new Set(compiled.deviceOperatingPoints.map((d) => d.id)).size).toBe(
      2,
    );
    expect(compiled.files.find((f) => f.path === "run.sim")!.text).toBe(
      before.folder.input.files[1]!.text,
    );
    expect({ project, folder }).toEqual(before);
  });

  it("derives wrapper internals from authored models, not the SKY130 instance-name convention", () => {
    const { project, folder, document, source } = fixture();
    project.externalSubcircuitDefinitions.push({
      id: "external",
      name: "Device",
      interfaceStatus: "declared",
      formalParameters: [],
      terminals: ["D", "G", "S", "B"].map((name) => ({
        id: name,
        name,
        direction: "passive",
      })),
    });
    const instance = document.instances.find((i) => i.id === "mos")!;
    instance.reference = "XM1";
    instance.netlist!.binding = {
      kind: "external-subcircuit",
      definitionId: "external",
    };
    source.text = source.text.replace(
      'include "dut.inc"',
      `subckt Device (D G S B)
model core sp_bsim4v8 type=1
OddName (D G S B) core w=5u l=1u
ends
include "dut.inc"`,
    );
    const device = nativeSimulationDevices(project, folder.input).find(
      (d) => d.polarity,
    )!;
    expect(device.nativeDevice).toBeUndefined();
    expect(device.modelPrimitives).toEqual([
      { reference: "X1:XM1:OddName", module: "sp_bsim4v8" },
    ]);
    expect(nativeDeviceOpAcquisitions(device)[0]?.save).toBe(
      "p('X1:XM1:OddName',id)",
    );
    const compiled = compileSourceSimulation(project, folder);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.deviceOperatingPoints[0]).toMatchObject({
      documentId: document.id,
      instanceId: "mos",
      reference: "X1:XM1:OddName",
      polarity: "nmos",
    });
    const multiple = compileNativeDeviceOperatingPoints([
      {
        ...device,
        modelPrimitives: [
          ...device.modelPrimitives,
          { reference: "X1:XM1:Second", module: "sp_bsim4v8" },
        ],
      },
    ]);
    expect(multiple.deviceOperatingPoints.map((d) => d.reference)).toEqual([
      "X1:XM1:OddName",
      "X1:XM1:Second",
    ]);
    expect(
      multiple.deviceOperatingPoints.every((d) =>
        d.values.every((v) => v.expression.kind === "acquisition"),
      ),
    ).toBe(true);
  });

  it("does not advertise an output schema for a missing, conditional, ambiguous or different model", () => {
    for (const model of [
      "",
      "model core bsim4v8",
      "model core sp_bsim4v8\nmodel core resistor",
      "@if enabled\nmodel core sp_bsim4v8\n@end",
    ]) {
      const { project, folder, source } = fixture();
      source.text = source.text.replace("model core sp_bsim4v8 type=1", model);
      const devices = nativeSimulationDevices(project, folder.input).filter(
        (d) => d.polarity,
      );
      expect(devices).toHaveLength(2);
      expect(devices.flatMap(nativeDeviceOpAcquisitions)).toEqual([]);
      expect(compileNativeDeviceOperatingPoints(devices)).toEqual({
        vectors: [],
        deviceOperatingPoints: [],
      });
    }
  });

  it("keeps voltage-source branch selection native and refuses non-unit total-current aliases", () => {
    const { project, folder, document } = fixture();
    const instance = document.instances.find((i) => i.id === "mos")!;
    instance.reference = "V1";
    instance.symbolId = "voltage-source";
    instance.netlist = {
      binding: { kind: "primitive", deviceClass: "voltage-source" },
      parameters: { dc: "1" },
    };
    // Reuse only D/G as the two native source terminals; S/B stay formal ports.
    for (const net of document.nets)
      net.terminals = net.terminals.flatMap((t) =>
        t.instanceId !== "mos"
          ? [t]
          : t.pinName === "D"
            ? [{ ...t, pinName: "+" }]
            : t.pinName === "G"
              ? [{ ...t, pinName: "-" }]
              : [],
      );
    const device = nativeSimulationDevices(project, folder.input).find(
      (d) => d.instanceId === "mos",
    )!;
    expect(nativeTerminalCurrent(device, "+")).toEqual({
      ok: true,
      vectors: ["i('X1:V1')"],
      directives: [],
    });
    expect(nativeTerminalCurrent(device, "-").ok).toBe(false);
    device.card.parameters.push({ name: "m", rawValue: "3" });
    expect(nativeTerminalCurrent(device, "+").ok).toBe(false);
  });
});

it.skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)(
  "executes public compiler plus native OP helper and matches independently captured N/P output keys and values",
  async () => {
    const reference = parseVacaskRawfile(
      readFileSync("netlists/vacask-device-outputs/bias.raw", "utf8"),
    );
    if (!reference.ok) throw Error(reference.error.message);
    for (const pmos of [false, true]) {
      const { project, folder, source } = fixture(pmos);
      const libraryText = `model core sp_bsim4v8 type=${pmos ? -1 : 1}\n`;
      const dependency = {
        id: "models",
        sha256: sha256Hex(libraryText),
        mountPath: "models.inc",
      };
      const libraryInput = {
        ...folder.input,
        entry: "inspect.sim",
        circuitBindings: [],
        files: [
          {
            path: "inspect.sim",
            text: 'Library inspection\ninclude "models.inc"\n',
          },
          { path: "models.inc", text: libraryText },
        ],
      };
      const inspected = inspectNativeModelLibrarySymbols(libraryInput, [
        "core",
      ]);
      expect(inspected.diagnostics).toEqual([]);
      const library: NativeModelLibrarySymbols = {
        dependencyId: dependency.id,
        sha256: dependency.sha256,
        masters: inspected.masters,
      };
      source.text = source.text.replace(
        libraryText.trim(),
        'include "models.inc"',
      );
      folder.input.dependencies = [dependency];
      const acquisitions = nativeSimulationDevices(project, folder.input, [
        library,
      ]).flatMap(nativeDeviceOpAcquisitions);
      expect(acquisitions).toHaveLength(18);
      const edit = nativeAcquisitionEdit(
        source.text,
        source.text.indexOf("analysis proof"),
        acquisitions.map((a) => a.save),
        true,
      );
      if (!edit.ok) throw Error(edit.error.message);
      source.text = edit.text.replace(
        "analysis proof op",
        "analysis proof op\nanalysis repeated op\nclear saves\nanalysis uncaptured op",
      );
      const prepared = await prepareSourceExecutionInput(
        project,
        folder,
        CapabilitiesSchema.parse({
          configured: true,
          rawfileCollection: "native-multi-ascii",
          inputs: ["source"],
          analyses: ["op"],
          parsedAnalyses: ["op"],
          profiles: [
            {
              id: "candidate",
              corners: [],
              dependencies: [{ id: dependency.id, sha256: dependency.sha256 }],
              modelSymbols: [library],
            },
          ],
          maxTimeoutMs: 10000,
          maxInputBytes: 1000000,
          cancel: true,
        }),
      );
      if (!prepared.ok) throw Error(JSON.stringify(prepared.error));
      expect(prepared.deviceOperatingPoints).toHaveLength(2);
      expect(prepared.vectors).toHaveLength(acquisitions.length);
      const cwd = mkdtempSync(join(tmpdir(), "icm-native-device-helper-"));
      for (const file of prepared.input.files!)
        writeFileSync(join(cwd, file.path), file.text);
      writeFileSync(join(cwd, dependency.mountPath), libraryText);
      const startup = join(cwd, "startup.toml");
      writeFileSync(startup, "# controlled native helper proof\n");
      const run = spawnSync(
        process.env.VACASK_BIN!,
        [
          "--tomlfile",
          startup,
          "-n",
          "1",
          "-b",
          "1",
          prepared.input.entryPath!,
        ],
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
      const parsed = parseVacaskRawfile(
        readFileSync(join(cwd, "proof.raw"), "utf8"),
      );
      if (!parsed.ok) throw Error(parsed.error.message);
      for (const acquisition of acquisitions) {
        const actual = parsed.plots[0]!.vectors.find(
          (v) => v.variable.name === acquisition.vector,
        )?.real[0];
        const expected = reference.plots[0]!.vectors.find(
          (v) =>
            v.variable.name === `${pmos ? "P" : "N"}1.${acquisition.parameter}`,
        )?.real[0];
        expect(actual, `${cwd} ${acquisition.vector}`).toBeDefined();
        expect(expected, acquisition.parameter).toBeDefined();
        expect(actual).toBeCloseTo(expected!, 11);
      }
      // The public compiler's captured map, not a reconstructed instance-name
      // convention, resolves every actual quantity to this Canvas occurrence.
      for (const device of prepared.deviceOperatingPoints) {
        expect(device).toMatchObject({
          documentId: "dut",
          instanceId: "mos",
          polarity: pmos ? "pmos" : "nmos",
        });
        for (const value of device.values) {
          expect(value.label).toBe(`${value.parameter} (model)`);
          if (value.expression.kind !== "acquisition")
            throw Error("Unexpected derived model value");
          const acquisitionId = value.expression.acquisitionId;
          const vector = prepared.vectors.find(
            (v) => v.probeId === acquisitionId,
          )!;
          expect(vector.vector).toBe(`${device.reference}.${value.parameter}`);
          expect(
            parsed.plots[0]!.vectors.find(
              (v) => v.variable.name === vector.vector,
            )?.real[0],
          ).toBeDefined();
        }
      }
      const artifacts = ["proof", "repeated", "uncaptured"].map((name) => ({
        path: `${name}.raw`,
        text: readFileSync(join(cwd, `${name}.raw`), "utf8"),
      }));
      const numeric = readVacaskSimulationData(
        artifacts,
        artifacts.map((a) => ({
          artifactPath: a.path,
          plotOrdinal: 0,
          analysis: "op" as const,
        })),
      );
      if (numeric.status !== "read") throw Error(JSON.stringify(numeric));
      const outputs = evaluateSimulationOutputs(
        numeric.data,
        prepared.vectors,
        prepared.outputs,
        [],
        prepared.deviceOperatingPoints,
        true,
      );
      expect(SimulationOutputDataSchema.safeParse(outputs).success).toBe(true);
      expect(outputs.diagnostics).toEqual([]);
      expect(outputs.deviceOperatingPoints).toHaveLength(4);
      expect(
        outputs.deviceOperatingPoints?.map((d) => d.analysisIndex),
      ).toEqual([0, 0, 1, 1]);
      for (const device of outputs.deviceOperatingPoints!) {
        expect(device.values).toHaveLength(9);
        for (const value of device.values) {
          const expected = reference.plots[0]!.vectors.find(
            (v) =>
              v.variable.name === `${pmos ? "P" : "N"}1.${value.parameter}`,
          )?.real[0];
          expect(value.status).toBe("available");
          if (value.status !== "available") throw Error(value.reason);
          expect(value.value).toBeCloseTo(expected!, 11);
        }
      }
      // No phantom OP rows after clear saves, and no reclassification of
      // the untouched native artifact bytes to make a missing value appear.
      expect(
        outputs.deviceOperatingPoints?.some((d) => d.analysisIndex === 2),
      ).toBe(false);
    }
  },
);
