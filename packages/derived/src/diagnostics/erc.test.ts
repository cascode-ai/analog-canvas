import {
  createEmptyProject,
  createRoutePath,
  type Annotation,
  type CircuitProject,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildProjectConnectivityIndex } from "../connectivity-index.js";
import { runErcChecks } from "./erc.js";

const dual = {
  schemaVersion: 1 as const,
  id: "dual",
  name: "Dual",
  viewBox: { x: -20, y: -20, width: 40, height: 40 },
  pins: [
    {
      name: "L",
      role: "passive",
      at: { x: -20, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "R",
      role: "passive",
      at: { x: 20, y: 0 },
      direction: "east" as const,
      presentation: { visibility: "visible" as const },
    },
  ],
  primitives: [
    { kind: "line" as const, from: { x: -10, y: 0 }, to: { x: 10, y: 0 } },
  ],
  variants: [],
};

const resolver = new InMemorySymbolResolver([...builtInSymbols, dual]);

const mos = {
  ...dual,
  id: "mos",
  name: "MOS",
  pins: [
    {
      name: "G",
      role: "gate",
      at: { x: -20, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "D",
      role: "drain",
      at: { x: 0, y: -20 },
      direction: "north" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "S",
      role: "source",
      at: { x: 0, y: 20 },
      direction: "south" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "B",
      role: "bulk",
      at: { x: 20, y: 0 },
      direction: "east" as const,
      presentation: { visibility: "visible" as const },
    },
  ],
  variants: [{ id: "three-terminal", hiddenPinNames: ["B"] }],
};

const roleResolver = new InMemorySymbolResolver([mos]);

function emptyProject(): CircuitProject {
  return createEmptyProject("erc", "ERC", "doc");
}

function instance(id: string, spiceName?: string) {
  return {
    id,
    symbolId: "dual",
    placement: {
      position: { x: 0, y: 0 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    ...(spiceName ? { reference: spiceName, netlist: { parameters: {} } } : {}),
  };
}

function run(project: CircuitProject) {
  return runErcChecks(
    project,
    buildProjectConnectivityIndex(project, resolver),
    resolver,
  );
}

function codes(project: CircuitProject): string[] {
  return run(project).map((diagnostic) => diagnostic.code);
}

function roleRun(project: CircuitProject) {
  return runErcChecks(
    project,
    buildProjectConnectivityIndex(project, roleResolver),
    roleResolver,
  );
}

function roleInstance(variant?: string) {
  return {
    ...instance("M1"),
    symbolId: "mos",
    ...(variant ? { symbolVariantId: variant } : {}),
  };
}

function connectDrainAndSource(project: CircuitProject): void {
  project.documents[0]!.nets.push({
    id: "net-channel",

    terminals: [
      { instanceId: "M1", pinName: "D" },
      { instanceId: "M1", pinName: "S" },
    ],
  });
}

describe("ERC engine", () => {
  it("names swapped part labels, but not a deliberate display alias", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    for (const [index, id] of ["R9", "R10", "R5", "R3", "R2", "R1"].entries())
      document.instances.push({
        id,
        symbolId: "resistor",
        reference: id,
        placement: {
          position: { x: index * 100, y: 0 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: {},
        },
      });
    const label = (
      id: string,
      owner: string,
      shows: { text: string } | { bound: true },
    ) =>
      document.annotations.push({
        id,
        kind: "instance-label",
        ...("bound" in shows
          ? { binding: { kind: "instance-reference", instanceId: owner } }
          : { content: { runs: [{ kind: "text", value: shows.text }] } }),
        anchor: {
          kind: "object",
          objectId: owner,
          localOffset: { x: 0, y: -30 },
          fallbackPosition: { x: 0, y: -30 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      });
    // As in the Gallery's two-stage op amp: M9 and M10 read each other.
    label("label-r9", "R9", { text: "R10" });
    label("label-r10", "R10", { text: "R9" });
    // One name for several parts: R5 is R5, and R3 shows R5 on purpose.
    label("label-r5", "R5", { bound: true });
    label("label-r3", "R3", { text: "R5" });
    // A name no part has, and text that is no name, stay silent too.
    label("label-r2", "R2", { text: "R7" });
    label("label-r1", "R1", { text: "gain stage" });
    const mismatches = run(project).filter(
      (diagnostic) => diagnostic.code === "ERC_LABEL_REFERENCE_MISMATCH",
    );
    expect(mismatches.map((item) => item.parameters)).toEqual([
      {
        instanceId: "R10",
        reference: "R10",
        labelText: "R9",
        namedInstanceId: "R9",
      },
      {
        instanceId: "R9",
        reference: "R9",
        labelText: "R10",
        namedInstanceId: "R10",
      },
    ]);
    expect(
      mismatches.find((item) => item.parameters.instanceId === "R9")?.message,
    ).toBe(
      "R9's name label reads R10, another part's name, while R10 reads R9. The netlist calls this part R9; untick Display alias on the label to show its own name.",
    );
  });

  it("reports a drawn part of a Net that only the data joins to the rest", () => {
    // Issue #1275: two drawn tail nodes were stored in the ground Net.
    const project = emptyProject();
    const document = project.documents[0]!;
    document.nets.push({
      id: "gnd",
      terminals: [{ instanceId: "G1", pinName: "0" }],
    });
    document.instances.push({
      id: "G1",
      symbolId: "ground",
      placement: { position: { x: 300, y: 10 }, rotation: 0, mirror: "none" },
    });
    for (const [id, x, y] of [
      ["a1", 0, 0],
      ["a2", 100, 0],
      ["b2", 400, 0],
      ["c1", 350, -50],
      ["c2", 350, 0],
      ["d1", 0, 100],
      ["d2", 100, 100],
    ] as const)
      document.junctions.push({
        id,
        netId: "gnd",
        position: { x, y },
        role: "route-anchor",
      });
    const wire = (
      id: string,
      from: { kind: "junction"; junctionId: string } | ReturnType<typeof pin>,
      to: string,
    ) =>
      createRoutePath({
        id,
        netId: "gnd",
        start: from,
        end: { kind: "junction", junctionId: to },
        bends: [],
        modes: ["manual"],
      });
    const junction = (junctionId: string) => ({
      kind: "junction" as const,
      junctionId,
    });
    const pin = () => ({
      kind: "terminal" as const,
      instanceId: "G1",
      pinName: "0",
    });
    document.routes.push(
      // Drawn on its own, with nothing naming it: only the data joins it.
      wire("tail", junction("a1"), "a2"),
      // The ground marker names this part.
      wire("ground", pin(), "b2"),
      // Ends on the ground wire: drawn together with it.
      wire("stub", junction("c1"), "c2"),
      // A label names this part.
      wire("labelled", junction("d1"), "d2"),
    );
    document.annotations.push({
      id: "label",
      kind: "net-label",
      binding: { kind: "net-name", netId: "gnd" },
      netId: "gnd",
      anchor: {
        kind: "route",
        routeId: "labelled",
        legId: document.routes.find((route) => route.id === "labelled")!
          .legs[0]!.id,
        t: 0.5,
        normalOffset: -10,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 50, y: 90 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });

    const findings = run(project).filter(
      (diagnostic) => diagnostic.code === "ERC_NET_JOINED_ONLY_IN_DATA",
    );

    expect(findings).toEqual([
      expect.objectContaining({
        severity: "warning",
        gateEligible: false,
        primary: expect.objectContaining({ kind: "route", objectId: "tail" }),
        message: expect.stringContaining(
          "is joined to the rest of it only in the data",
        ),
      }),
    ]);
  });

  it("names a Net Label that is on no wire or pin, not one beside its own wire", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.nets.push(
      { id: "wired", terminals: [] },
      { id: "floating", terminals: [] },
    );
    document.junctions.push(
      {
        id: "A",
        netId: "wired",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "B",
        netId: "wired",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "stub",
        netId: "wired",
        start: { kind: "junction", junctionId: "A" },
        end: { kind: "junction", junctionId: "B" },
        bends: [],
        modes: ["manual"],
      }),
    );
    for (const [id, netId, name] of [
      ["on-its-wire", "wired", "BFT_h<7>"],
      ["pasted", "floating", "BFT_l<6>"],
    ] as const) {
      // Both are free text above the wire; only the first names its Net.
      document.annotations.push({
        id,
        kind: "net-label",
        binding: { kind: "net-name", netId },
        netId,
        anchor: { kind: "free", position: { x: 20, y: -15 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
      document.connectivityEvidence.push({
        id: `claim-${id}`,
        kind: "name-claim",
        netId,
        name,
        scope: "local",
        owner: { kind: "net-label", annotationId: id },
      });
    }
    expect(
      run(project).filter(
        (diagnostic) => diagnostic.code === "ERC_NET_LABEL_NAMES_NOTHING",
      ),
    ).toEqual([
      expect.objectContaining({
        severity: "warning",
        gateEligible: false,
        message:
          "Net Label BFT_l<6> is on no wire or pin, so it names nothing; paste it onto its wire, or place it there with the Net Label tool (L)",
        parameters: { annotationId: "pasted", netId: "floating" },
      }),
    ]);
  });

  it("names a wire that ends in the open, but not a rail's end or a labelled end", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.nets.push({ id: "net", terminals: [] });
    for (const [id, x] of [
      ["A", 0],
      ["B", 100],
      ["C", 200],
      ["D", 300],
      ["E", 400],
      ["F", 500],
    ] as const)
      document.junctions.push({
        id,
        netId: "net",
        position: { x, y: 0 },
        role: "route-anchor",
      });
    const wire = (
      id: string,
      from: string,
      to: string,
      presentation?: "power-rail",
    ) =>
      createRoutePath({
        id,
        netId: "net",
        start: { kind: "junction", junctionId: from },
        end: { kind: "junction", junctionId: to },
        bends: [],
        modes: ["manual"],
        ...(presentation ? { presentation } : {}),
      });
    document.routes.push(
      wire("open", "A", "B"),
      wire("rail", "C", "D", "power-rail"),
      wire("named", "E", "F"),
    );
    document.annotations.push({
      id: "label",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net" },
      netId: "net",
      anchor: {
        kind: "route",
        routeId: "named",
        legId: document.routes.find((route) => route.id === "named")!.legs[0]!
          .id,
        t: 0.5,
        normalOffset: -10,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 450, y: -10 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const dangling = run(project).filter(
      (diagnostic) => diagnostic.code === "ERC_DANGLING_WIRE",
    );
    // Both open ends of the plain wire. The rail and the wire carrying a
    // label stay silent.
    expect(dangling.map((item) => item.parameters)).toEqual([
      { routeId: "open", junctionId: "A" },
      { routeId: "open", junctionId: "B" },
    ]);
    expect(dangling[0]).toMatchObject({
      severity: "warning",
      gateEligible: false,
      message:
        "Wire open ends in the open at Junction A: no pin, other wire or label is there",
    });
  });

  it("counts a Net Label dragged off its stub as that stub's label (#1300)", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      { id: "A", netId: "net", position: { x: 0, y: 0 } },
      { id: "B", netId: "net", position: { x: 40, y: 0 } },
    );
    document.routes.push(
      createRoutePath({
        id: "stub",
        netId: "net",
        start: { kind: "junction", junctionId: "A" },
        end: { kind: "junction", junctionId: "B" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const label: Annotation = {
      id: "b0",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net" },
      netId: "net",
      anchor: { kind: "free", position: { x: 20, y: -3 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
    };
    document.annotations.push(label);
    const dangling = () =>
      run(project)
        .filter((diagnostic) => diagnostic.code === "ERC_DANGLING_WIRE")
        .map((item) => item.parameters);
    // Standing just above the stub, it names both of the stub's open ends.
    expect(dangling()).toEqual([]);
    // Far away it names the Net but not this wire.
    label.anchor = { kind: "free", position: { x: 300, y: 200 } };
    expect(dangling()).toEqual([
      { routeId: "stub", junctionId: "A" },
      { routeId: "stub", junctionId: "B" },
    ]);
  });

  it("says how many Instances the Cell holds but the sheet does not draw", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances.push(
      { id: "M9", reference: "M9", symbolId: "mos", placement: null },
      { id: "M10", reference: "M10", symbolId: "mos", placement: null },
    );
    const finding = run(project).find(
      (diagnostic) => diagnostic.code === "ERC_INSTANCE_NOT_DRAWN",
    );
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("2 Instances");
    expect(finding?.message).toContain("M9, M10");
    expect(finding?.related).toHaveLength(1);

    // Drawn Instances are not the tray's business.
    document.instances[0]!.placement = {
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: "none",
    };
    document.instances[1]!.placement = {
      position: { x: 40, y: 0 },
      rotation: 0,
      mirror: "none",
    };
    expect(codes(project)).not.toContain("ERC_INSTANCE_NOT_DRAWN");
  });

  it("reports effective Port direction conflicts without rewriting independent markers", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
    );
    document.nets.push(
      { id: "net-a", terminals: [{ instanceId: "P1", pinName: "P" }] },
      { id: "net-b", terminals: [{ instanceId: "P2", pinName: "P" }] },
    );
    document.netlist!.terminals.push(
      {
        id: "terminal-a",
        name: "BUS",
        netId: "net-a",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-b",
        name: "bus",
        netId: "net-b",
        direction: "output",
        interfaceInstanceIds: ["P2"],
      },
    );
    const before = structuredClone(project);

    expect(
      run(project).filter(
        (diagnostic) => diagnostic.code === "ERC_CELL_PORT_DIRECTION_CONFLICT",
      ),
    ).toEqual([
      expect.objectContaining({
        severity: "error",
        gateEligible: true,
        primary: expect.objectContaining({
          documentId: document.id,
          kind: "instance",
          objectId: "P1",
        }),
        related: [
          expect.objectContaining({
            documentId: document.id,
            kind: "instance",
            objectId: "P2",
          }),
        ],
      }),
    ]);
    expect(project).toEqual(before);
    document.netlist!.terminals[1]!.direction = "input";
    expect(
      run(project).some(
        (item) => item.code === "ERC_CELL_PORT_DIRECTION_CONFLICT",
      ),
    ).toBe(false);
  });

  it("is silent on a clean project where every pin is connected", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [instance("I1", "M1"), instance("I2", "M2")];
    document.nets = [
      {
        id: "net-1",
        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
      {
        id: "net-2",
        terminals: [
          { instanceId: "I1", pinName: "R" },
          { instanceId: "I2", pinName: "R" },
        ],
      },
    ];
    expect(run(project)).toEqual([]);
  });

  it("warns when both pins of a two-pin part are on one Net", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [instance("I1", "R1")];
    document.nets = [
      {
        id: "net-1",
        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
        ],
      },
    ];

    expect(run(project)).toEqual([
      expect.objectContaining({
        code: "ERC_SHORTED_DEVICE",
        severity: "warning",
        gateEligible: false,
        message: "R1's two pins are on one Net, so the part is shorted",
        primary: expect.objectContaining({
          kind: "instance",
          objectId: "I1",
        }),
        related: [
          expect.objectContaining({ kind: "terminal", objectId: "I1:L" }),
          expect.objectContaining({ kind: "terminal", objectId: "I1:R" }),
        ],
        parameters: { instanceId: "I1", netId: "net-1" },
      }),
    ]);
  });

  it("does not call a dummy transistor tied to one Net shorted", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [
      {
        id: "M1",
        symbolId: "mos",
        placement: {
          position: { x: 0, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    document.nets = [
      {
        id: "vss",
        terminals: ["G", "D", "S", "B"].map((pinName) => ({
          instanceId: "M1",
          pinName,
        })),
      },
    ];

    expect(
      roleRun(project).filter((item) => item.code === "ERC_SHORTED_DEVICE"),
    ).toEqual([]);
  });

  it("reports a pin a wire of another Net passes straight through", () => {
    // Geometry never makes a connection and a Crossing is not a Junction, so
    // nothing repairs this: the author sees a wire reaching the pin and the
    // netlist sees a pin on a different Net. Nothing else says so.
    const project = emptyProject();
    const document = project.documents[0]!;
    // I1 sits at the origin: L at (-20, 0), R at (20, 0).
    document.instances = [
      instance("I1", "M1"),
      {
        id: "I2",
        symbolId: "dual",
        reference: "M2",
        netlist: { parameters: {} },
        placement: {
          position: { x: 0, y: -40 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
      },
    ];
    document.nets = [
      {
        id: "net-pins",
        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
        ],
      },
      {
        id: "net-wire",
        terminals: [
          { instanceId: "I2", pinName: "L" },
          { instanceId: "I2", pinName: "R" },
        ],
      },
    ];
    // A wire of net-wire that detours down through both of I1's pins.
    document.routes = [
      createRoutePath({
        id: "route-through",
        netId: "net-wire",
        start: { kind: "terminal", instanceId: "I2", pinName: "L" },
        end: { kind: "terminal", instanceId: "I2", pinName: "R" },
        bends: [
          { x: -20, y: 0 },
          { x: 20, y: 0 },
        ],
        modes: ["manual", "manual", "manual"],
      }),
    ];

    const findings = run(project).filter(
      (diagnostic) => diagnostic.code === "ERC_TOUCHING_NOT_CONNECTED",
    );
    expect(
      findings.map((diagnostic) => diagnostic.parameters?.["pinName"]),
    ).toEqual(["L", "R"]);
    expect(findings[0]!.message).toContain("belongs to a different Net");
    expect(findings[0]!.parameters?.["routeId"]).toBe("route-through");

    // The same wire on the same Net is the ordinary connected case.
    document.nets[0]!.id = "net-wire-2";
    document.routes[0]!.netId = "net-wire-2";
    document.nets[1]!.terminals.push(
      { instanceId: "I1", pinName: "L" },
      { instanceId: "I1", pinName: "R" },
    );
    document.nets = [document.nets[1]!];
    document.routes[0]!.netId = document.nets[0]!.id;
    expect(
      run(project).filter(
        (diagnostic) => diagnostic.code === "ERC_TOUCHING_NOT_CONNECTED",
      ),
    ).toEqual([]);
  });

  it("reports two parts' pins on one point that are not on one Net", () => {
    // A Port set on a gate, or a Ground on a Port, reads as joined, but the
    // netlist keeps them apart and a copy of the drawing joins them.
    type Document = CircuitProject["documents"][number];
    const net = (id: string, ...terminals: string[]) => ({
      id,
      terminals: terminals.map((terminal) => {
        const [instanceId, pinName] = terminal.split(".");
        return { instanceId: instanceId!, pinName: pinName! };
      }),
    });
    // I1.R and I2.L both sit at (20, 0); no wire is drawn.
    const touching = (
      nets: Document["nets"],
      noConnects: Document["noConnects"] = [],
    ) => {
      const project = emptyProject();
      const document = project.documents[0]!;
      document.instances = [
        instance("I1"),
        {
          ...instance("I2"),
          placement: {
            position: { x: 40, y: 0 },
            rotation: 0 as const,
            mirror: "none" as const,
          },
        },
      ];
      document.nets = nets;
      document.noConnects = noConnects;
      return run(project).filter(
        (diagnostic) => diagnostic.code === "ERC_TOUCHING_NOT_CONNECTED",
      );
    };

    const [finding, ...rest] = touching([
      net("net-a", "I1.L", "I1.R"),
      net("net-b", "I2.L", "I2.R"),
    ]);
    expect(rest).toEqual([]);
    expect(finding!.message).toBe(
      "Pins I1.R and I2.L sit on one point but belong to different Nets",
    );
    expect(finding!.parameters).toEqual({
      instanceId: "I1",
      pinName: "R",
      otherInstanceId: "I2",
      otherPinName: "L",
    });
    // A pin on nothing at that point is reported too.
    expect(
      touching([net("net-a", "I1.L", "I1.R")]).map(
        (diagnostic) => diagnostic.message,
      ),
    ).toEqual(["Pins I1.R and I2.L sit on one point without being connected"]);
    // Pins on one Net are the ordinary joined case.
    expect(
      touching([net("net-joined", "I1.L", "I1.R", "I2.L", "I2.R")]),
    ).toEqual([]);
    // A pin the author declared open has been answered for.
    expect(
      touching([net("net-a", "I1.L", "I1.R"), net("net-b", "I2.R")], [
        {
          id: "nc-1",
          endpoint: { kind: "terminal", instanceId: "I2", pinName: "L" },
        },
      ] as Document["noConnects"]),
    ).toEqual([]);
  });

  it("flags unconnected visible pins and suppresses them via NoConnect", () => {
    const project = emptyProject();
    project.documents[0]!.instances = [instance("I1")];
    expect(codes(project)).toEqual([
      "ERC_UNCONNECTED_PIN",
      "ERC_UNCONNECTED_PIN",
    ]);

    // Declaring L as NoConnect removes its warning; R remains.
    project.documents[0]!.noConnects = [
      {
        id: "nc1",
        endpoint: { kind: "terminal", instanceId: "I1", pinName: "L" },
      },
    ];
    expect(codes(project)).toEqual(["ERC_UNCONNECTED_PIN"]);
    expect(run(project)[0]!.primary).toMatchObject({
      kind: "terminal",
      endpoint: { kind: "terminal", instanceId: "I1", pinName: "R" },
    });
  });

  it("does not let source provenance exempt a currently singleton pin", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [instance("I1")];
    document.nets.push({
      id: "net-imported-singleton",
      terminals: [{ instanceId: "I1", pinName: "L" }],
    });
    document.connectivityEvidence.push({
      id: "source-singleton",
      kind: "spice-source",
      netId: "net-imported-singleton",
      sourceNetId: "source-nbit",
    });
    document.noConnects.push({
      id: "nc-right",
      endpoint: { kind: "terminal", instanceId: "I1", pinName: "R" },
    });

    expect(codes(project)).toEqual(["ERC_UNCONNECTED_PIN"]);
  });

  it("does not flag an implicit pin even when unconnected", () => {
    const implicitResolver = new InMemorySymbolResolver([
      {
        ...dual,
        id: "withImplicit",
        pins: [
          ...dual.pins,
          {
            name: "X",
            role: "passive",
            at: { x: 0, y: -20 },
            direction: "north" as const,
            presentation: { visibility: "implicit" as const },
          },
        ],
      },
    ]);
    const project = emptyProject();
    project.documents[0]!.instances = [
      { ...instance("I1"), symbolId: "withImplicit" },
    ];
    project.documents[0]!.nets = [
      {
        id: "net-1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
        ],
      },
    ];
    // L and R are connected; X is implicit and therefore not required.
    expect(
      runErcChecks(
        project,
        buildProjectConnectivityIndex(project, implicitResolver),
        implicitResolver,
      ),
    ).toEqual([]);
  });

  it("distinguishes an electrically floating gate from generic pins", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [roleInstance()];
    connectDrainAndSource(project);
    document.nets.push(
      {
        id: "net-gate-only",

        terminals: [{ instanceId: "M1", pinName: "G" }],
      },
      {
        id: "net-vss",

        terminals: [{ instanceId: "M1", pinName: "B" }],
      },
    );

    const diagnostics = roleRun(project);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ERC_FLOATING_GATE",
        primary: expect.objectContaining({ objectId: "M1:G" }),
        related: [expect.objectContaining({ objectId: "net-gate-only" })],
      }),
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "ERC_UNCONNECTED_PIN",
    );
  });

  it("reports a Net that shorts reviewed VDD and ground symbols", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [
      { id: "VDD1", symbolId: "vdd-port", placement: null },
      { id: "GND1", symbolId: "ground", placement: null },
    ];
    document.nets = [
      {
        id: "net-short",

        terminals: [
          { instanceId: "VDD1", pinName: "P" },
          { instanceId: "GND1", pinName: "0" },
        ],
      },
    ];
    document.connectivityEvidence = [
      {
        id: "claim-vdd-short",
        kind: "name-claim",
        netId: "net-short",
        name: "VDD",
        scope: "local",
        powerDomain: "vdd",
        owner: { kind: "net-label", annotationId: "test-net-label-1" },
      },
      {
        id: "claim-ground-short",
        kind: "name-claim",
        netId: "net-short",
        name: "0",
        scope: "local",
        powerDomain: "ground",
        owner: { kind: "net-label", annotationId: "test-net-label-2" },
      },
    ];

    expect(run(project)).toContainEqual(
      expect.objectContaining({
        code: "ERC_POWER_DOMAIN_CONFLICT",
        severity: "error",
        primary: expect.objectContaining({ objectId: "net-short" }),
      }),
    );
  });

  it("suppresses role-specific ERC warnings with explicit NoConnect", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [roleInstance()];
    connectDrainAndSource(project);
    document.noConnects = [
      {
        id: "nc-gate",
        endpoint: { kind: "terminal", instanceId: "M1", pinName: "G" },
      },
      {
        id: "nc-bulk",
        endpoint: { kind: "terminal", instanceId: "M1", pinName: "B" },
      },
    ];

    expect(roleRun(project)).toEqual([]);
  });

  it.each(["nmos", "pmos"] as const)(
    "does not warn when an omitted %s bulk has a netlist polarity default",
    (symbolId) => {
      const project = emptyProject();
      project.documents[0]!.instances = [
        { ...instance("M1"), symbolId, symbolVariantId: "textbook-3terminal" },
      ];
      connectDrainAndSource(project);

      expect(
        run(project).filter(
          (diagnostic) => diagnostic.code === "ERC_BULK_UNRESOLVED",
        ),
      ).toEqual([]);
    },
  );

  it("does not treat MOS bulk pins alone as an external body reference", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [
      roleInstance("three-terminal"),
      { ...roleInstance("three-terminal"), id: "M2" },
    ];
    document.nets.push({
      id: "net-bulk-only",

      terminals: [
        { instanceId: "M1", pinName: "B" },
        { instanceId: "M2", pinName: "B" },
      ],
    });

    expect(
      roleRun(project).filter(
        (diagnostic) => diagnostic.code === "ERC_BULK_UNRESOLVED",
      ),
    ).toHaveLength(2);
  });

  it("does not treat SPICE source provenance as an electrical bulk connection", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [roleInstance("three-terminal")];
    connectDrainAndSource(project);
    document.nets.push({
      id: "net-source-bulk",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    document.connectivityEvidence.push({
      id: "source-bulk",
      kind: "spice-source",
      netId: "net-source-bulk",
      sourceNetId: "source-vss",
    });

    expect(
      roleRun(project).filter(
        (diagnostic) => diagnostic.code === "ERC_BULK_UNRESOLVED",
      ),
    ).toHaveLength(1);
  });

  it("flags two instances sharing a normalized Instance Reference", () => {
    const project = emptyProject();
    project.documents[0]!.instances = [
      instance("I1", "M1"),
      instance("I2", "m1"),
    ];
    project.documents[0]!.nets = [
      {
        id: "net-1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
          { instanceId: "I2", pinName: "L" },
          { instanceId: "I2", pinName: "R" },
        ],
      },
    ];
    const diagnostic = run(project).find(
      (item) => item.code === "ERC_DUPLICATE_INSTANCE_REFERENCE",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.severity).toBe("error");
    expect(diagnostic!.related).toHaveLength(1);
  });

  it("treats equal local names as one logical Net without physically merging", () => {
    const project = emptyProject();
    project.documents[0]!.instances = [instance("I1"), instance("I2")];
    project.documents[0]!.nets = [
      {
        id: "net-a",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
      {
        id: "net-b",

        terminals: [{ instanceId: "I1", pinName: "R" }],
      },
    ];
    // Two Base Nets carrying the same local name.
    project.documents[0]!.connectivityEvidence = ["net-a", "net-b"].map(
      (netId) => ({
        id: `claim-${netId}`,
        kind: "name-claim" as const,
        netId,
        name: "OUT",
        owner: { kind: "net-label" as const, annotationId: `label-${netId}` },
        scope: "local" as const,
      }),
    );
    expect(run(project).map((item) => item.code)).not.toContain(
      "ERC_NET_NAME_CONFLICT",
    );
  });

  it("accepts repeated global ground markers as one logical Net", () => {
    const project = emptyProject();
    project.documents[0]!.instances = [
      {
        id: "GND1",
        symbolId: "ground",
        placement: null,
      },
      {
        id: "GND2",
        symbolId: "ground",
        placement: null,
      },
      {
        id: "M1",
        symbolId: "nmos",
        placement: null,
      },
    ];
    project.documents[0]!.nets = [
      {
        id: "net-ground-1",

        terminals: [{ instanceId: "GND1", pinName: "0" }],
      },
      {
        id: "net-ground-2",

        terminals: [{ instanceId: "GND2", pinName: "0" }],
      },
      {
        id: "net-global-0",

        terminals: [{ instanceId: "M1", pinName: "B" }],
      },
    ];

    expect(codes(project)).not.toContain("ERC_NET_NAME_CONFLICT");
    expect(codes(project)).not.toContain("ERC_POWER_DOMAIN_CONFLICT");
  });

  it("defensively reports a NoConnect endpoint that is also on a Net", () => {
    // The schema invariant (WP-R7) rejects this at parse/Edit-Engine time; ERC
    // repeats the check defensively. Construct the invalid state via a cast.
    const project = emptyProject();
    project.documents[0]!.instances = [instance("I1"), instance("I2")];
    project.documents[0]!.nets = [
      {
        id: "net-1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
    ];
    project.documents[0]!.noConnects = [
      {
        id: "nc1",
        endpoint: { kind: "terminal", instanceId: "I1", pinName: "L" },
      },
    ];
    const diagnostics = runErcChecks(
      project as CircuitProject,
      buildProjectConnectivityIndex(project as CircuitProject, resolver),
      resolver,
    );
    expect(
      diagnostics.some((item) => item.code === "ERC_NO_CONNECT_CONFLICT"),
    ).toBe(true);
  });

  it("reports unresolved symbols instead of silently skipping their pins", () => {
    const project = emptyProject();
    project.documents[0]!.instances = [
      { ...instance("I1"), symbolId: "missing-symbol" },
    ];
    const diagnostics = run(project);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ERC_UNRESOLVED_SYMBOL",
        primary: expect.objectContaining({ objectId: "I1" }),
      }),
    );
  });

  it("reports invalid built-in device parameters from existing documents", () => {
    const project = emptyProject();
    project.documents[0]!.instances = [
      {
        id: "V1",
        symbolId: "voltage-source",
        placement: {
          position: { x: 0, y: 0 },
          rotation: 0,
          mirror: "none",
        },
        reference: "V1",
        netlist: {
          parameters: {
            dc: "1",
            waveform: "triangle",
            madeUp: "1",
            freq: "2k",
            frequency: "banana",
          },
        },
      },
    ];
    const diagnostics = run(project);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ERC_INVALID_DEVICE_PARAMETER",
          primary: expect.objectContaining({ objectId: "V1" }),
        }),
        expect.objectContaining({
          code: "ERC_UNKNOWN_DEVICE_PARAMETER",
          primary: expect.objectContaining({ objectId: "V1" }),
          message: expect.stringContaining("allowed parameters"),
        }),
        // #1268: a stored value an Agent once wrote, from before the check.
        expect.objectContaining({
          code: "ERC_UNKNOWN_DEVICE_PARAMETER",
          message: expect.stringContaining(
            "unknown parameter freq (did you mean frequency?)",
          ),
        }),
        expect.objectContaining({
          code: "ERC_INVALID_DEVICE_PARAMETER",
          message:
            'Instance V1 parameter frequency is "banana", which is neither a SPICE number nor an expression in braces',
        }),
      ]),
    );
  });

  it("explains a stored value with an upper-case M before its unit (#1409)", () => {
    const project = emptyProject();
    project.documents[0]!.instances = [
      {
        id: "R1",
        symbolId: "resistor",
        reference: "R1",
        placement: {
          position: { x: 0, y: 0 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1MΩ" },
        },
      },
    ];
    expect(
      run(project).filter(
        (item) => item.code === "ERC_INVALID_DEVICE_PARAMETER",
      ),
    ).toEqual([
      expect.objectContaining({
        severity: "error",
        primary: expect.objectContaining({ objectId: "R1" }),
        message:
          'Instance R1 parameter value is "1MΩ", which reads as 1 mΩ in SPICE (M is milli): write 1MegΩ for mega or 1mΩ for milli',
      }),
    ]);
  });

  it("names the forms an ideal comparator's levels take (#1306)", () => {
    const project = emptyProject();
    const comparator = {
      id: "X1",
      symbolId: "comparator",
      reference: "X1",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      netlist: {
        binding: {
          kind: "unresolved-subcircuit" as const,
          name: "icm_ideal_comparator",
        },
        parameters: { vhigh: "VSS", vlow: "{low}", vtransition: "1m" },
      },
    };
    project.documents[0]!.instances = [comparator];
    const findings = () =>
      run(project)
        .filter((item) => item.code === "ERC_INVALID_DEVICE_PARAMETER")
        .map((item) => item.message);
    // Export checks numbers, so neither level takes an expression.
    expect(findings()).toEqual([
      'Instance X1 parameter vhigh is "VSS", which is neither a SPICE number nor VDD',
      'Instance X1 parameter vlow is "{low}", which is not a SPICE number',
    ]);
    comparator.netlist.parameters = {
      vhigh: "vdd",
      vlow: "0",
      vtransition: "1m",
    };
    expect(findings()).toEqual([]);
  });

  it("checks a part bound to a reviewed SKY130 model against that model's parameters", () => {
    // Issue #1274: a SKY130 resistor carries w, l and mult, not value.
    const project = emptyProject();
    project.externalSubcircuitDefinitions = [
      {
        id: "def-res",
        name: "sky130_fd_pr__res_high_po",
        terminals: ["R0", "R1", "B"].map((name) => ({ name })),
        formalParameters: [],
      },
      {
        id: "def-own",
        name: "my_trim",
        terminals: ["A", "B"].map((name) => ({ name })),
        formalParameters: [],
      },
    ] as never;
    const part = (id: string, definitionId: string, parameters: object) => ({
      id,
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      reference: id,
      netlist: {
        binding: { kind: "external-subcircuit" as const, definitionId },
        parameters: parameters as Record<string, string>,
      },
    });
    project.documents[0]!.instances = [
      part("XRA", "def-res", { w: "1", l: "5.5", mult: "1" }),
      part("XRB", "def-res", { w: "1", wdith: "2" }),
      part("XRC", "def-own", { trim: "3", value: "1k" }),
    ];

    const parameterFindings = run(project)
      .filter((d) => d.code.endsWith("_DEVICE_PARAMETER"))
      .map((d) => d.message);

    expect(parameterFindings).toEqual([
      "Instance XRB sets unknown parameter wdith; allowed parameters: w, l, mult",
    ]);
  });

  it("uses only typed binding evidence for missing and unsupported model ERC", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [
      {
        ...instance("I1"),
        importProvenance: {
          kind: "model",
          sourceMasterName: "missing-model",
          sourceTarget: "model:missing-model",
          status: "missing",
        },
      },
    ];
    document.nets = [
      {
        id: "net-1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
        ],
      },
    ];

    expect(codes(project)).toContain("ERC_MISSING_MODEL");
    expect(codes(project)).not.toContain("ERC_UNSUPPORTED_MODEL");

    document.instances[0] = {
      ...document.instances[0]!,
      importProvenance: {
        kind: "opaque",
        sourceMasterName: "unsupported-device",
        sourceTarget: "opaque:unsupported-device",
        status: "unsupported",
      },
    };
    document.revision += 1;
    expect(codes(project)).toContain("ERC_UNSUPPORTED_MODEL");
    expect(codes(project)).not.toContain("ERC_MISSING_MODEL");
  });

  it("reports a missing X-call master separately from a missing device model", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [
      {
        ...instance("I1"),
        reference: "XI1",
        netlist: {
          binding: {
            kind: "external-subcircuit",
            definitionId: "external-missing",
          },
          parameters: {},
        },
        importProvenance: {
          kind: "opaque",
          sourceMasterName: "missing_external_master",
          sourceTarget: "external-subcircuit:missing_external_master",
          status: "missing",
        },
      },
    ];
    document.nets = [
      {
        id: "net-1",
        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
        ],
      },
    ];

    expect(codes(project)).toContain("ERC_MISSING_EXTERNAL_MASTER");
    expect(codes(project)).not.toContain("ERC_MISSING_MODEL");
  });

  it("diagnoses only persisted imported pin facts that drift from a symbol", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [
      {
        ...instance("I1"),
        reference: "I1",
        netlist: {
          parameters: {},
        },
        importProvenance: {
          kind: "opaque",
          sourceMasterName: "fixture",
          sourceTarget: "fixture:terminal-mapping",
          terminalMapping: [
            { sourcePosition: 0, pinName: "L" },
            { sourcePosition: 1, pinName: "MISSING" },
            { sourcePosition: 2, pinName: "L" },
          ],
        },
      },
    ];
    document.nets = [
      {
        id: "net-1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
        ],
      },
    ];
    const mappingDiagnostics = run(project).filter(
      (diagnostic) => diagnostic.code === "ERC_ILLEGAL_PIN_NAME",
    );
    expect(mappingDiagnostics).toHaveLength(2);
    expect(
      mappingDiagnostics.map((diagnostic) => diagnostic.parameters.position),
    ).toEqual([1, 2]);

    document.instances[0] = instance("I1");
    document.revision += 1;
    expect(codes(project)).not.toContain("ERC_ILLEGAL_PIN_NAME");
  });
});

