import { describe, expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
import ota from "../../../netlists/native-ota-library/legacy-source.icproj.json";
import { createSimulationStarter } from "./simulation-starter.js";
import { nativeVoltageAcquisition } from "./simulation-native-voltage.js";
import { analyzeDesignNetlist } from "./extract.js";

function fixture() {
  const project = parseProject(JSON.stringify(ota));
  const started = createSimulationStarter(project, {
    id: "f",
    name: "Voltage picks",
    profileId: "candidate",
    documentId: "document-ota-5t",
    mode: "dut",
  });
  if (!started.ok) throw Error(started.message);
  const input = started.folder.input;
  const binding = input.circuitBindings[0]!;
  const root = analyzeDesignNetlist(project, {
    format: "spice",
    groundPin: "pin",
    rootDocumentId: binding.documentId,
  }).ir!.cells.find((c) => c.id === binding.documentId)!;
  const tb = input.files.find((f) => f.path === "testbench.spice")!;
  tb.text +=
    "\n" +
    tb.text
      .split("\n")
      .find((l) => l.startsWith("XDUT "))!
      .replace("XDUT ", "xdut ") +
    "\n";
  const internal = root.nets.find(
    (n) =>
      n.scope !== "global" && !root.ports.some((p) => p.netName === n.name),
  )!;
  const target = {
    kind: "voltage" as const,
    documentId: root.id,
    occurrence: [],
    anchor: { kind: "base-net" as const, netId: internal.id },
    circuit: { bindingId: binding.id, callPath: ["XDUT"] },
  };
  return { project, input, root, internal, target };
}
describe("native Canvas voltage acquisition", () => {
  it("distinguishes case-sensitive authored occurrences without introducing JSON output configuration", () => {
    const { project, input, internal, target } = fixture();
    const before = structuredClone({ project, input });
    for (const call of ["XDUT", "xdut"]) {
      expect(
        nativeVoltageAcquisition(project, input, {
          ...target,
          circuit: { ...target.circuit, callPath: [call] },
        }),
      ).toEqual({
        ok: true,
        vector: `${call}:${internal.name}`,
        save: `v('${call}:${internal.name}')`,
      });
    }
    expect({ project, input }).toEqual(before);
    expect(
      JSON.parse(input.files.find((f) => f.path === input.configPath)!.text),
    ).toEqual({ version: 2, environment: { profileId: "candidate" } });
  });
  it("resolves formal port aliases to top-level nodes and the same terminal/base Net anchor", () => {
    const { project, input, root, target } = fixture();
    const port = root.ports[0]!;
    const net = root.nets.find((n) => n.name === port.netName)!;
    const actual = nativeVoltageAcquisition(project, input, {
      ...target,
      anchor: { kind: "base-net", netId: net.id },
    });
    expect(actual).toMatchObject({ ok: true, vector: port.netName });
    const document = project.documents.find((d) => d.id === root.id)!;
    const terminal = document.nets.find((n) => n.id === net.id)!.terminals[0]!;
    expect(
      nativeVoltageAcquisition(project, input, {
        ...target,
        anchor: { kind: "terminal", ...terminal },
      }),
    ).toEqual(actual);
  });
  it("refuses deleted anchors, stale binding/call paths and wrong occurrences instead of silently saving ground", () => {
    const { project, input, target } = fixture();
    for (const wrong of [
      { ...target, anchor: { kind: "base-net" as const, netId: "deleted" } },
      { ...target, circuit: { ...target.circuit, callPath: ["Xdut"] } },
      { ...target, circuit: { ...target.circuit, bindingId: "missing" } },
      { ...target, occurrence: ["missing"] },
    ])
      expect(nativeVoltageAcquisition(project, input, wrong)).toMatchObject({
        ok: false,
        message: expect.any(String),
      });
  });
});
