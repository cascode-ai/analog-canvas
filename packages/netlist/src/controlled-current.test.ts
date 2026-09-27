import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";
import { analyzeDesignNetlist, createDesignNetlistExport } from "./index.js";
import {
  lowerTerminalCurrentControls,
  signedControlGain,
} from "./controlled-current.js";
import { nativeCurrentSenses } from "./simulation-native-current.js";
import { importSpiceSources } from "@icm/spice";
import {
  instrumentCellTerminalCurrents,
  instrumentationKey,
} from "./terminal-current-instrumentation.js";

function fixture() {
  const project = createEmptyProject("terminal-current", "Terminal current");
  const doc = project.documents[0]!;
  for (const [id, symbolId, parameters] of [
    ["R1", "resistor", { value: "1k" }],
    ["R2", "resistor", { value: "2k" }],
    ["V1", "voltage-source", { dc: "1" }],
    ["F1", "cccs", { gain: "2" }],
    ["H1", "ccvs", { rm: "3k" }],
  ] as const)
    doc.instances.push({
      id,
      reference: id,
      symbolId,
      placement: null,
      netlist: {
        parameters: { ...parameters },
        ...(id === "F1" || id === "H1"
          ? {
              control: {
                kind: "terminal-current" as const,
                instanceId: "R1",
                pinName: "1",
                direction: id === "F1" ? ("into" as const) : ("out" as const),
              },
            }
          : {}),
      },
    });
  doc.nets = [
    {
      id: "a",
      terminals: doc.instances.map((i) => ({
        instanceId: i.id,
        pinName: i.symbolId === "resistor" ? "1" : "+",
      })),
    },
    {
      id: "b",
      terminals: doc.instances.map((i) => ({
        instanceId: i.id,
        pinName: i.symbolId === "resistor" ? "2" : "-",
      })),
    },
  ];
  return project;
}

