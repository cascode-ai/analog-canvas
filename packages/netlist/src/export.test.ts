import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { importSpiceSources } from "@icm/spice";
import { analyzeDesignNetlist } from "./extract.js";
import { printDesignNetlist } from "./printers.js";
import {
  createDesignNetlistExport,
  designExtractsNetlist,
  unfinishedDrawingDiagnostics,
} from "./export.js";

function fixture() {
  const project = createEmptyProject(
    "export-project",
    "Differential pair",
    "main",
  );
  const document = project.documents[0]!;
  document.netlist!.name = "Main";
  for (const [reference, symbolId, parameters] of [
    ["M1", "nmos", { w: "1u", l: "150n", m: "1", nf: "1" }],
    ["M2", "nmos", { w: "1u", l: "150n", m: "1", nf: "1" }],
    ["R1", "resistor", {}],
    ["R2", "resistor", {}],
    ["I1", "current-source", {}],
  ] as const) {
    document.instances.push({
      id: reference,
      reference,
      symbolId,
      placement: null,
      netlist: { parameters: { ...parameters } },
    });
  }
  // An unnamed but complete connectivity graph exercises non-blocking warnings.
  const connections = [
    [
      ["M1", "D"],
      ["R1", "2"],
    ],
    [
      ["M2", "D"],
      ["R2", "2"],
    ],
    [["M1", "G"]],
    [["M2", "G"]],
    [
      ["R1", "1"],
      ["R2", "1"],
    ],
    [
      ["M1", "S"],
      ["M2", "S"],
      ["I1", "+"],
    ],
    [
      ["M1", "B"],
      ["M2", "B"],
      ["I1", "-"],
    ],
  ];
  document.nets = connections.map((terminals, i) => ({
    id: `net-${i}`,
    terminals: terminals.map(([instanceId, pinName]) => ({
      instanceId: instanceId!,
      pinName: pinName!,
    })),
  }));
  return project;
}

function completeFixture() {
  const project = fixture();
  for (const instance of project.documents[0]!.instances) {
    const netlist = instance.netlist!;
    if (instance.symbolId === "nmos") {
      netlist.binding = {
        kind: "model",
        deviceClass: "mos",
        name: "nmos_model",
      };
    } else if (instance.symbolId === "resistor")
      netlist.parameters.value = "10k";
    else netlist.parameters.dc = "100u";
  }
  return project;
}

function cards(text: string) {
  return text
    .split("\n")
    .filter((line) => !/^(?:\*|\/\/)/u.test(line))
    .join("\n")
    .trim();
}