describe("wires of different Nets on one line (#1309)", () => {
  /** Two loose wires: `a` along x = 200 from y = -60 to 10, and `b` drawn
   * through `points`, on a Net of its own unless `sameNet`. */
  function wires(points: { x: number; y: number }[], sameNet = false) {
    const project = emptyProject();
    const document = project.documents[0]!;
    const add = (id: string, path: { x: number; y: number }[]) => {
      const netId = sameNet ? "n-a" : `n-${id}`;
      if (!document.nets.some((net) => net.id === netId))
        document.nets.push({ id: netId, terminals: [] });
      document.junctions.push(
        { id: `${id}-start`, netId, position: path[0]! },
        { id: `${id}-end`, netId, position: path.at(-1)! },
      );
      document.routes.push(
        createRoutePath({
          id,
          netId,
          start: { kind: "junction", junctionId: `${id}-start` },
          end: { kind: "junction", junctionId: `${id}-end` },
          bends: path.slice(1, -1),
          modes: path.slice(1).map(() => "manual" as const),
        }),
      );
    };
    add("a", [
      { x: 200, y: -60 },
      { x: 200, y: 10 },
    ]);
    add("b", points);
    return project;
  }
  const overlaps = (project: CircuitProject) =>
    run(project).filter((item) => item.code === "ERC_OVERLAPPING_NETS");

  it("reports two Nets drawn over a common span, naming both wires", () => {
    // Swapped op-amp inputs: b comes up the same column to y = -10.
    const found = overlaps(
      wires([
        { x: 200, y: 100 },
        { x: 200, y: -10 },
        { x: 220, y: -10 },
      ]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      severity: "error",
      primary: expect.objectContaining({ objectId: "a" }),
      parameters: {
        routeId: "a",
        otherRouteId: "b",
        fromX: 200,
        fromY: -10,
        toX: 200,
        toY: 10,
      },
    });
    expect(found[0]!.related[0]).toMatchObject({ objectId: "b" });
  });

  it("stays quiet for a crossing, wires meeting end to end, and one Net", () => {
    expect(
      overlaps(
        wires([
          { x: 150, y: 0 },
          { x: 250, y: 0 },
        ]),
      ),
    ).toEqual([]);
    expect(
      overlaps(
        wires([
          { x: 200, y: 10 },
          { x: 200, y: 60 },
        ]),
      ),
    ).toEqual([]);
    expect(
      overlaps(
        wires(
          [
            { x: 200, y: 100 },
            { x: 200, y: -10 },
          ],
          true,
        ),
      ),
    ).toEqual([]);
  });
});

