import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  isMosBulkTerminal,
  mosBulkShouldBeVisible,
  resolveMosBulkConnection,
} from "./mos-bulk.js";

function mos(id: string, symbolId: "nmos" | "pmos") {
  return {
    id,
    symbolId,
    symbolVariantId: "textbook-3terminal",
    placement: null,
    properties: {},
  };
}

describe("MOS bulk resolution", () => {
  it("distinguishes MOS bulk B from BJT base B", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(mos("M1", "nmos"), {
      id: "Q1",
      symbolId: "npn",
      placement: null,
      properties: {},
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
        name: "VSS",
        scope: "global",
        terminals: [],
      },
      {
        id: "net-body",
        name: "VBODY",
        scope: "local",
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

  it("uses the stable cell default before the supply default", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(mos("M1", "nmos"));
    document.nets.push(
      {
        id: "net-cell-substrate",
        name: "SUBSTRATE",
        scope: "local",
        terminals: [],
      },
      {
        id: "net-vss",
        name: "VSS",
        scope: "global",
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

  it.each([
    ["nmos", "net-global-0", "ground"],
    ["pmos", "net-global-vdd", "vdd"],
  ] as const)(
    "uses an existing global %s supply Net as the default",
    (symbolId, netId, powerDomain) => {
      const document = createEmptyDocument("main", "Main");
      document.instances.push(mos("M1", symbolId));
      document.nets.push({
        id: netId,
        name: symbolId === "nmos" ? "0" : "VDD",
        scope: "global",
        powerDomain,
        terminals: [],
      });

      expect(resolveMosBulkConnection(document, "M1")).toMatchObject({
        status: "supply-default",
        net: { id: netId },
        materialized: false,
      });
    },
  );

  it.each([
    ["nmos", "0"],
    ["pmos", "VDD"],
  ] as const)(
    "requests canonical %s supply creation when none exists",
    (symbolId, defaultName) => {
      const document = createEmptyDocument("main", "Main");
      document.instances.push(mos("M1", symbolId));

      expect(resolveMosBulkConnection(document, "M1")).toMatchObject({
        status: "supply-default",
        net: undefined,
        defaultName,
      });
    },
  );

  it("keeps a materialized Cell default visually implicit", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(mos("M1", "nmos"));
    document.nets.push({
      id: "net-cell-substrate",
      name: "SUBSTRATE",
      scope: "local",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    document.mosBulkDefaults = { nmosNetId: "net-cell-substrate" };

    expect(mosBulkShouldBeVisible(document, "M1")).toBe(false);
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
