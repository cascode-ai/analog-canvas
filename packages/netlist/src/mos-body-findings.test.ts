import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import { createDesignNetlistExport, designExtractsNetlist } from "./export.js";
import { analyzeDesignNetlist, SIMULATION_DECK_GROUND } from "./extract.js";

function mos(
  document: SchematicDocument,
  id: string,
  symbolId: "nmos" | "pmos",
): void {
  document.instances.push({
    id,
    reference: id,
    symbolId,
    symbolVariantId: "textbook-3terminal",
    placement: null,
    netlist: {
      binding: {
        kind: "model",
        deviceClass: "mos",
        name: symbolId.toUpperCase(),
      },
      parameters: { w: "1u", l: "150n" },
    },
  });
}

/** A Cell Pin `name` on a Net of its own, holding the given pins. */
function port(
  document: SchematicDocument,
  name: string,
  pins: readonly (readonly [string, string])[],
): void {
  document.instances.push({
    id: `port-${name}`,
    symbolId: "port",
    placement: null,
  });
  document.nets.push({
    id: `net-${name}`,
    terminals: [
      ...pins.map(([instanceId, pinName]) => ({ instanceId, pinName })),
      { instanceId: `port-${name}`, pinName: "P" },
    ],
  });
  document.netlist!.terminals.push({
    id: `terminal-${name}`,
    name,
    netId: `net-${name}`,
    direction: "inout",
    interfaceInstanceIds: [`port-${name}`],
  });
}

function findings(project: CircuitProject, code: string) {
  return createDesignNetlistExport(project, {
    format: "spice",
  }).diagnostics.filter((item) => item.code === code);
}