describe("terminal-current controlled sources", () => {
  it.each(["spice", "spectre"] as const)(
    "shares one series probe in %s, leaving other branches and the drawing untouched",
    (format) => {
      const project = fixture();
      const before = structuredClone(project);
      const result = analyzeDesignNetlist(project, { format });
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
        [],
      );
      const cell = result.ir!.cells[0]!;
      const probes = cell.instances.filter((i) => i.terminalCurrentSense);
      expect(probes).toHaveLength(1);
      const probe = probes[0]!;
      const byId = (id: string) => cell.instances.find((i) => i.id === id)!;
      expect(byId("R1").nodes[0]!.netName).toBe(probe.nodes[1]!.netName);
      expect(byId("R2").nodes[0]!.netName).toBe(probe.nodes[0]!.netName);
      expect(byId("F1").controlSourceReference).toBe(probe.reference);
      expect(byId("H1").controlSourceReference).toBe(probe.reference);
      expect(byId("H1").controlCurrentSign).toBe(-1);
      const output = createDesignNetlistExport(project, { format });
      expect(output.status).toBe("ready");
      if (output.status !== "ready") throw new Error("Expected export");
      expect(output.file.text).toContain(
        format === "spice" ? `${probe.reference} { -(3k) }` : "gain=(-(3k))",
      );
      expect(createDesignNetlistExport(project, { format })).toEqual(output);
      expect(project).toEqual(before);
      const sense = nativeCurrentSenses(
        cell,
        byId("R1"),
        [],
        new Set(cell.instances.map((i) => i.reference)),
      ).find((s) => s.pinName === "1")!;
      expect(sense.senseReference).toBe(probe.reference);
      expect(sense.collision).toBe(false);
      const measured = instrumentCellTerminalCurrents(
        cell,
        new Map([[instrumentationKey(sense), sense]]),
      );
      expect(measured).toEqual(cell);
    },
  );

  it.each([
    ["+", "into", 1],
    ["-", "into", -1],
    ["+", "out", -1],
    ["-", "out", 1],
  ] as const)(
    "reuses voltage-source %s terminal %s with sign %s",
    (pinName, direction, sign) => {
      const project = fixture();
      for (const i of project.documents[0]!.instances.filter((i) =>
        ["F1", "H1"].includes(i.id),
      ))
        i.netlist!.control = {
          kind: "terminal-current",
          instanceId: "V1",
          pinName,
          direction,
        };
      const result = analyzeDesignNetlist(project);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
        [],
      );
      const cell = result.ir!.cells[0]!;
      expect(cell.instances.filter((i) => i.terminalCurrentSense)).toHaveLength(
        0,
      );
      expect(cell.instances.find((i) => i.id === "F1")).toMatchObject({
        controlSourceReference: "V1",
        controlCurrentSign: sign,
      });
    },
  );

  it.each(["missing-device", "missing-pin", "disconnected", "incomplete"])(
    "blocks %s rather than silently rebinding",
    (failure) => {
      const project = fixture();
      const doc = project.documents[0]!;
      const control = {
        kind: "terminal-current" as const,
        instanceId: "R1",
        pinName: "1",
        direction: "into" as const,
      };
      if (failure === "missing-device") control.instanceId = "deleted";
      if (failure === "missing-pin") control.pinName = "removed";
      if (failure === "disconnected")
        doc.nets[0]!.terminals = doc.nets[0]!.terminals.filter(
          (t) => t.instanceId !== "R1",
        );
      doc.instances.find((i) => i.id === "F1")!.netlist!.control =
        failure === "incomplete"
          ? { kind: "terminal-current", direction: "into" }
          : control;
      const result = createDesignNetlistExport(project);
      expect(result.status).not.toBe("ready");
      expect(
        result.diagnostics.some((d) =>
          ["INVALID_CONTROL_TERMINAL", "MISSING_CONTROL_TERMINAL"].includes(
            d.code,
          ),
        ),
      ).toBe(true);
    },
  );

  it("rejects authored collisions and maps an external terminal's canvas identity", () => {
    const cell = analyzeDesignNetlist(fixture()).ir!.cells[0]!;
    const probe = cell.instances.find((i) => i.terminalCurrentSense)!;
    const pristine = structuredClone(cell);
    pristine.instances = pristine.instances.filter(
      (i) => !i.terminalCurrentSense,
    );
    const target = pristine.instances.find((i) => i.id === "R1")!;
    target.nodes[0]!.netName = probe.nodes[0]!.netName;
    target.nodes[0]!.canvasPinName = "1";
    target.nodes[0]!.pinName = "formal_input";
    const mapped = lowerTerminalCurrentControls(structuredClone(pristine));
    expect(mapped.issues).toEqual([]);
    const { terminalCurrentSense: _ownership, ...authored } =
      mapped.cell.instances.find((i) => i.terminalCurrentSense)!;
    pristine.instances.push(authored);
    expect(lowerTerminalCurrentControls(pristine).issues[0]!.message).toContain(
      "collides",
    );
  });

  it("negates numeric and symbolic gains without nested dialect wrappers", () => {
    expect(signedControlGain("{beta * 2}", -1, "spice")).toBe(
      "{ -(beta * 2) }",
    );
    expect(signedControlGain("'rm'", -1, "spectre")).toBe("(-(rm))");
    expect(signedControlGain("2", 1, "spice")).toBe("2");
  });

  it("keeps bounded probe identities stable under reorder and reimports as explicit electrical sensors", async () => {
    const project = fixture();
    const doc = project.documents[0]!;
    const longId = "r".repeat(256);
    doc.instances[0]!.id = longId;
    for (const net of doc.nets)
      for (const terminal of net.terminals)
        if (terminal.instanceId === "R1") terminal.instanceId = longId;
    for (const instance of doc.instances)
      if (instance.netlist?.control?.kind === "terminal-current")
        instance.netlist.control.instanceId = longId;
    const first = createDesignNetlistExport(project);
    expect(first.status).toBe("ready");
    if (first.status !== "ready") throw new Error("Missing export");
    doc.instances.reverse();
    const reordered = createDesignNetlistExport(project);
    expect(reordered).toEqual(first);
    const imported = await importSpiceSources(
      [
        {
          path: "terminal.spi",
          bytes: new TextEncoder().encode(first.file.text),
        },
      ],
      "terminal.spi",
    );
    expect(imported.successful).toBe(true);
    const instances = imported.project!.documents.flatMap((d) => d.instances);
    const probe = instances.find((i) =>
      i.reference?.startsWith("V__icm_sense_"),
    )!;
    expect(probe.reference!.length).toBeLessThan(128);
    expect(
      instances.find((i) => i.reference === "F1")?.netlist?.control,
    ).toEqual({ kind: "current", sensorInstanceId: probe.id });
    expect(createDesignNetlistExport(imported.project!).status).toBe("ready");
  });

  it("measures a subcircuit terminal at the occurrence boundary, not its internal net", () => {
    const cell = analyzeDesignNetlist(fixture()).ir!.cells[0]!;
    const probe = cell.instances.find((i) => i.terminalCurrentSense)!;
    cell.instances = cell.instances.filter((i) => !i.terminalCurrentSense);
    const target = cell.instances.find((i) => i.id === "R1")!;
    target.invocationKind = "subcircuit";
    target.deviceClass = "hierarchical";
    target.target = "child";
    target.nodes[0]!.netName = probe.nodes[0]!.netName;
    const lowered = lowerTerminalCurrentControls(cell);
    expect(lowered.issues).toEqual([]);
    const child = lowered.cell.instances.find((i) => i.id === "R1")!;
    expect(child.target).toBe("child");
    expect(child.nodes[1]).toEqual(target.nodes[1]);
    expect(child.nodes[0]!.netName).not.toBe(target.nodes[0]!.netName);
    expect(
      lowered.cell.instances.filter((i) => i.terminalCurrentSense),
    ).toHaveLength(1);
  });
});