describe("copy/export netlist projection", () => {
  it("keeps hierarchy, formal port order and per-cell placeholders while ignoring presentation names", async () => {
    const source = `
.subckt leaf OUT IN params: scale=2
R1 OUT IN 10k
.ends leaf
.subckt top A B
X1 B A leaf scale=3
R1 A B 5k
.ends top
`;
    const imported = await importSpiceSources(
      [{ path: "circuit.spi", bytes: new TextEncoder().encode(source) }],
      "circuit.spi",
    );
    expect(imported.successful).toBe(true);
    const project = imported.project!;
    for (const document of project.documents) {
      delete document.instances.find((item) => item.reference === "R1")!
        .netlist!.parameters.value;
    }
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(".subckt leaf OUT IN params: scale=2");
    expect(result.file.text).toContain("X1 B A leaf scale=3");
    expect(result.file.text).toContain("R1 OUT IN {TODO_leaf_R1_value}");
    expect(result.file.text).toContain("R1 A B {TODO_top_R1_value}");
    expect(result.placeholders).toHaveLength(2);
    project.name = "TODO_top_R1_value";
    project.documents[0]!.name = "TODO_leaf_R1_value";
    expect(createDesignNetlistExport(project)).toEqual(result);
  });

  it.each(["spice", "spectre"] as const)(
    "exports five explicit missing fields in %s without mutating the circuit",
    (format) => {
      const project = fixture();
      const before = structuredClone(project);
      const strict = analyzeDesignNetlist(project, { format });
      expect(strict.ir).toBeNull();
      expect(
        strict.diagnostics.filter((d) => d.severity === "error"),
      ).toHaveLength(5);
      const result = createDesignNetlistExport(project, { format });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.placeholders).toHaveLength(5);
      expect(result.file.text).not.toMatch(/^(?:\*|\/\/)/mu);
      expect(result.file.text).toContain("l=150n m=1 nf=1 w=1u");
      for (const item of result.placeholders) {
        expect(result.file.text).toContain(item.token);
      }
      expect(result.file.text).toContain(
        format === "spice" ? "{TODO_Main_R1_value}" : "r=TODO_Main_R1_value",
      );
      expect(result.file.text).toContain(
        format === "spice"
          ? "DC {TODO_Main_I1_dc}"
          : "isource dc=TODO_Main_I1_dc",
      );
      // Replace just the five placeholders and compare every card to a complete
      // strict export. This protects device count, pin vectors, names and order.
      let filled = result.file.text;
      for (const item of result.placeholders) {
        const value =
          item.field === "model"
            ? "nmos_model"
            : item.field === "dc"
              ? "100u"
              : "10k";
        filled = filled.replaceAll(
          format === "spice" && item.field !== "model"
            ? `{${item.token}}`
            : item.token,
          value,
        );
      }
      const complete = analyzeDesignNetlist(completeFixture(), { format });
      expect(complete.ir).not.toBeNull();
      expect(cards(filled)).toBe(
        cards(printDesignNetlist(format, complete.ir!).text),
      );
      expect(project).toEqual(before);
      expect(analyzeDesignNetlist(project, { format })).toEqual(strict);
      expect(createDesignNetlistExport(project, { format })).toEqual(result);
    },
  );

  it.each(["spice", "spectre"] as const)(
    "keeps complete %s cards unchanged and keeps warnings outside the code",
    (format) => {
      const project = completeFixture();
      const strict = analyzeDesignNetlist(project, { format });
      const result = createDesignNetlistExport(project, { format });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.placeholders).toEqual([]);
      expect(cards(result.file.text)).toBe(
        cards(printDesignNetlist(format, strict.ir!).text),
      );
      expect(result.file.text).not.toMatch(/^(?:\*|\/\/)/mu);
      expect(
        result.diagnostics.some((item) => item.code === "GENERATED_NET_NAME"),
      ).toBe(true);
      expect(
        result.file.text.startsWith(
          format === "spice" ? "\n" : "simulator lang=spectre\n",
        ),
      ).toBe(true);
    },
  );

  it("avoids parameter/model collisions, including folded names inside expressions", () => {
    const project = fixture();
    const document = project.documents[0]!;
    document.netlist!.formalParameters.push({
      name: "todo_main_r1_value",
      defaultValue: "123",
    });
    document.instances[0]!.netlist!.parameters.w = "{TODO_Main_M1_model}";
    document.instances[2]!.netlist!.parameters.VALUE = " ";
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain("{TODO_Main_R1_value_2}");
    expect(result.file.text).toContain("TODO_Main_M1_model_2");
    expect(result.file.text).not.toContain("DUPLICATE_PARAMETER_NAME");
  });

  it.each([
    "open-pin",
    "unknown-symbol",
    "missing-cell",
    "wrong-binding",
    "invalid-waveform",
  ])("rejects %s instead of silently omitting circuit data", (defect) => {
    const project = fixture();
    const document = project.documents[0]!;
    if (defect === "open-pin") document.nets[0]!.terminals.shift();
    if (defect === "unknown-symbol")
      document.instances[0]!.symbolId = "unreviewed-symbol";
    if (defect === "missing-cell") document.netlist = undefined;
    if (defect === "wrong-binding")
      document.instances[0]!.netlist!.binding = {
        kind: "primitive",
        deviceClass: "resistor",
      };
    if (defect === "invalid-waveform")
      document.instances[4]!.netlist!.parameters.waveform = "pulse";
    const before = structuredClone(project);
    expect(createDesignNetlistExport(project).status).toBe("blocked");
    expect(project).toEqual(before);
  });

  it("does not infer missing waveform fields from a device default", () => {
    const project = fixture();
    project.documents[0]!.instances[4]!.netlist!.parameters = {
      waveform: "pwl",
      pwlPoints: "broken",
    };
    expect(createDesignNetlistExport(project).status).toBe("blocked");
  });
});