describe("a body that takes the conventional supply says so (#1302)", () => {
  /** The issue's Cell: one PMOS, Ports s, g and d, and no supply drawn. */
  function bulkrepro() {
    const project = createEmptyProject("bulkrepro", "Bulk repro", "cell");
    const document = project.documents[0]!;
    document.netlist!.name = "bulkrepro";
    mos(document, "MP", "pmos");
    port(document, "s", [["MP", "S"]]);
    port(document, "g", [["MP", "G"]]);
    port(document, "d", [["MP", "D"]]);
    return project;
  }

  it("names the PMOS and the VDD pin the export adds, as information", () => {
    const project = bulkrepro();
    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // The netlist itself is what it was.
    expect(result.file.text).toContain(".subckt bulkrepro VDD VSS s g d\n");
    expect(result.file.text).toMatch(/MP d g s VDD PMOS/u);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "MOS_BODY_DEFAULT_SUPPLY",
        severity: "info",
        objectIds: ["MP"],
        primary: expect.objectContaining({ kind: "instance", objectId: "MP" }),
        message:
          "MP's body has no Net and takes the conventional VDD, added to this Cell's pins with VSS; connect its B pin to choose another body",
      }),
    ]);
    // Information gates nothing.
    expect(designExtractsNetlist(project)).toBe(true);
  });

  it("names the NMOS bodies on ground, with the VDD added beside it", () => {
    const project = createEmptyProject("pair", "Pair", "cell");
    const document = project.documents[0]!;
    document.netlist!.name = "pair";
    mos(document, "M1", "nmos");
    mos(document, "M2", "nmos");
    port(document, "d", [
      ["M1", "D"],
      ["M2", "D"],
    ]);
    port(document, "g", [
      ["M1", "G"],
      ["M2", "G"],
    ]);
    port(document, "s", [
      ["M1", "S"],
      ["M2", "S"],
    ]);
    expect(
      findings(project, "MOS_BODY_DEFAULT_SUPPLY").map((item) => [
        item.objectIds,
        item.message,
      ]),
    ).toEqual([
      [
        ["M1", "M2"],
        "The bodies of M1 and M2 have no Net and take the conventional ground, added to this Cell's pins as VSS, with VDD; connect a B pin to choose another body",
      ],
    ]);
  });

  it("gives each supply its own finding when both kinds take one", () => {
    const project = createEmptyProject("inverter", "Inverter", "cell");
    const document = project.documents[0]!;
    document.netlist!.name = "inverter";
    mos(document, "MN", "nmos");
    mos(document, "MP", "pmos");
    port(document, "in", [
      ["MN", "G"],
      ["MP", "G"],
    ]);
    port(document, "out", [
      ["MN", "D"],
      ["MP", "D"],
    ]);
    port(document, "x", [
      ["MN", "S"],
      ["MP", "S"],
    ]);
    expect(
      findings(project, "MOS_BODY_DEFAULT_SUPPLY")
        .map((item) => item.message)
        .sort(),
    ).toEqual([
      "MN's body has no Net and takes the conventional ground, added to this Cell's pins as VSS; connect its B pin to choose another body",
      "MP's body has no Net and takes the conventional VDD, added to this Cell's pins; connect its B pin to choose another body",
    ]);
  });

  it("stays quiet for a body wired, configured, or following a drawn supply", () => {
    const wired = bulkrepro();
    wired.documents[0]!.nets[0]!.terminals.push({
      instanceId: "MP",
      pinName: "B",
    });
    const configured = bulkrepro();
    configured.documents[0]!.mosBulkDefaults = { pmosNetId: "net-s" };
    const drawn = bulkrepro();
    const document = drawn.documents[0]!;
    document.instances.push({
      id: "VDD1",
      symbolId: "vdd-port",
      placement: null,
    });
    document.nets.push({
      id: "net-vdd",
      terminals: [{ instanceId: "VDD1", pinName: "P" }],
    });
    document.connectivityEvidence.push({
      id: "claim-vdd",
      kind: "name-claim",
      netId: "net-vdd",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: "VDD1" },
    });
    for (const project of [wired, configured, drawn]) {
      const result = createDesignNetlistExport(project, { format: "spice" });
      expect(result.status).toBe("ready");
      expect(
        result.diagnostics.filter((item) => item.code.startsWith("MOS_BODY")),
      ).toEqual([]);
    }
  });

  it("says nothing where the supply becomes no Cell Pin", () => {
    // The analyzer's own default keeps SPICE's global nodes, and a deck's
    // root prints its cards at top level: neither adds a pin.
    for (const options of [{}, SIMULATION_DECK_GROUND])
      expect(
        analyzeDesignNetlist(bulkrepro(), options).diagnostics.filter(
          (item) => item.code === "MOS_BODY_DEFAULT_SUPPLY",
        ),
      ).toEqual([]);
  });

  it("reports the Cell whose body it is, not the callers its pin reaches", () => {
    const project = bulkrepro();
    const top = createEmptyDocument("top", "top");
    top.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: "cell-symbol",
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "cell" },
        parameters: {},
      },
    });
    for (const name of ["s", "g", "d"]) port(top, name, [["X1", name]]);
    project.documents.unshift(top);
    project.topDocumentId = "top";
    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // The caller carries the new supplies on to its own pins.
    expect(result.file.text).toContain(".subckt top VDD VSS s g d\n");
    expect(
      result.diagnostics
        .filter((item) => item.code === "MOS_BODY_DEFAULT_SUPPLY")
        .map((item) => item.documentId),
    ).toEqual(["cell"]);
  });
});

