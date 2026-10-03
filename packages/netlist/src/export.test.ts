import { describe, expect, it } from "vitest";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
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
  it("imports E/G control nodes and F/H voltage-probe identity as typed relations", async () => {
    const imported = await importSpiceSources(
      [
        {
          path: "controlled.spi",
          bytes: new TextEncoder().encode(
            "Controlled sources\nV1 sense 0 DC 0\nE1 out 0 cp cn 2\nG1 out 0 cp cn 3m\nF1 out 0 V1 4\nH1 out 0 V1 5k\n.end\n",
          ),
        },
      ],
      "controlled.spi",
    );
    expect(imported.successful).toBe(true);
    const document = imported.project!.documents[0]!;
    const byName = (name: string) =>
      document.instances.find((instance) => instance.reference === name)!;
    expect(byName("E1").netlist?.control).toEqual({
      kind: "voltage",
      positiveNetId: expect.any(String),
      negativeNetId: expect.any(String),
    });
    expect(byName("G1").netlist?.control).toEqual(
      byName("E1").netlist?.control,
    );
    expect(byName("F1").netlist?.control).toEqual({
      kind: "current",
      sensorInstanceId: byName("V1").id,
    });
    expect(byName("H1").netlist?.control).toEqual(
      byName("F1").netlist?.control,
    );
    expect(
      document.nets
        .flatMap((net) => net.terminals)
        .filter((terminal) => terminal.instanceId === byName("E1").id),
    ).toHaveLength(2);
    const exported = createDesignNetlistExport(imported.project!);
    expect(exported.status).toBe("ready");
    if (exported.status === "ready") {
      expect(exported.file.text).toMatch(/^E1\s+\S+\s+\S+\s+\S+\s+\S+\s+2$/mu);
      expect(exported.file.text).toMatch(/^F1\s+\S+\s+\S+\s+V1\s+4$/mu);
    }
  });
  it.each(["spice", "spectre"] as const)(
    "exports four controlled-source relations in %s without reading the display formula",
    (format) => {
      const project = createEmptyProject("controlled", "Controlled");
      const document = project.documents[0]!;
      const source = [
        ["V1", "voltage-source", { dc: "0" }, undefined],
        [
          "E1",
          "vcvs",
          { gain: "2" },
          { kind: "voltage", positiveNetId: "cp", negativeNetId: "cn" },
        ],
        [
          "G1",
          "vccs",
          { gm: "3m" },
          { kind: "voltage", positiveNetId: "cp", negativeNetId: "cn" },
        ],
        [
          "F1",
          "cccs",
          { gain: "4" },
          { kind: "current", sensorInstanceId: "V1" },
        ],
        [
          "H1",
          "ccvs",
          { rm: "5k" },
          { kind: "current", sensorInstanceId: "V1" },
        ],
      ] as const;
      for (const [id, symbolId, parameters, control] of source)
        document.instances.push({
          id,
          reference: id,
          symbolId,
          placement: null,
          netlist: {
            parameters: { ...parameters },
            ...(control ? { control } : {}),
          },
        });
      document.nets = [
        {
          id: "op",
          terminals: source.map(([id]) => ({ instanceId: id, pinName: "+" })),
        },
        {
          id: "on",
          terminals: source.map(([id]) => ({ instanceId: id, pinName: "-" })),
        },
        { id: "cp", terminals: [] },
        { id: "cn", terminals: [] },
      ];
      const result = createDesignNetlistExport(project, { format });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      if (format === "spice") {
        expect(result.file.text).toMatch(/^E1\s+\S+\s+\S+\s+\S+\s+\S+\s+2$/mu);
        expect(result.file.text).toMatch(/^G1\s+\S+\s+\S+\s+\S+\s+\S+\s+3m$/mu);
        expect(result.file.text).toMatch(/^F1\s+\S+\s+\S+\s+V1\s+4$/mu);
        expect(result.file.text).toMatch(/^H1\s+\S+\s+\S+\s+V1\s+5k$/mu);
      } else {
        expect(result.file.text).toContain("vcvs gain=2");
        expect(result.file.text).toContain("vccs gm=3m");
        expect(result.file.text).toContain("cccs gain=4 probe=V1");
        expect(result.file.text).toContain("ccvs gain=5k probe=V1");
      }
      document.instances[1]!.netlist!.control = { kind: "voltage" };
      expect(
        createDesignNetlistExport(project, { format }).diagnostics,
      ).toContainEqual(
        expect.objectContaining({ code: "MISSING_CONTROL_NET" }),
      );
    },
  );
  it.each(["spice", "spectre"] as const)(
    "exports a Battery as an independent voltage source in %s",
    (format) => {
      const project = createEmptyProject("battery-project", "Battery");
      const document = project.documents[0]!;
      document.instances.push({
        id: "B1",
        symbolId: "battery",
        reference: "B1",
        placement: null,
        netlist: { parameters: { dc: "1.8", acMagnitude: "10m" } },
      });
      document.nets = [
        { id: "positive", terminals: [{ instanceId: "B1", pinName: "+" }] },
        { id: "negative", terminals: [{ instanceId: "B1", pinName: "-" }] },
      ];
      const result = createDesignNetlistExport(project, { format });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      if (format === "spice") {
        expect(result.file.text).toMatch(/^VB1\s+\S+\s+\S+\s+DC 1\.8 AC 10m/mu);
      } else {
        expect(result.file.text).toMatch(/^B1\s+\S+\s+\S+\s+vsource\s+/mu);
        expect(result.file.text).toContain("dc=1.8");
      }
    },
  );

  it("requires an authored DC value on an older Battery drawing", () => {
    const project = createEmptyProject("battery-project", "Battery");
    project.documents[0]!.instances.push({
      id: "B1",
      symbolId: "battery",
      reference: "B1",
      placement: null,
      netlist: { parameters: {} },
    });
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("blocked");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "MISSING_REQUIRED_PARAMETER",
        parameter: "dc",
      }),
    );
  });

  it("keeps ordinary imported SPICE V cards on the circular source symbol", async () => {
    const imported = await importSpiceSources(
      [
        {
          path: "source.spi",
          bytes: new TextEncoder().encode("Source\nV1 out 0 DC 1.8\n.end\n"),
        },
      ],
      "source.spi",
    );
    expect(imported.successful).toBe(true);
    expect(imported.project?.documents[0]?.instances[0]?.symbolId).toBe(
      "voltage-source",
    );
  });

  it("blocks missing hierarchy values without writing placeholder output", async () => {
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
    const before = structuredClone(project);
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("blocked");
    expect(
      result.diagnostics.filter(
        (item) => item.code === "MISSING_REQUIRED_PARAMETER",
      ),
    ).toHaveLength(2);
    expect(project).toEqual(before);
    expect(createDesignNetlistExport(project)).toEqual(result);
  });

  it.each(["spice", "spectre"] as const)(
    "blocks five explicit missing fields in %s without mutating the circuit",
    (format) => {
      const project = fixture();
      const before = structuredClone(project);
      const strict = analyzeDesignNetlist(project, { format });
      expect(strict.ir).toBeNull();
      expect(
        strict.diagnostics.filter((d) => d.severity === "error"),
      ).toHaveLength(5);
      const result = createDesignNetlistExport(project, { format });
      expect(result.status).toBe("blocked");
      expect(
        result.diagnostics.filter((item) => item.severity === "error"),
      ).toHaveLength(5);
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

describe("ground as the Cell's own pin", () => {
  /** One NMOS with a drawn ground, a declared VDD Port, and an output Port. */
  function cellWithGround(id = "main", name = "dut") {
    const document = createEmptyDocument(id, name);
    document.netlist!.name = name;
    document.instances.push(
      {
        id: "M1",
        symbolId: "nmos",
        reference: "M1",
        netlist: {
          binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
          parameters: { w: "1u", l: "150n", m: "1", nf: "1" },
        },
        placement: null,
      },
      { id: "GND1", symbolId: "ground", placement: null },
      // The VDD Symbol is the formal pin here, the way a drawing that hands
      // its supply to a caller states it; a global VDD Net and a Cell pin on
      // the same Net is a contract conflict, not a supply.
      { id: "VDD1", symbolId: "vdd-port", placement: null },
      { id: "POUT", symbolId: "port", placement: null },
    );
    document.nets.push(
      {
        id: "net-vdd",
        terminals: [
          { instanceId: "VDD1", pinName: "P" },
          { instanceId: "M1", pinName: "G" },
        ],
      },
      {
        id: "net-out",
        terminals: [
          { instanceId: "POUT", pinName: "P" },
          { instanceId: "M1", pinName: "D" },
        ],
      },
      {
        id: "net-gnd",
        terminals: [
          { instanceId: "GND1", pinName: "0" },
          { instanceId: "M1", pinName: "S" },
          { instanceId: "M1", pinName: "B" },
        ],
      },
    );
    document.netlist!.terminals.push(
      {
        id: "terminal-vdd",
        name: "VDD",
        netId: "net-vdd",
        direction: "inout",
        interfaceInstanceIds: ["VDD1"],
      },
      {
        id: "terminal-out",
        name: "OUT",
        netId: "net-out",
        direction: "output",
        interfaceInstanceIds: ["POUT"],
      },
    );
    document.connectivityEvidence.push({
      id: "gnd-claim",
      kind: "name-claim",
      netId: "net-gnd",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "power-marker", objectId: "GND1" },
    });
    return document;
  }

  it("states ground as a VSS pin after the supplies", () => {
    // A block somebody else reads should say where its reference comes from
    // instead of reaching for the caller's global node.
    const project = createEmptyProject("vss", "VSS", "main");
    project.documents = [cellWithGround()];
    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(".subckt dut VDD VSS OUT\n");
    // Source and body both read the pin, and node 0 is gone from the Cell.
    expect(result.file.text).toMatch(/M1 OUT VDD VSS VSS NMOS/u);
    expect(result.file.text).not.toMatch(/(?:^|\s)0(?:\s|$)/u);
  });

  it.each(["spice", "spectre"] as const)(
    "exports a shared rail as a local supply pin first, including callers in %s",
    (format) => {
      const project = createEmptyProject("supply-pins", "Supply pins", "top");
      const leaf = cellWithGround("leaf", "leaf");
      // Reproduce older drawings whose signal pins precede a VDD Pin while
      // a separate VDD rail gives the same logical supply a global identity.
      leaf.netlist!.terminals.reverse();
      leaf.instances.push({
        id: "rail",
        symbolId: "vdd-port",
        placement: null,
      });
      leaf.nets.push({
        id: "rail-net",
        terminals: [{ instanceId: "rail", pinName: "P" }],
      });
      leaf.connectivityEvidence.push({
        id: "rail-claim",
        kind: "name-claim",
        netId: "rail-net",
        name: "VDD",
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: "rail" },
      });
      const top = cellWithGround("top", "top");
      top.netlist!.terminals.reverse();
      top.instances.push({
        id: "X1",
        reference: "X1",
        symbolId: "cell-symbol",
        placement: null,
        netlist: {
          binding: { kind: "subcircuit", childDocumentId: "leaf" },
          parameters: {},
        },
      });
      top.nets
        .find((net) => net.id === "net-out")!
        .terminals.push({ instanceId: "X1", pinName: "OUT" });
      top.nets
        .find((net) => net.id === "net-vdd")!
        .terminals.push({ instanceId: "X1", pinName: "VDD" });
      project.documents = [top, leaf];
      const before = structuredClone(project);
      const result = createDesignNetlistExport(project, { format });
      expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.file.text).not.toMatch(/(?:^|\n)\.?global\b/u);
      for (const name of ["leaf", "top"])
        expect(result.file.text).toContain(
          format === "spice"
            ? `.subckt ${name} VDD VSS OUT\n`
            : `subckt ${name} (VDD VSS OUT)\n`,
        );
      expect(result.file.text).toContain(
        format === "spice" ? "X1 VDD VSS OUT leaf" : "X1 (VDD VSS OUT) leaf",
      );
      expect(project).toEqual(before);
    },
  );

  it("gives a parent and its child the same reference", () => {
    // Both sides derive the pin from the Documents, so a call cannot pass its
    // nodes in one order while the definition expects another.
    const project = createEmptyProject("vss-hier", "VSS hierarchy", "top");
    const child = cellWithGround("child", "leaf");
    const top = createEmptyDocument("top", "top");
    top.netlist!.name = "top";
    top.instances.push(
      {
        id: "X1",
        symbolId: "child-symbol",
        reference: "X1",
        netlist: {
          binding: { kind: "subcircuit", childDocumentId: "child" },
          parameters: {},
        },
        placement: null,
      },
      { id: "GND2", symbolId: "ground", placement: null },
      { id: "PIN", symbolId: "port", placement: null },
    );
    top.nets.push(
      {
        id: "top-vdd",
        terminals: [{ instanceId: "X1", pinName: "VDD" }],
      },
      {
        id: "top-out",
        terminals: [
          { instanceId: "X1", pinName: "OUT" },
          { instanceId: "PIN", pinName: "P" },
        ],
      },
      { id: "top-gnd", terminals: [{ instanceId: "GND2", pinName: "0" }] },
    );
    top.connectivityEvidence.push({
      id: "top-gnd-claim",
      kind: "name-claim",
      netId: "top-gnd",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "power-marker", objectId: "GND2" },
    });
    top.netlist!.terminals.push({
      id: "terminal-io",
      name: "IO",
      netId: "top-out",
      direction: "inout",
      interfaceInstanceIds: ["PIN"],
    });
    project.documents = [top, child];

    const result = createDesignNetlistExport(project, { format: "spice" });
    const text = result.status === "ready" ? result.file.text : "";
    expect(result.status).toBe("ready");
    expect(text).toContain(".subckt leaf VDD VSS OUT\n");
    expect(text).toContain(".subckt top VSS IO\n");
    // The call carries the caller's own ground where the definition puts it.
    expect(text).toMatch(/X1 \S+ VSS \S+ leaf/u);
  });

  it("recognizes a drawn Ground marker that carries no stored claim", () => {
    // Most drawings are this: the marker is on the page and the claim record
    // that names its Net `0` is recovered by the export view rather than
    // persisted. Asking the unrecovered Document answers "no ground" and the
    // Cell would print `0` with no pin to reach it by.
    const project = createEmptyProject("vss-marker", "VSS marker", "main");
    const document = cellWithGround();
    document.connectivityEvidence = document.connectivityEvidence.filter(
      (evidence) => evidence.id !== "gnd-claim",
    );
    project.documents = [document];

    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(".subckt dut VDD VSS OUT\n");
    expect(result.file.text).toMatch(/M1 OUT VDD VSS VSS NMOS/u);
  });

  it("keeps a pin the author already gave ground", () => {
    const project = createEmptyProject("vss-own", "VSS own", "main");
    const document = cellWithGround();
    document.instances.push({ id: "PGND", symbolId: "port", placement: null });
    document.nets
      .find((net) => net.id === "net-gnd")!
      .terminals.push({ instanceId: "PGND", pinName: "P" });
    document.netlist!.terminals.push({
      id: "terminal-gnd",
      name: "GNDA",
      netId: "net-gnd",
      direction: "inout",
      interfaceInstanceIds: ["PGND"],
    });
    project.documents = [document];

    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // One reference, under the author's own name, and no second pin for it.
    expect(result.file.text).toContain(".subckt dut VDD GNDA OUT\n");
    expect(result.file.text).not.toMatch(/\bVSS\b/u);
    // The node takes that pin's name too, so nothing inside is left reaching
    // for the global reference under another name.
    expect(result.file.text).toMatch(/M1 OUT VDD GNDA GNDA NMOS/u);
    expect(result.file.text).not.toMatch(/(?:^|\s)0(?:\s|$)/u);
  });

  it("keeps node 0 in the one Cell a deck prints as its own cards", () => {
    // There is no outside to ask: the deck itself is the outside, and its
    // calls into children carry that 0 into their VSS pins.
    const project = createEmptyProject("vss-sim", "VSS sim", "main");
    project.documents = [cellWithGround()];
    const analysis = analyzeDesignNetlist(project, {
      format: "spice",
      rootAsTopLevel: true,
    });
    const cell = analysis.ir?.cells[0];
    expect(cell?.ports.map((port) => port.name)).toEqual(["VDD", "OUT"]);
    expect(cell?.instances[0]?.nodes.map((node) => node.netName)).toEqual([
      "OUT",
      "VDD",
      "0",
      "0",
    ]);
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
      netlist: {
        binding: { kind: "model", deviceClass: "mos", name: "nmos_model" },
        parameters: { w: "1u", l: "150n" },
      },
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

  it("warns when a model card names a reviewed SKY130 subcircuit, and still exports it (#1249)", () => {
    const project = oneTransistor({ body: true });
    const instance = project.documents[0]!.instances[0]!;
    instance.netlist = {
      binding: {
        kind: "model",
        deviceClass: "mos",
        name: "sky130_fd_pr__nfet_01v8",
      },
      parameters: { w: "1u", l: "150n" },
    };
    const findings = (source: typeof project) =>
      analyzeDesignNetlist(source).diagnostics.filter(
        (item) => item.code !== "GENERATED_NET_NAME",
      );
    expect(findings(project)).toEqual([
      expect.objectContaining({
        code: "REVIEWED_DEVICE_AS_MODEL_CARD",
        severity: "warning",
        objectIds: ["M1"],
        message: expect.stringContaining("call it as XM1"),
      }),
    ]);
    // Older drawings keep exporting exactly as they did.
    expect(designExtractsNetlist(project)).toBe(true);
    // A model of the author's own raises nothing.
    expect(findings(oneTransistor({ body: true }))).toEqual([]);
  });

  it("blocks a drawing whose process fields are missing", () => {
    const project = oneTransistor({ body: true });
    project.documents[0]!.instances[0]!.netlist = { parameters: {} };
    const errors = analyzeDesignNetlist(project).diagnostics.filter(
      (item) => item.severity === "error",
    );
    expect(errors.map((item) => item.code).sort()).toEqual([
      "MISSING_MODEL_TARGET",
      "MISSING_REQUIRED_PARAMETER",
      "MISSING_REQUIRED_PARAMETER",
    ]);
    expect(designExtractsNetlist(project)).toBe(false);
    expect(
      errors.filter((item) => item.code === "MISSING_REQUIRED_PARAMETER"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameter: "w",
          primary: expect.objectContaining({
            kind: "instance",
            objectId: "M1",
          }),
        }),
        expect.objectContaining({
          parameter: "l",
          primary: expect.objectContaining({
            kind: "instance",
            objectId: "M1",
          }),
        }),
      ]),
    );
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
    // Drain, gate, source, body: source and body are both the ground node,
    // which this Cell states as its own pin.
    expect(result.file.text).toMatch(/M1 \S+ \S+ VSS VSS /u);
  });

  it("writes a stranded body on the supply, not on the Net it was left on", () => {
    // The shape a paste leaves: the body carries a binding to a Net nothing
    // else reaches. Printed as it stands, that node appears once in the whole
    // file and the pair is asymmetric — one body on ground, one on nothing.
    const project = oneTransistor({ body: false });
    const document = project.documents[0]!;
    document.instances.push({
      id: "GND1",
      symbolId: "ground",
      placement: { position: { x: 0, y: 40 }, rotation: 0, mirror: "none" },
    });
    document.nets[1]!.terminals.push({ instanceId: "GND1", pinName: "0" });
    document.nets.push({
      id: "net-residue",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    document.instances[0] = {
      ...document.instances[0]!,
      mosBulkBinding: { origin: "cell-default", netId: "net-residue" },
    };

    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // Drain, gate, source, body: source and body both on the ground node,
    // which the Cell states as its own pin.
    expect(result.file.text).toMatch(/M1 \S+ \S+ VSS VSS /u);
    expect(unfinishedDrawingDiagnostics(result.diagnostics)).toEqual([]);
    expect(designExtractsNetlist(project)).toBe(true);
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
    // exactly what an empty record says — so extraction reports every missing
    // field without mutating the Project.
    const project = oneTransistor({ body: true });
    const instance = project.documents[0]!.instances[0]!;
    delete (instance as { netlist?: unknown }).netlist;

    expect(designExtractsNetlist(project)).toBe(false);
    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("blocked");
    expect(
      result.diagnostics
        .filter((item) => item.severity === "error")
        .map((item) => item.code)
        .sort(),
    ).toEqual([
      "MISSING_MODEL_TARGET",
      "MISSING_REQUIRED_PARAMETER",
      "MISSING_REQUIRED_PARAMETER",
    ]);
    expect(instance.netlist).toBeUndefined();
  });

  it("refuses a drawing whose wire was never finished", () => {
    // The printed card would name this node once and nothing else in the file
    // would ever reach it. It is a wire nobody drew.
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