describe("netlist extractability", () => {
  function oneTransistor(connected: { body: boolean }) {
    const project = createEmptyProject("extractable", "Extractable", "main");
    const document = project.documents[0]!;
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      reference: "M1",
      netlist: { parameters: {} },
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    document.nets.push(
      {
        id: "net-top",
        terminals: [
          { instanceId: "M1", pinName: "G" },
          { instanceId: "M1", pinName: "D" },
        ],
      },
      {
        id: "net-bottom",
        terminals: [
          { instanceId: "M1", pinName: "S" },
          ...(connected.body
            ? [{ instanceId: "M1", pinName: "B" as const }]
            : []),
        ],
      },
    );
    return project;
  }

  it("does not hold a missing process library against a drawing", () => {
    // An unbound model and an unset w/l are a PDK choice made at export,
    // where they become TODO placeholders. The drawing is complete.
    const project = oneTransistor({ body: true });
    const errors = analyzeDesignNetlist(project).diagnostics.filter(
      (item) => item.severity === "error",
    );
    expect(errors.map((item) => item.code).sort()).toEqual([
      "MISSING_MODEL_TARGET",
      "MISSING_REQUIRED_PARAMETER",
      "MISSING_REQUIRED_PARAMETER",
    ]);
    expect(designExtractsNetlist(project)).toBe(true);
  });

  it("writes the fourth node from the supply the author drew", () => {
    // The body follows the ground marker on the page with nothing configured
    // per Cell, so the netlist has a fourth node and the drawing needs no
    // visit to a settings panel.
    const project = oneTransistor({ body: false });
    const document = project.documents[0]!;
    document.instances.push({
      id: "GND1",
      symbolId: "ground",
      placement: { position: { x: 0, y: 40 }, rotation: 0, mirror: "none" },
    });
    document.nets[1]!.terminals.push({ instanceId: "GND1", pinName: "0" });
    expect(document.mosBulkDefaults).toBeUndefined();
    expect(designExtractsNetlist(project)).toBe(true);
    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // Drain, gate, source, body: source and body are both the ground node.
    expect(result.file.text).toMatch(/M1 \S+ \S+ 0 0 /u);
  });

  it("answers no while connectivity is still missing", () => {
    // A body on no Net is not a process choice: SPICE has no fourth node to
    // write, and no export option supplies one.
    expect(designExtractsNetlist(oneTransistor({ body: false }))).toBe(false);
  });

  it("gives the same answer as the export the editor performs", () => {
    for (const body of [true, false]) {
      const project = oneTransistor({ body });
      const result = createDesignNetlistExport(project, { format: "spice" });
      expect(designExtractsNetlist(project)).toBe(
        result.status === "ready" &&
          unfinishedDrawingDiagnostics(result.diagnostics).length === 0,
      );
    }
  });

  /** One resistor from the transistor's drain to wherever `tail` says. */
  function withStub(tail: { dangling?: true; noConnect?: true; named?: true }) {
    const project = oneTransistor({ body: true });
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      reference: "R1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "10k" },
      },
      placement: { position: { x: 40, y: 0 }, rotation: 0, mirror: "none" },
    });
    document.nets[0]!.terminals.push({ instanceId: "R1", pinName: "1" });
    if (tail.noConnect) {
      document.noConnects.push({
        id: "nc-1",
        endpoint: { kind: "terminal", instanceId: "R1", pinName: "2" },
      });
      return project;
    }
    document.nets.push({
      id: "net-stub",
      terminals: [{ instanceId: "R1", pinName: "2" }],
    });
    if (tail.named) {
      document.connectivityEvidence.push({
        id: "net-stub-name",
        kind: "net-name-hint",
        netId: "net-stub",
        sourceName: "VPROBE",
        origin: "spice-import",
      });
    }
    return project;
  }

  it("reads an absent netlist record as an empty one", () => {
    // Older Projects, imports and Agent-authored instances reach the exporter
    // with no netlist object at all. It binds nothing and sets no parameter —
    // exactly what an empty record says — so the export writes the model and
    // width as TODO instead of reporting the drawing as broken.
    const project = oneTransistor({ body: true });
    const instance = project.documents[0]!.instances[0]!;
    delete (instance as { netlist?: unknown }).netlist;

    expect(designExtractsNetlist(project)).toBe(true);
    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.placeholders.map((item) => item.field).sort()).toEqual([
      "l",
      "model",
      "w",
    ]);
    // The Project itself is untouched; placeholders live in the copy.
    expect(instance.netlist).toBeUndefined();
  });

  it("refuses a drawing whose wire was never finished", () => {
    // The printed card would name this node once and nothing else in the file
    // would ever reach it. That is not a value a TODO placeholder can supply
    // later; it is a wire nobody drew.
    const project = withStub({ dangling: true });
    const result = createDesignNetlistExport(project, { format: "spice" });
    // The printer still says what the drawing says — the refusal is the
    // caller's, so a preview of work in progress stays possible.
    expect(result.status).toBe("ready");
    expect(
      unfinishedDrawingDiagnostics(result.diagnostics).map(
        (item) => item.message,
      ),
    ).toEqual([
      "Net net1 is a dead end: only R1.2 reaches it. Connect it, or mark that pin NoConnect",
    ]);
    expect(designExtractsNetlist(project)).toBe(false);
  });

  it("takes an explicit NoConnect as the author's own answer", () => {
    const project = withStub({ noConnect: true });
    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(unfinishedDrawingDiagnostics(result.diagnostics)).toEqual([]);
    expect(designExtractsNetlist(project)).toBe(true);
  });

  it("leaves a node somebody named alone", () => {
    // A named node is a declared signal — a probe point, an imported node —
    // not leftover geometry, so its single pin is nobody's mistake to guess.
    const project = withStub({ named: true });
    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(unfinishedDrawingDiagnostics(result.diagnostics)).toEqual([]);
    expect(designExtractsNetlist(project)).toBe(true);
  });
});
