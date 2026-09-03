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
