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
import { sourceProbeChoices } from "./source-probe-choices";

const project = parseProject(JSON.stringify(ota));
describe("source Probe discovery", () => {
  it("uses native device identities for hierarchical OP and refuses hidden current instrumentation", () => {
    const before = JSON.stringify(project);
    const devices = nativeSimulationDevices(
      project,
      project.simulationFolders[0]!.input,
    );
    const mos = devices.find(
      (device) => device.polarity && device.reference.includes("."),
    )!;
    expect(mos.nativeDevice).toMatch(/^m\..*\.msky130_fd_pr__/u);
    expect(nativeTerminalCurrent(mos, "D")).toMatchObject({
      ok: true,
      vectors: [`@${mos.nativeDevice}[id]`],
      directives: [],
    });
    expect(nativeTerminalCurrent(mos, "G")).toMatchObject({ ok: false });
    const choices = sourceProbeChoices(
      project,
      project.simulationFolders[0]!.input,
    );
    expect(
      choices.some(
        (choice) =>
          choice.kind === "device-op" && choice.label.includes("[gm]"),
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
