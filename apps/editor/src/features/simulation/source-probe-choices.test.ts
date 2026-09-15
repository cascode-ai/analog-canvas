import { describe, it, expect } from "vitest";
import { parseProject } from "@icm/project-protocol";
import {
  createSimulationStarter,
  simulationSignalNames,
  simulationSignals,
  nativeSimulationDevices,
  nativeTerminalCurrent,
  inspectVacaskSourceGraph,
} from "@icm/netlist";
import { resolveSimulationVoltageProbeNetId } from "./simulation-probe-options";
import ota from "../../examples/five-transistor-ota-sky130.icproj.json";
import {
  sourceProbeChoices,
  sourceProbeEnvironment,
} from "./source-probe-choices";
import { nativeSky130OtaFixture } from "../../../../../packages/simulation-service/test-support/sky130-ota.js";
import {
  CapabilitiesSchema,
  prepareSourceExecutionInput,
} from "@icm/simulation-service";

const project = parseProject(JSON.stringify(ota));
describe("source Probe discovery", () => {
  it("uses the same implicit Profile library and collision-free mount as Prepare", async () => {
    const { project, folder, profile, library, acquisitions } =
      nativeSky130OtaFixture();
    folder.input.dependencies = [];
    folder.input.files.find((f) => f.path === folder.input.entry)!.text =
      folder.input.files
        .find((f) => f.path === folder.input.entry)!
        .text.replace('include "models/library.inc"\n', "");
    folder.input.files.push({
      path: "icm-models.inc",
      text: "User-owned file\n",
    });
    const selected = {
      ...profile,
      modelLibrary: { dependencyId: library.dependencyId },
    };
    const before = structuredClone({ project, folder });
    const context = sourceProbeEnvironment(project, folder, [selected]);
    expect(context.notice).toBeUndefined();
    expect(context.input.dependencies).toEqual([
      {
        id: library.dependencyId,
        sha256: library.sha256,
        mountPath: "icm-models-1.inc",
      },
    ]);
    const choices = sourceProbeChoices(
      project,
      context.input,
      context.libraries,
    );
    for (const a of acquisitions)
      expect(choices).toContainEqual(
        expect.objectContaining({
          kind: "device-op",
          expression: { kind: "vector", vector: a.save },
        }),
      );
    const prepared = await prepareSourceExecutionInput(
      project,
      folder,
      CapabilitiesSchema.parse({
        configured: true,
        rawfileCollection: "native-multi-ascii",
        inputs: ["source"],
        profiles: [selected],
        analyses: ["op", "ac"],
        parsedAnalyses: ["op", "ac"],
        maxTimeoutMs: 30000,
        maxInputBytes: 1048576,
        cancel: true,
      }),
    );
    if (!prepared.ok) throw Error(JSON.stringify(prepared));
    expect(prepared.input.files).toEqual(context.input.files);
    expect(prepared.input.dependencies).toEqual(context.input.dependencies);
    for (const a of acquisitions)
      expect(prepared.vectors.some((v) => v.vector === a.vector)).toBe(true);
    expect({ project, folder }).toEqual(before);
  });
  it("does not borrow model symbols from another Profile section", () => {
    const { project, folder, profile, library } = nativeSky130OtaFixture();
    folder.input.dependencies = [];
    folder.input.files.find((f) => f.path === folder.input.entry)!.text =
      folder.input.files
        .find((f) => f.path === folder.input.entry)!
        .text.replace('include "models/library.inc"\n', "");
    const context = sourceProbeEnvironment(project, folder, [
      {
        ...profile,
        corners: ["tt", "ff"],
        modelSymbols: [{ ...library, section: "tt" }],
        modelLibrary: {
          dependencyId: library.dependencyId,
          defaultSection: "ff",
        },
      },
    ]);
    expect(context.notice).toBeUndefined();
    expect(
      sourceProbeChoices(project, context.input, context.libraries).filter(
        (c) => c.kind === "device-op",
      ),
    ).toEqual([]);
  });
  it("explains an unavailable dependency without hiding ordinary offline signals", () => {
    const { project, folder, profile } = nativeSky130OtaFixture();
    folder.input.dependencies[0]!.sha256 = "0".repeat(64);
    const context = sourceProbeEnvironment(project, folder, [profile]);
    expect(context.notice).toContain("not available in the selected Profile");
    expect(context.libraries).toEqual([]);
    const choices = sourceProbeChoices(
      project,
      context.input,
      context.libraries,
    );
    expect(choices.some((c) => c.kind === "voltage")).toBe(true);
    expect(choices.some((c) => c.kind === "device-op")).toBe(false);
    expect(sourceProbeEnvironment(project, folder).notice).toBeUndefined();
  });
  it("offers raw model OP through native paths without aliasing it to terminal current", () => {
    const before = JSON.stringify(project);
    const started = createSimulationStarter(project, {
      id: "op",
      name: "Native model OP",
      profileId: "candidate",
      mode: "circuit",
      documentId: project.topDocumentId,
    });
    if (!started.ok) throw Error(started.message);
    const input = started.folder.input;
    const initial = nativeSimulationDevices(project, input);
    const target = initial.find((d) => d.polarity)!.card.target!;
    // Source-identity fixture only, not a SKY130 numerical qualification.
    input.files.find((f) => f.path === input.entry)!.text +=
      `\nsubckt ${target} (D G S B)\nmodel core sp_bsim4v8 type=1\nInner (D G S B) core\nends\n`;
    const devices = nativeSimulationDevices(project, input);
    const mos = devices.find(
      (device) => device.polarity && device.card.target === target,
    )!;
    expect(mos.nativeDevice).toBeUndefined();
    expect(nativeTerminalCurrent(mos, "D")).toMatchObject({
      ok: true,
      vectors: [mos.currentSenses.find((s) => s.pinName === "D")!.save],
    });
    expect(nativeTerminalCurrent(mos, "G")).toMatchObject({ ok: true });
    const choices = sourceProbeChoices(project, input);
    expect(
      choices.some(
        (choice) =>
          choice.kind === "device-op" &&
          choice.label.includes("gm (model-native)") &&
          choice.expression.kind === "vector" &&
          choice.expression.vector.endsWith(",gm)"),
      ),
    ).toBe(true);
    expect(JSON.stringify(project)).toBe(before);
  });
  it("maps native vectors back to valid Canvas nets through the same naming traversal", () => {
    const started = createSimulationStarter(project, {
      id: "mapped",
      name: "Native mapping",
      profileId: "candidate",
      mode: "circuit",
      documentId: project.topDocumentId,
    });
    if (!started.ok) throw Error(started.message);
    const input = started.folder.input;
    const signals = simulationSignals(project, input);
    expect(Object.keys(signals).length).toBeGreaterThan(0);
    expect(
      Object.fromEntries(
        Object.entries(signals).map(([vector, signal]) => [
          vector,
          signal.label,
        ]),
      ),
    ).toEqual(simulationSignalNames(project, input));
    for (const signal of Object.values(signals))
      for (const target of signal.targets) {
        expect(
          resolveSimulationVoltageProbeNetId(project, {
            kind: "voltage",
            documentId: target.documentId,
            occurrence: target.occurrence,
            anchor: { kind: "base-net", netId: target.netId },
          }),
        ).toBeDefined();
      }
    expect(
      Object.values(signals).some((signal) =>
        signal.targets.some((target) => target.occurrence.length > 0),
      ),
    ).toBe(true);
  });
  it("addresses multiple DUT occurrences rather than silently choosing the first", () => {
    const result = createSimulationStarter(project, {
      id: "test",
      name: "Test",
      profileId: "test",
      documentId: "document-ota-5t",
      mode: "dut",
    });
    if (!result.ok) throw new Error(result.message);
    const input = result.folder.input;
    const tb = input.files.find((f) => f.path === "testbench.spice")!;
    tb.text +=
      "\n" +
      tb.text
        .split("\n")
        .find((line) => line.startsWith("XDUT "))!
        .replace("XDUT ", "XSECOND ");
    const choices = sourceProbeChoices(project, input);
    const names = simulationSignalNames(project, input);
    expect(Object.keys(names).some((name) => name.startsWith("XDUT:"))).toBe(
      true,
    );
    expect(Object.keys(names).some((name) => name.startsWith("XSECOND:"))).toBe(
      true,
    );
    expect(Object.values(names).some((name) => name.includes("XDUT/"))).toBe(
      true,
    );
    const call = inspectVacaskSourceGraph(input).statements.find(
      ({ statement }) => statement.tokens[0]?.value === "XDUT",
    )!.statement;
    const callNodes = call.tokens
      .slice(
        2,
        call.tokens.findIndex((t) => t.value === ")"),
      )
      .map((t) => t.value);
    for (const node of callNodes) expect(names[node]).toBeDefined();
    expect(names["XDUT:0"]).toBeUndefined();
    expect(
      choices
        .filter((c) => c.kind === "voltage")
        .every((c) => c.expression.kind === "vector"),
    ).toBe(true);
    expect(
      choices.some((c) => c.kind === "voltage" && c.label.startsWith("XDUT ·")),
    ).toBe(true);
    expect(
      choices.some(
        (c) => c.kind === "current" && c.label.startsWith("XSECOND ·"),
      ),
    ).toBe(true);
  });
  it("offers native text-only nodes and voltage-source branch current", () => {
    const result = createSimulationStarter(project, {
      id: "test",
      name: "Test",
      profileId: "test",
      mode: "text",
    });
    if (!result.ok) throw new Error(result.message);
    result.folder.input.files.find((f) => f.path === "run.cir")!.text =
      "Native text\nmodel supply vsource\nmodel resistor resistor\nmodel cap capacitor\nVIN (in 0) supply dc=1\nR1 (in out) resistor r=1k\nC1 (out 0) cap c=1n\n";
    const choices = sourceProbeChoices(project, result.folder.input);
    expect(
      choices.filter((c) => c.label.toLowerCase() === "v(out)"),
    ).toHaveLength(1);
    expect(
      choices.filter((c) => c.label.toLowerCase() === "v(in)"),
    ).toHaveLength(1);
    expect(
      sourceProbeChoices(project, result.folder.input).map((c) => c.label),
    ).toEqual(expect.arrayContaining(["v(in)", "v(out)", "i(VIN)"]));
  });
});
