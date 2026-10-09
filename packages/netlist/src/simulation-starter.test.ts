import { describe, it, expect } from "vitest";
import { parseProject } from "@icm/project-protocol";
import ota from "../../../netlists/native-ota-library/legacy-source.icproj.json";
import hostedSky130 from "../../../containers/ngspice/hosted-sky130-profile.json";
import {
  createSimulationStarter,
  newFolderCellRole,
  newFolderProfile,
} from "./simulation-starter.js";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { inspectVacaskSourceGraph } from "./vacask-source.js";
import { analyzeDesignNetlist } from "./extract.js";
import { generateCircuitSource } from "./simulation-circuit-source.js";
import { createDesignNetlistExport } from "./export.js";
import { vacaskCircuitScopes } from "./vacask-source-scopes.js";

const project = parseProject(JSON.stringify(ota));
const options = {
  id: "experiment",
  name: "Experiment",
  profileId: "test",
  documentId: "document-ota-5t",
};
describe("simulation starting points", () => {
  it("keeps ngspice DUT interfaces identical to the existing supply-first Netlist and starter", () => {
    const p = structuredClone(project);
    const root = p.documents.find((d) => d.id === options.documentId)!;
    // Reproduce a drawing where signal ports were created before supplies.
    root.netlist!.terminals.sort(
      (a, b) =>
        Number(/^(VDD|VSS)$/i.test(a.name)) -
        Number(/^(VDD|VSS)$/i.test(b.name)),
    );
    const before = JSON.stringify(p);
    const starter = createSimulationStarter(p, {
      ...options,
      engine: "ngspice",
      mode: "dut",
    });
    if (!starter.ok) throw new Error(starter.message);
    const binding = starter.folder.input.circuitBindings[0]!;
    const preview = generateCircuitSource(
      p,
      binding,
      starter.folder.input,
      "ngspice",
    );
    const compiled = compileNgspiceSourceSimulation(p, starter.folder);
    const exported = createDesignNetlistExport(p, {
      rootDocumentId: root.id,
      format: "spice",
    });
    expect(preview.ok && compiled.ok && exported.status === "ready").toBe(true);
    if (!preview.ok || !compiled.ok || exported.status !== "ready") return;
    const header = (text: string) =>
      text
        .split("\n")
        .find((line) => line.startsWith(`.subckt ${root.netlist!.name} `));
    const expected = header(exported.file.text)!;
    expect(expected).toMatch(/ VDD VSS /i);
    expect(header(preview.source.text)).toBe(expected);
    expect(header(compiled.generated[0]!.text)).toBe(expected);
    const [, name, ...ports] = expected.split(/\s+/);
    expect(
      starter.folder.input.files.find((f) => f.path === "testbench.spice")!
        .text,
    ).toContain(`XDUT ${ports.join(" ")} ${name}`);
    expect(JSON.stringify(p)).toBe(before);
  });
  it.each(["circuit", "dut", "text"] as const)(
    "creates a genuine ngspice %s starter without VACASK syntax",
    (mode) => {
      const result = createSimulationStarter(project, {
        ...options,
        mode,
        engine: "ngspice",
        template: "ac",
      });
      if (!result.ok) throw new Error(result.message);
      const source = result.folder.input.files.find(
        (f) => f.path === result.folder.input.entry,
      )!.text;
      expect(source).toContain(".control\nset filetype=ascii");
      expect(source).toContain("ac dec 20 1 1G");
      expect(source).not.toContain("ground 0");
      const compiled = compileNgspiceSourceSimulation(project, result.folder);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    },
  );
  it.each(["circuit", "dut", "text"] as const)(
    "preserves the selected analysis template for a %s folder",
    (mode) => {
      const result = createSimulationStarter(project, {
        ...options,
        mode,
        template: "ac",
      });
      if (!result.ok) throw new Error(result.message);
      expect(
        result.folder.input.files.find((f) => f.path === "run.cir")!.text,
      ).toContain('analysis ac ac from=1 to=1G mode="dec" points=20');
      const compiled = compileSourceSimulation(project, result.folder);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    },
  );
  it("preserves a drawn top-level circuit and allows text without any Canvas binding", () => {
    const drawn = createSimulationStarter(project, {
      ...options,
      mode: "circuit",
    });
    expect(drawn.ok && drawn.folder.input.circuitBindings[0]?.emission).toBe(
      "top-level",
    );
    expect(
      drawn.ok &&
        drawn.folder.input.files.some((f) => f.path === "testbench.spice"),
    ).toBe(false);
    const text = createSimulationStarter(project, { ...options, mode: "text" });
    expect(text.ok && text.folder.input.circuitBindings).toEqual([]);
    expect(
      text.ok &&
        text.folder.input.files.find((f) => f.path === "run.cir")!.text,
    ).not.toContain(".include");
  });
  it("uses the exported DUT name and ordered ports for a textual TB without creating a Cell", () => {
    const before = JSON.stringify(project);
    const result = createSimulationStarter(project, {
      ...options,
      mode: "dut",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const binding = result.folder.input.circuitBindings[0]!;
    expect(binding.emission).toBe("subcircuit");
    expect(compileSourceSimulation(project, result.folder).ok).toBe(true);
    const ir = analyzeDesignNetlist(project, {
      format: "spice",
      groundPin: "pin",
      rootDocumentId: options.documentId,
    }).ir!;
    const root = ir.cells.find((cell) => cell.id === ir.topCellId)!;
    expect(
      result.folder.input.files.find((file) => file.path === "testbench.spice")!
        .text,
    ).toContain(
      `XDUT (${root.ports.map((port) => `'${port.netName}'`).join(" ")}) '${root.name}'`,
    );
    const scopes = vacaskCircuitScopes(
      inspectVacaskSourceGraph(result.folder.input),
      binding,
      ir,
    ).list();
    expect(scopes).toEqual([{ bindingId: "circuit", callPath: ["XDUT"] }]);
    expect(JSON.stringify(project)).toBe(before);
  });

  it("wraps a Cell with pins as a DUT and runs one without as the testbench (#1489)", () => {
    // ota_5t draws six pins; both testbenches draw sources and none.
    expect(newFolderCellRole(project, "document-ota-5t")).toBe("dut");
    expect(newFolderCellRole(project, "document-ota-5t-testbench")).toBe(
      "testbench",
    );
    expect(newFolderCellRole(project, "document-ota-5t-testbench-sin")).toBe(
      "testbench",
    );
  });
});

describe("the Profile a new folder starts from (#1349)", () => {
  // As Production advertises them: ngspice names its qualified SKY130
  // devices, VACASK names none.
  const ngspice = {
    id: hostedSky130.id,
    devices: hostedSky130.qualifiedScope.devices,
  };
  const vacask = { id: "vacask-sky130-candidate" };
  // The testbench reaches the OTA's SKY130 transistors through its Cell.
  const testbench = { project, documentId: "document-ota-5t-testbench" };
  /** The testbench with one more part, bound to `name`. */
  const withPart = (name: string) => {
    const p = structuredClone(project);
    p.documents
      .find((document) => document.id === testbench.documentId)!
      .instances.push({
        id: "added",
        reference: "X9",
        symbolId: "capacitor",
        placement: null,
        netlist: {
          binding: { kind: "model", deviceClass: "capacitor", name },
          parameters: {},
        },
      });
    return { project: p, documentId: testbench.documentId };
  };

  it("takes the one Profile that qualifies every PDK device the Cell uses", () => {
    expect(newFolderProfile([vacask, ngspice], testbench)).toEqual({
      ok: true,
      profileId: ngspice.id,
    });
    // A model name outside the reviewed PDK devices does not count.
    expect(newFolderProfile([vacask, ngspice], withPart("nch_mac"))).toEqual({
      ok: true,
      profileId: ngspice.id,
    });
    // A folder without a Cell uses no PDK device.
    expect(newFolderProfile([vacask, ngspice])).toEqual({
      ok: true,
      profileId: ngspice.id,
    });
  });

  it("takes the SKY130 Profile for SKY130's high-voltage DMOS devices (#1485)", () => {
    // The hosted SKY130 Profile runs its 16 and 20 V devices, though it lists
    // only its core devices (checked on Production 2026-10-08).
    for (const name of [
      "sky130_fd_pr__nfet_g5v0d16v0",
      "sky130_fd_pr__pfet_g5v0d16v0",
      "sky130_fd_pr__nfet_20v0",
      "sky130_fd_pr__pfet_20v0",
    ])
      expect(newFolderProfile([vacask, ngspice], withPart(name))).toEqual({
        ok: true,
        profileId: ngspice.id,
      });
  });

  it("asks for a Profile when none or several qualify", () => {
    // Its library has no varactor: the hosted run says "unknown subckt".
    expect(
      newFolderProfile(
        [ngspice, vacask],
        withPart("sky130_fd_pr__cap_var_lvt"),
      ),
    ).toEqual({
      ok: false,
      candidates: [ngspice.id, vacask.id],
      message: "No Profile qualifies sky130_fd_pr__cap_var_lvt.",
    });
    const copy = { ...ngspice, id: "sky130-copy" };
    expect(newFolderProfile([ngspice, copy, vacask], testbench)).toEqual({
      ok: false,
      candidates: [ngspice.id, copy.id],
      message: "Several Profiles qualify every PDK device this folder uses.",
    });
    // A Profile that lists no qualified devices is never the default.
    expect(newFolderProfile([vacask], testbench)).toMatchObject({
      ok: false,
      candidates: [vacask.id],
    });
  });
});
