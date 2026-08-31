import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";

import { deriveImportedRoutingGuidance } from "./connectivity.js";
import { deriveRoutingGuidance } from "./routing-guidance.js";

const terminal = (instanceId: string) => ({
  kind: "terminal" as const,
  instanceId,
  pinName: "P",
});

describe("routing guidance", () => {
  it("derives a deterministic minimal component bridge without device policy", () => {
    const guides = deriveRoutingGuidance({
      netId: "net-imported",
      components: [
        {
          id: "component-c",
          netId: "net-imported",
          nodes: [
            {
              key: "C",
              endpoint: terminal("C"),
              point: { x: 100, y: 0 },
              priority: 1,
            },
          ],
        },
        {
          id: "component-a",
          netId: "net-imported",
          nodes: [
            {
              key: "A",
              endpoint: terminal("A"),
              point: { x: 0, y: 0 },
              priority: 1,
            },
          ],
        },
        {
          id: "component-b",
          netId: "net-imported",
          nodes: [
            {
              key: "B",
              endpoint: terminal("B"),
              point: { x: 40, y: 0 },
              priority: 1,
            },
          ],
        },
      ],
    });

    expect(guides).toHaveLength(2);
    expect(guides.map((guide) => [guide.fromPoint, guide.toPoint])).toEqual([
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      [
        { x: 40, y: 0 },
        { x: 100, y: 0 },
      ],
    ]);
  });

  it("admits only imported Net provenance through the document adapter", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "A",
        symbolId: "port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
      {
        id: "B",
        symbolId: "port",
        placement: {
          position: { x: 100, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "C",
        symbolId: "port",
        placement: {
          position: { x: 200, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "D",
        symbolId: "port",
        placement: {
          position: { x: 300, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push(
      {
        id: "net-imported",

        terminals: [
          { instanceId: "A", pinName: "P" },
          { instanceId: "B", pinName: "P" },
        ],
      },
      {
        id: "net-authored",

        terminals: [
          { instanceId: "C", pinName: "P" },
          { instanceId: "D", pinName: "P" },
        ],
      },
    );
    document.connectivityEvidence.push({
      id: "source-imported-evidence",
      kind: "spice-source",
      netId: "net-imported",
      sourceNetId: "source-imported",
    });

    expect(
      deriveImportedRoutingGuidance(
        document,
        new InMemorySymbolResolver(builtInSymbols),
      ).map((guide) => guide.netId),
    ).toEqual(["net-imported"]);
  });

  it("routes an imported explicit MOS body through the canonical auxiliary B anchor", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "XM1",
        symbolId: "nmos",
        placement: {
          position: { x: 0, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "P1",
        symbolId: "port",
        placement: {
          position: { x: 100, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-imported-body",

      terminals: [
        { instanceId: "XM1", pinName: "B" },
        { instanceId: "P1", pinName: "P" },
      ],
    });
    document.connectivityEvidence.push({
      id: "source-body-evidence",
      kind: "spice-source",
      netId: "net-imported-body",
      sourceNetId: "source-body",
    });

    const guides = deriveImportedRoutingGuidance(
      document,
      new InMemorySymbolResolver(builtInSymbols),
    );

    expect(guides).toHaveLength(1);
    expect([guides[0]!.from, guides[0]!.to]).toContainEqual({
      kind: "terminal",
      instanceId: "XM1",
      pinName: "B",
    });
  });

  it("bridges disconnected Base Nets that share one imported source", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "A",
        symbolId: "port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
      {
        id: "B",
        symbolId: "port",
        placement: {
          position: { x: 100, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push(
      {
        id: "base-a",

        terminals: [{ instanceId: "A", pinName: "P" }],
      },
      {
        id: "base-b",

        terminals: [{ instanceId: "B", pinName: "P" }],
      },
    );
    document.connectivityEvidence.push(
      {
        id: "source-a",
        kind: "spice-source",
        netId: "base-a",
        sourceNetId: "VIN",
      },
      {
        id: "source-b",
        kind: "spice-source",
        netId: "base-b",
        sourceNetId: "VIN",
      },
    );

    const guides = deriveImportedRoutingGuidance(
      document,
      new InMemorySymbolResolver(builtInSymbols),
    );

    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ netId: "base-a", sourceNetId: "VIN" });
    expect(new Set([guides[0]!.fromNetId, guides[0]!.toNetId])).toEqual(
      new Set(["base-a", "base-b"]),
    );
  });

  it("keeps a resolved named global source exempt from routing guidance", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "A",
        symbolId: "port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
      {
        id: "B",
        symbolId: "port",
        placement: {
          position: { x: 100, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push(
      { id: "base-a", terminals: [{ instanceId: "A", pinName: "P" }] },
      { id: "base-b", terminals: [{ instanceId: "B", pinName: "P" }] },
    );
    document.connectivityEvidence.push(
      {
        id: "source-a",
        kind: "spice-source",
        netId: "base-a",
        sourceNetId: "VDD",
      },
      {
        id: "source-b",
        kind: "spice-source",
        netId: "base-b",
        sourceNetId: "VDD",
      },
      {
        id: "claim-a",
        kind: "name-claim",
        netId: "base-a",
        name: "VDD",
        owner: { kind: "net-label", annotationId: "test-net-label-1" },
        scope: "global",
        powerDomain: "vdd",
      },
      {
        id: "claim-b",
        kind: "name-claim",
        netId: "base-b",
        name: "VDD",
        owner: { kind: "net-label", annotationId: "test-net-label-2" },
        scope: "global",
        powerDomain: "vdd",
      },
    );

    expect(
      deriveImportedRoutingGuidance(
        document,
        new InMemorySymbolResolver(builtInSymbols),
      ),
    ).toEqual([]);
  });
});