describe("a default body on another supply than its source (#1336)", () => {
  /**
   * A level shifter's two PMOS. VDDL was drawn first, so it is the Cell's
   * PMOS body default; M1's source is on VDDH, M2's on VDDL.
   */
  function levelShifter() {
    const project = createEmptyProject("shifter", "Level shifter", "cell");
    const document = project.documents[0]!;
    document.netlist!.name = "shifter";
    mos(document, "M1", "pmos");
    mos(document, "M2", "pmos");
    port(document, "in", [
      ["M1", "G"],
      ["M2", "G"],
    ]);
    port(document, "out", [
      ["M1", "D"],
      ["M2", "D"],
    ]);
    for (const [marker, name, source] of [
      ["VH", "VDDH", "M1"],
      ["VL", "VDDL", "M2"],
    ] as const) {
      document.instances.push({
        id: marker,
        symbolId: "vdd-port",
        placement: null,
      });
      document.nets.push({
        id: `net-${name}`,
        terminals: [
          { instanceId: marker, pinName: "P" },
          { instanceId: source, pinName: "S" },
        ],
      });
      document.connectivityEvidence.push({
        id: `claim-${name}`,
        kind: "name-claim",
        netId: `net-${name}`,
        name,
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: marker },
      });
    }
    document.mosBulkDefaults = { pmosNetId: "net-VDDL" };
    return project;
  }

  it("asks about the PMOS on VDDH whose body follows the VDDL default", () => {
    const project = levelShifter();
    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // The body is written where the default puts it; only the finding is new.
    expect(result.file.text).toMatch(/M1 out in VDDH VDDL PMOS/u);
    expect(
      result.diagnostics.filter(
        (item) => item.code === "MOS_BODY_OTHER_SUPPLY",
      ),
    ).toEqual([
      expect.objectContaining({
        severity: "info",
        objectIds: ["M1"],
        message:
          "M1's body follows the Cell's PMOS default VDDL; its source is on VDDH. Connect its B pin to VDDH if that is the body you mean",
      }),
    ]);
    expect(
      result.diagnostics.filter((item) => item.severity !== "info"),
    ).toEqual([]);
  });

  it("says where a copied body's default came from", () => {
    const project = levelShifter();
    const document = project.documents[0]!;
    document.nets
      .find((net) => net.id === "net-VDDL")!
      .terminals.push({ instanceId: "M1", pinName: "B" });
    document.instances.find((item) => item.id === "M1")!.mosBulkBinding = {
      origin: "instance-override",
      netId: "net-VDDL",
    };
    expect(
      findings(project, "MOS_BODY_OTHER_SUPPLY").map((item) => item.message),
    ).toEqual([
      "M1's body keeps the PMOS default it was copied with, VDDL; its source is on VDDH. Connect its B pin to VDDH if that is the body you mean",
    ]);
  });

  it("is silent once the body is wired, or when the source is on the default", () => {
    const wired = levelShifter();
    wired.documents[0]!.nets.find(
      (net) => net.id === "net-VDDH",
    )!.terminals.push({ instanceId: "M1", pinName: "B" });
    expect(findings(wired, "MOS_BODY_OTHER_SUPPLY")).toEqual([]);
    const onDefault = levelShifter();
    onDefault.documents[0]!.mosBulkDefaults = { pmosNetId: "net-VDDH" };
    // Now M2, on VDDL, is the one asked about.
    expect(
      findings(onDefault, "MOS_BODY_OTHER_SUPPLY").map(
        (item) => item.objectIds,
      ),
    ).toEqual([["M2"]]);
  });

  it("says which default an imported body with no Net takes", () => {
    // An imported part never resolves to a default by itself; the netlist
    // gives it the Cell's.
    const project = levelShifter();
    const m1 = project.documents[0]!.instances.find(
      (item) => item.id === "M1",
    )!;
    m1.importProvenance = {
      kind: "model",
      sourceMasterName: "PMOS",
      sourceTarget: "PMOS",
    };
    expect(
      findings(project, "MOS_BODY_OTHER_SUPPLY").map((item) => item.message),
    ).toEqual([
      "M1's body follows the Cell's PMOS default VDDL; its source is on VDDH. Connect its B pin to VDDH if that is the body you mean",
    ]);
  });
});

