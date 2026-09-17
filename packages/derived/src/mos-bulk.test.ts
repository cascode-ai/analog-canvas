import { createRoutePath } from "@icm/model";
import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  deriveMosBulkRouteFamily,
  hasExplicitMosBulkRoute,
  isMosBulkTerminal,
  mosBulkKind,
  mosBulkShouldBeVisible,
  resolveMosBulkConnection,
  supplyDefaultMosBulkNet,
} from "./mos-bulk.js";

function mos(id: string, symbolId: "nmos" | "pmos" | "ndmos" | "pdmos") {
  return {
    id,
    symbolId,
    symbolVariantId: symbolId.endsWith("dmos")
      ? "standard-3terminal"
      : "textbook-3terminal",
    placement: null,
  };
}

describe("MOS bulk resolution", () => {
  it.each(["nmos", "pmos"] as const)(
    "keeps imported %s default bulk implicit without changing electrical membership",
    (kind) => {
      const document = createEmptyDocument("main", "Main");
      document.instances.push(mos("M1", kind));
      document.nets.push(
        { id: "supply", terminals: [{ instanceId: "M1", pinName: "B" }] },
        { id: "tail", terminals: [{ instanceId: "M1", pinName: "S" }] },
      );
      document.mosBulkDefaults =
        kind === "nmos" ? { nmosNetId: "supply" } : { pmosNetId: "supply" };
      const before = JSON.stringify(document);
      expect(resolveMosBulkConnection(document, "M1")?.status).toBe("explicit");
      expect(mosBulkShouldBeVisible(document, "M1")).toBe(false);
      expect(JSON.stringify(document)).toBe(before);
    },
  );
  /** A Cell with one ground marker, one VDD marker, and one MOS of each kind. */
  function withSupplyMarkers() {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      mos("M1", "nmos"),
      mos("M2", "pmos"),
      { id: "GND1", symbolId: "ground", placement: null },
      { id: "VDD1", symbolId: "vdd-port", placement: null },
    );
    document.nets.push(
      {
        id: "net-gnd",
        terminals: [
          { instanceId: "GND1", pinName: "0" },
          { instanceId: "M1", pinName: "S" },
        ],
      },
      {
        id: "net-vdd",
        terminals: [
          { instanceId: "VDD1", pinName: "P" },
          { instanceId: "M2", pinName: "S" },
        ],
      },
    );
    return document;
  }

  it("follows the supply the author drew when the Cell configures nothing", () => {
    // No per-Cell setting, no button: the marker on the page is the answer,
    // so a pasted copy and a drawing made before the policy existed behave
    // like one drawn today.
    const document = withSupplyMarkers();
    const nmos = resolveMosBulkConnection(document, "M1");
    expect(nmos?.status).toBe("supply-default");
    expect(nmos?.net?.id).toBe("net-gnd");
    const pmos = resolveMosBulkConnection(document, "M2");
    expect(pmos?.status).toBe("supply-default");
    expect(pmos?.net?.id).toBe("net-vdd");
    // Policy explains membership; it never writes it, and it draws no lead.
    expect(nmos?.materialized).toBe(false);
    expect(mosBulkShouldBeVisible(document, "M1")).toBe(false);
  });

  it("lets the Cell's own default outrank the marker", () => {
    const document = withSupplyMarkers();
    document.nets.push({ id: "net-bias", terminals: [] });
    document.mosBulkDefaults = { nmosNetId: "net-bias" };
    const resolution = resolveMosBulkConnection(document, "M1");
    expect(resolution?.status).toBe("cell-default");
    expect(resolution?.net?.id).toBe("net-bias");
    // The other polarity is unconfigured, so it still follows its marker.
    expect(resolveMosBulkConnection(document, "M2")?.net?.id).toBe("net-vdd");
  });

  it("stays silent when the drawing offers more than one supply", () => {
    // AVDD beside VDD is a question for the author. Guessing between them
    // would be exactly the inference this policy refuses to make.
    const document = withSupplyMarkers();
    document.instances.push({
      id: "VDD2",
      symbolId: "vdd-port",
      placement: null,
    });
    document.nets.push({
      id: "net-avdd",
      terminals: [{ instanceId: "VDD2", pinName: "P" }],
    });
    expect(supplyDefaultMosBulkNet(document, "pmos")).toBeUndefined();
    expect(resolveMosBulkConnection(document, "M2")?.status).toBe("unresolved");
    // The single ground marker is unaffected by the supply ambiguity.
    expect(resolveMosBulkConnection(document, "M1")?.status).toBe(
      "supply-default",
    );
  });

  it("ignores a marker nobody has wired yet", () => {
    // An unwired marker names no Net, so it neither answers nor competes.
    const document = withSupplyMarkers();
    document.instances.push({
      id: "GND2",
      symbolId: "ground",
      placement: null,
    });
    expect(supplyDefaultMosBulkNet(document, "nmos")?.id).toBe("net-gnd");
  });

  it("never repairs an imported instance's missing fourth node", () => {
    // Imported source must carry its own body; inventing one would rewrite
    // what the file said.
    const document = withSupplyMarkers();
    document.instances[0] = {
      ...document.instances[0]!,
      importProvenance: {
        kind: "model",
        sourceMasterName: "nch",
        sourceTarget: "nch",
      },
    };
    expect(resolveMosBulkConnection(document, "M1")?.status).toBe("unresolved");
  });

  it("maps expanded DMOS artwork to the existing N/P bulk domains", () => {
    expect(mosBulkKind(mos("M1", "ndmos"))).toBe("nmos");
    expect(mosBulkKind(mos("M2", "pdmos"))).toBe("pmos");
  });

  it("distinguishes MOS bulk B from BJT base B", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(mos("M1", "nmos"), {
      id: "Q1",
      symbolId: "npn",
      placement: null,
    });

    expect(
      isMosBulkTerminal(document, {
        kind: "terminal",
        instanceId: "M1",
        pinName: "B",
      }),
    ).toBe(true);
    expect(
      isMosBulkTerminal(document, {
        kind: "terminal",
        instanceId: "Q1",
        pinName: "B",
      }),
    ).toBe(false);
  });

  it("prefers explicit membership over defaults and exposes body bias", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(mos("M1", "nmos"));
    document.nets.push(
      {
        id: "net-vss",

        terminals: [],
      },
      {
        id: "net-body",

        terminals: [{ instanceId: "M1", pinName: "B" }],
      },
    );
    document.mosBulkDefaults = { nmosNetId: "net-vss" };

    expect(resolveMosBulkConnection(document, "M1")).toMatchObject({
      status: "explicit",
      net: { id: "net-body" },
    });
    expect(mosBulkShouldBeVisible(document, "M1")).toBe(true);
  });

  it("uses the configured stable cell default", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(mos("M1", "nmos"));
    document.nets.push(
      {
        id: "net-cell-substrate",

        terminals: [],
      },
      {
        id: "net-vss",

        terminals: [],
      },
    );
    document.mosBulkDefaults = { nmosNetId: "net-cell-substrate" };

    expect(resolveMosBulkConnection(document, "M1")).toMatchObject({
      status: "cell-default",
      net: { id: "net-cell-substrate" },
      materialized: false,
    });
  });

  it("does not infer a bulk connection from supply names or roles", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(mos("M1", "pmos"));
    document.nets.push(
      {
        id: "net-avdd",

        terminals: [],
      },
      {
        id: "net-vdd",

        terminals: [],
      },
    );

    expect(resolveMosBulkConnection(document, "M1")).toMatchObject({
      status: "unresolved",
      net: undefined,
      materialized: false,
    });
  });

  it.each(["nmos", "pmos"] as const)(
    "leaves an unconfigured manual %s bulk unresolved",
    (symbolId) => {
      const document = createEmptyDocument("main", "Main");
      document.instances.push(mos("M1", symbolId));

      expect(resolveMosBulkConnection(document, "M1")).toMatchObject({
        status: "unresolved",
        net: undefined,
      });
    },
  );

  it("keeps a materialized Cell default visually implicit", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      ...mos("M1", "nmos"),
      mosBulkBinding: {
        netId: "net-cell-substrate",
        origin: "cell-default",
      },
    });
    document.nets.push({
      id: "net-cell-substrate",

      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    document.mosBulkDefaults = { nmosNetId: "net-cell-substrate" };

    expect(mosBulkShouldBeVisible(document, "M1")).toBe(false);
  });

  it("gives an explicit multi-segment bulk route precedence over stale default metadata", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      ...mos("M1", "nmos"),
      mosBulkBinding: {
        netId: "net-vss",
        origin: "cell-default",
      },
    });
    document.nets.push({
      id: "net-vss",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    document.junctions.push(
      { id: "J1", netId: "net-vss", position: { x: 100, y: 100 } },
      { id: "J2", netId: "net-vss", position: { x: 200, y: 100 } },
    );
    document.routes.push(
      createRoutePath({
        id: "bulk-near",
        netId: "net-vss",
        start: { kind: "terminal", instanceId: "M1", pinName: "B" },
        end: { kind: "junction", junctionId: "J1" },
        bends: [],
        modes: ["manual"],
        presentation: "bulk-dashed",
      }),
      createRoutePath({
        id: "bulk-distal",
        netId: "net-vss",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
        presentation: "bulk-dashed",
      }),
    );
    document.mosBulkDefaults = { nmosNetId: "net-vss" };

    expect(hasExplicitMosBulkRoute(document, "M1")).toBe(true);
    expect(deriveMosBulkRouteFamily(document, document.routes[1]!)).toEqual({
      routeIds: ["bulk-distal", "bulk-near"],
      instanceIds: ["M1"],
    });
    expect(resolveMosBulkConnection(document, "M1")).toMatchObject({
      status: "explicit",
      net: { id: "net-vss" },
    });
    expect(mosBulkShouldBeVisible(document, "M1")).toBe(true);
  });

  it("does not guess when imported fourth-node evidence is missing", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      ...mos("M1", "pmos"),
      sourceRef: {
        fileId: "source.sp",
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 1, line: 1, column: 2 },
      },
    });

    expect(resolveMosBulkConnection(document, "M1")).toMatchObject({
      status: "unresolved",
      net: undefined,
    });
  });
});