describe("Nets that reach only gates, bulks and block inputs (#1473)", () => {
  type Document = CircuitProject["documents"][number];
  const placed = (id: string, symbolId: string) => ({
    id,
    reference: id,
    symbolId,
    placement: {
      position: { x: 0, y: 0 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
  });
  /** One Net joining `pins` ("M1.G"), each part drawn with `symbolId`. */
  function lineTo(symbolId: string, pins: readonly string[]): CircuitProject {
    const project = emptyProject();
    const document = project.documents[0]!;
    const terminals = pins.map((pin) => {
      const [instanceId, pinName] = pin.split(".") as [string, string];
      return { instanceId, pinName };
    });
    document.instances = [
      ...new Set(terminals.map((terminal) => terminal.instanceId)),
    ].map((id) => placed(id, symbolId));
    document.nets = [{ id: "net-line", terminals }];
    return project;
  }
  /** Put another part's pin on the line. */
  function join(document: Document, id: string, symbolId: string, pin: string) {
    document.instances.push(placed(id, symbolId));
    document.nets[0]!.terminals.push({ instanceId: id, pinName: pin });
  }
  const undriven = (project: CircuitProject) =>
    run(project).filter((item) => item.code === "ERC_UNDRIVEN_GATE_NET");

  it("warns about a bias line that reaches two gates and nothing else", () => {
    // A local name is not a driver: VB1 is only what the line is called.
    const project = lineTo("nmos", ["M1.G", "M2.G"]);
    project.documents[0]!.connectivityEvidence.push({
      id: "claim-vb1",
      kind: "name-claim",
      netId: "net-line",
      name: "VB1",
      scope: "local",
      owner: { kind: "net-label", annotationId: "label-vb1" },
    });

    expect(undriven(project)).toEqual([
      expect.objectContaining({
        severity: "warning",
        confidence: "high",
        gateEligible: false,
        message: expect.stringMatching(/VB1.*M1\.G, M2\.G/u),
        primary: expect.objectContaining({
          kind: "terminal",
          objectId: "M1:G",
          endpoint: { kind: "terminal", instanceId: "M1", pinName: "G" },
        }),
        related: [
          expect.objectContaining({ kind: "terminal", objectId: "M2:G" }),
          expect.objectContaining({ kind: "net", objectId: "net-line" }),
        ],
        parameters: { netId: "net-line", count: 2 },
      }),
    ]);
    expect(codes(project)).not.toContain("ERC_FLOATING_GATE");
  });

  it.each<[string, (document: Document) => void]>([
    [
      "a Cell Pin",
      (document) =>
        document.netlist!.terminals.push({
          id: "pin-vb",
          name: "VB",
          netId: "net-line",
          direction: "input",
          interfaceInstanceIds: [],
          interfaceAnnotationId: "pin-label-vb",
        }),
    ],
    [
      "a global name",
      (document) =>
        document.connectivityEvidence.push({
          id: "claim-vb",
          kind: "name-claim",
          netId: "net-line",
          name: "VBIAS",
          scope: "global",
          owner: { kind: "net-label", annotationId: "label-vb" },
        }),
    ],
    ["a resistor", (document) => join(document, "R1", "resistor", "1")],
    ["a capacitor", (document) => join(document, "C1", "capacitor", "1")],
    ["a transistor's drain", (document) => join(document, "M3", "nmos", "D")],
  ])("stays quiet once %s reaches the line", (_, connect) => {
    const project = lineTo("nmos", ["M1.G", "M2.G"]);
    connect(project.documents[0]!);
    expect(undriven(project)).toEqual([]);
  });

  it("warns about bodies that only reach each other", () => {
    // A bulk-driven OTA whose input reaches the bulks alone.
    const found = undriven(lineTo("pmos", ["M1.B", "M2.B"]));
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("M1.B, M2.B");
  });

  it("warns about logic inputs that nothing drives", () => {
    const found = undriven(lineTo("inverter", ["U1.A", "U2.A"]));
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("U1.A, U2.A");
  });

  it("leaves a lone gate to ERC_FLOATING_GATE", () => {
    const diagnostics = run(lineTo("nmos", ["M1.G"])).map((item) => item.code);
    expect(diagnostics).toContain("ERC_FLOATING_GATE");
    expect(diagnostics).not.toContain("ERC_UNDRIVEN_GATE_NET");
  });
});