describe("a body with no Net on another supply than its source (#1336)", () => {
  /** A supply marker on a Net named `name`, holding `pins`. */
  function supply(
    document: SchematicDocument,
    name: string,
    pins: readonly (readonly [string, string])[],
  ): void {
    const ground = name === "0";
    const marker = `marker-${name}`;
    document.instances.push({
      id: marker,
      symbolId: ground ? "ground" : "vdd-port",
      placement: null,
    });
    document.nets.push({
      id: `net-${name}`,
      terminals: [
        { instanceId: marker, pinName: ground ? "0" : "P" },
        ...pins.map(([instanceId, pinName]) => ({ instanceId, pinName })),
      ],
    });
    document.connectivityEvidence.push({
      id: `claim-${name}`,
      kind: "name-claim",
      netId: `net-${name}`,
      name,
      scope: "global",
      powerDomain: ground ? "ground" : "vdd",
      owner: { kind: "power-marker", objectId: marker },
    });
  }

  /**
   * Two MOS between `in` and `out`, M1 sourced from `other` and M2 from
   * `conventional`. Two supplies of a domain give a body no default, and
   * neither body is wired.
   */
  function twoSupplies(
    kind: "nmos" | "pmos",
    conventional: string,
    other: string,
  ) {
    const project = createEmptyProject("cell", "Two supplies", "cell");
    const document = project.documents[0]!;
    document.netlist!.name = "cell";
    mos(document, "M1", kind);
    mos(document, "M2", kind);
    port(document, "in", [
      ["M1", "G"],
      ["M2", "G"],
    ]);
    port(document, "out", [
      ["M1", "D"],
      ["M2", "D"],
    ]);
    if (other === "VSS") port(document, "VSS", [["M1", "S"]]);
    else supply(document, other, [["M1", "S"]]);
    if (conventional === "VSS") port(document, "VSS", [["M2", "S"]]);
    else supply(document, conventional, [["M2", "S"]]);
    return project;
  }

  it("asks about a PMOS on VDDH whose body takes the conventional VDD", () => {
    const project = twoSupplies("pmos", "VDD", "VDDH");
    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // The body is written where the conventional supply puts it.
    expect(result.file.text).toMatch(/M1 out in VDDH VDD PMOS/u);
    expect(
      result.diagnostics.filter((item) => item.code.startsWith("MOS_BODY")),
    ).toEqual([
      expect.objectContaining({
        code: "MOS_BODY_OTHER_SUPPLY",
        severity: "info",
        objectIds: ["M1"],
        message:
          "M1's body has no Net and takes the conventional VDD; its source is on VDDH. Connect its B pin to VDDH if that is the body you mean",
      }),
    ]);
  });

  it("asks about an NMOS on ground whose body takes the conventional VSS", () => {
    // Ground beside a VSS Cell Pin: the body takes VSS, M1's source is on
    // ground. A deck's root keeps ground as node 0.
    const project = twoSupplies("nmos", "VSS", "0");
    expect(
      analyzeDesignNetlist(project, SIMULATION_DECK_GROUND)
        .diagnostics.filter((item) => item.code.startsWith("MOS_BODY"))
        .map((item) => [item.code, item.objectIds, item.message]),
    ).toEqual([
      [
        "MOS_BODY_OTHER_SUPPLY",
        ["M1"],
        "M1's body has no Net and takes the conventional VSS; its source is on ground. Connect its B pin to ground if that is the body you mean",
      ],
    ]);
  });

  it("asks about each body when the conventional supply is a pin it adds", () => {
    // VDDL and VDDH, and no VDD: the bodies take a VDD pin nobody drew,
    // which neither source is on.
    const project = twoSupplies("pmos", "VDDL", "VDDH");
    expect(
      createDesignNetlistExport(project, { format: "spice" })
        .diagnostics.filter((item) => item.code.startsWith("MOS_BODY"))
        .map((item) => [item.code, item.message]),
    ).toEqual([
      [
        "MOS_BODY_DEFAULT_SUPPLY",
        "The bodies of M1 and M2 have no Net and take the conventional VDD, added to this Cell's pins with VSS; connect a B pin to choose another body",
      ],
      [
        "MOS_BODY_OTHER_SUPPLY",
        "M1's body has no Net and takes the conventional VDD; its source is on VDDH. Connect its B pin to VDDH if that is the body you mean",
      ],
      [
        "MOS_BODY_OTHER_SUPPLY",
        "M2's body has no Net and takes the conventional VDD; its source is on VDDL. Connect its B pin to VDDL if that is the body you mean",
      ],
    ]);
  });
});
