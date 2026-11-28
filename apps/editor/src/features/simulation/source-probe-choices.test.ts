import { describe, it, expect } from "vitest";
import { parseProject } from "@icm/project-protocol";
import {
  createSimulationStarter,
  ngspiceSignalNames,
  ngspiceSignals,
  ngspiceSimulationDevices,
  ngspiceTerminalCurrent,
  inspectSimulationSourceGraph,
  resolveSimulationVoltageProbeNetId,
} from "@icm/netlist";
import ota from "../../../../../netlists/native-ota-library/legacy-source.icproj.json";
import { ngspiceProbeChoices } from "./source-ngspice-probe-choices";

const project = parseProject(JSON.stringify(ota));

describe("source Probe discovery", () => {
  it("offers ngspice device OP vectors and terminal current probes without mutating Project", () => {
    const before = JSON.stringify(project);
    const started = createSimulationStarter(project, {
      id: "op",
      name: "ngspice device OP",
      profileId: "sky130-core-continuous-ngspice46-v1",
      engine: "ngspice",
      mode: "circuit",
      documentId: project.topDocumentId,
    });
    if (!started.ok) throw Error(started.message);
    const input = started.folder.input;
    const devices = ngspiceSimulationDevices(project, input);
    const mos = devices.find((device) => device.polarity);
    expect(mos).toBeDefined();
    expect(ngspiceTerminalCurrent(mos!, "D")).toMatchObject({
      ok: true,
      vectors: expect.arrayContaining([expect.any(String)]),
    });
    const choices = ngspiceProbeChoices(project, input);
    expect(
      choices.some(
        (choice) =>
          choice.kind === "device-op" &&
          choice.label.includes("GM") &&
          choice.expression.kind === "vector" &&
          choice.expression.vector.endsWith("[gm]"),
      ),
    ).toBe(true);
    expect(JSON.stringify(project)).toBe(before);
  });

  it("maps ngspice vectors back to valid Canvas nets through the same naming traversal", () => {
    const started = createSimulationStarter(project, {
      id: "mapped",
      name: "ngspice mapping",
      profileId: "sky130-core-continuous-ngspice46-v1",
      engine: "ngspice",
      mode: "circuit",
      documentId: project.topDocumentId,
    });
    if (!started.ok) throw Error(started.message);
    const input = started.folder.input;
    const signals = ngspiceSignals(project, input);
    expect(Object.keys(signals).length).toBeGreaterThan(0);
    expect(
      Object.fromEntries(
        Object.entries(signals).map(([vector, signal]) => [
          vector,
          signal.label,
        ]),
      ),
    ).toEqual(ngspiceSignalNames(project, input));
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
      profileId: "sky130-core-continuous-ngspice46-v1",
      engine: "ngspice",
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
    const choices = ngspiceProbeChoices(project, input);
    const names = ngspiceSignalNames(project, input);
    expect(Object.keys(names).some((name) => name.includes("xdut."))).toBe(
      true,
    );
    expect(Object.keys(names).some((name) => name.includes("xsecond."))).toBe(
      true,
    );
    expect(Object.values(names).some((name) => name.includes("XDUT/"))).toBe(
      true,
    );
    const call = inspectSimulationSourceGraph(input).statements.find(
      ({ statement }) =>
        statement.kind === "instance" && statement.name === "XDUT",
    )!.statement;
    if (call.kind !== "instance") throw new Error("Expected XDUT instance");
    for (const node of call.nodes)
      expect(names[`v(${node})`.toLowerCase()]).toBeDefined();
    expect(names["v(xdut.0)"]).toBeUndefined();
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

  it("offers SPICE text-only nodes and voltage-source branch current", () => {
    const result = createSimulationStarter(project, {
      id: "test",
      name: "Test",
      profileId: "sky130-core-continuous-ngspice46-v1",
      engine: "ngspice",
      mode: "text",
    });
    if (!result.ok) throw new Error(result.message);
    result.folder.input.files.find((f) => f.path === "run.cir")!.text =
      "SPICE text\nVIN in 0 DC 1\nR1 in out 1k\nC1 out 0 1n\n.end\n";
    const choices = ngspiceProbeChoices(project, result.folder.input);
    expect(
      choices.filter((c) => c.label.toLowerCase() === "v(out)"),
    ).toHaveLength(1);
    expect(
      choices.filter((c) => c.label.toLowerCase() === "v(in)"),
    ).toHaveLength(1);
    expect(
      ngspiceProbeChoices(project, result.folder.input).map((c) => c.label),
    ).toEqual(expect.arrayContaining(["v(in)", "v(out)", "i(VIN)"]));
  });
});
