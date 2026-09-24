import { createEmptyProject } from "@icm/model";
import type { Net, RouteEndpoint } from "@icm/model";
import {
  InMemorySymbolResolver,
  requireRazaviCatalogSymbol,
} from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  endpointBelongsToNet,
  endpointKey,
  endpointsEqual,
  isVisibleEndpoint,
  netEndpoints,
  resolveEndpointConnection,
  resolveEndpointOutwardDirection,
  resolveEndpointPoint,
} from "./index.js";

// Minimal custom symbol gives full control over pin directions, positions, and
// presentation visibility so endpoint primitives are characterized without
// coupling to a fixture's internal geometry. Pin R faces east; pin L faces
// west; pin X is an implicit presentation terminal; variant "hide-r" hides R.
const resolver = new InMemorySymbolResolver([
  {
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
      {
        name: "X",
        role: "passive",
        at: { x: 0, y: -20 },
        direction: "north" as const,
        presentation: { visibility: "implicit" as const },
      },
    ],
    primitives: [
      { kind: "line" as const, from: { x: -10, y: 0 }, to: { x: 10, y: 0 } },
    ],
    variants: [
      { id: "hide-r", hiddenPinNames: ["R"] },
      {
        id: "offset-r",
        hiddenPinNames: [],
        auxiliaryPins: [
          {
            name: "R",
            at: { x: 16, y: 0 },
            direction: "east",
            routing: {
              escape: "outward",
              preferredLanding: { x: 20, y: 0 },
            },
          },
        ],
      },
    ],
  },
]);

const terminal = (instanceId: string, pinName: string): RouteEndpoint => ({
  kind: "terminal",
  instanceId,
  pinName,
});

function placeDual(
  rotation: 0 | 90 | 180 | 270 = 0,
  position: { x: number; y: number } = { x: 100, y: 100 },
) {
  return {
    id: "I1",
    symbolId: "dual",
    placement: { position, rotation, mirror: "none" as const },
  };
}

describe("endpoint primitives", () => {
  describe("endpointKey", () => {
    it("encodes terminal and junction identities", () => {
      expect(endpointKey(terminal("A", "P"))).toBe("terminal:A:P");
      expect(endpointKey({ kind: "junction", junctionId: "j-1" })).toBe(
        "junction:j-1",
      );
    });
  });

  describe("endpointsEqual", () => {
    it("compares the current endpoint union", () => {
      expect(endpointsEqual(terminal("A", "P"), terminal("A", "P"))).toBe(true);
      expect(endpointsEqual(terminal("A", "P"), terminal("A", "Q"))).toBe(
        false,
      );
      expect(
        endpointsEqual(terminal("j-1", "P"), {
          kind: "junction",
          junctionId: "j-1",
        }),
      ).toBe(false);
    });
  });

  describe("isVisibleEndpoint", () => {
    it("sees a visible pin, hides a variant-hidden pin, and hides an implicit pin", () => {
      const project = createEmptyProject("ep", "EP");
      const document = project.documents[0]!;
      document.instances = [placeDual()];

      expect(isVisibleEndpoint(document, resolver, terminal("I1", "L"))).toBe(
        true,
      );
      // Pin X has presentation.visibility === "implicit" even without a variant.
      expect(isVisibleEndpoint(document, resolver, terminal("I1", "X"))).toBe(
        false,
      );

      document.instances = [{ ...placeDual(), symbolVariantId: "hide-r" }];
      expect(isVisibleEndpoint(document, resolver, terminal("I1", "R"))).toBe(
        false,
      );
      // The variant hides R from visibility but does not remove the pin
      // definition; other pins remain visible.
      expect(isVisibleEndpoint(document, resolver, terminal("I1", "L"))).toBe(
        true,
      );
    });

    it("returns false when the instance or symbol cannot be resolved", () => {
      const project = createEmptyProject("ep", "EP");
      const document = project.documents[0]!;
      expect(
        isVisibleEndpoint(document, resolver, terminal("missing", "L")),
      ).toBe(false);
      document.instances = [{ ...placeDual(), symbolId: "no-such-symbol" }];
      expect(isVisibleEndpoint(document, resolver, terminal("I1", "L"))).toBe(
        false,
      );
    });
  });

  describe("resolveEndpointPoint", () => {
    it("resolves a terminal pin through the instance placement transform", () => {
      const project = createEmptyProject("ep", "EP");
      const document = project.documents[0]!;
      document.instances = [placeDual(0, { x: 100, y: 100 })];
      // Pin R sits at local {20,0}; at rotation 0 it lands at {120,100}.
      expect(
        resolveEndpointPoint(document, resolver, terminal("I1", "R")),
      ).toEqual({ x: 120, y: 100 });
    });
  });

  describe("resolveEndpointConnection", () => {
    it.each([
      "and-gate",
      "nand-gate",
      "or-gate",
      "nor-gate",
      "xor-gate",
      "xnor-gate",
    ])(
      "lands every fine-pitch %s input exactly after each quarter-turn",
      (family) => {
        const document = createEmptyProject("ep", "EP").documents[0]!;
        const gateResolver = new InMemorySymbolResolver([
          requireRazaviCatalogSymbol(`${family}-4`),
        ]);
        for (const rotation of [0, 90, 180, 270] as const) {
          document.instances = [
            {
              ...placeDual(rotation),
              symbolId: `${family}-4`,
            },
          ];
          const contacts = ["A", "B", "C", "D"].map((pinName) =>
            resolveEndpointConnection(
              document,
              gateResolver,
              terminal("I1", pinName),
            ),
          );
          expect(contacts.every(Boolean)).toBe(true);
          for (const connection of contacts) {
            expect(connection?.gridLanding).toEqual(connection?.contactPoint);
            expect(connection?.escapePath).toEqual([]);
          }
          expect(
            new Set(
              contacts.map(
                (connection) =>
                  `${connection?.contactPoint.x}:${connection?.contactPoint.y}`,
              ),
            ).size,
          ).toBe(4);
        }
      },
    );
    it("separates an exact auxiliary contact from its persistable grid landing", () => {
      const project = createEmptyProject("ep", "EP");
      const document = project.documents[0]!;
      document.instances = [{ ...placeDual(), symbolVariantId: "offset-r" }];

      expect(
        resolveEndpointConnection(document, resolver, terminal("I1", "R")),
      ).toEqual({
        endpoint: terminal("I1", "R"),
        contactPoint: { x: 116, y: 100 },
        gridLanding: { x: 120, y: 100 },
        escapePath: [
          { x: 116, y: 100 },
          { x: 120, y: 100 },
        ],
        outward: { x: 1, y: 0 },
      });
    });

    it("transforms contact, landing, escape, and outward direction together", () => {
      const project = createEmptyProject("ep", "EP");
      const document = project.documents[0]!;
      document.instances = [{ ...placeDual(90), symbolVariantId: "offset-r" }];

      expect(
        resolveEndpointConnection(document, resolver, terminal("I1", "R")),
      ).toMatchObject({
        contactPoint: { x: 100, y: 116 },
        gridLanding: { x: 100, y: 120 },
        escapePath: [
          { x: 100, y: 116 },
          { x: 100, y: 120 },
        ],
        outward: { x: 0, y: 1 },
      });
    });

    it("advances an outward landing onto a coarser Document grid", () => {
      const document = createEmptyProject("ep", "EP").documents[0]!;
      document.presentation.grid = 40;
      document.instances = [
        {
          ...placeDual(0, { x: 120, y: 120 }),
          symbolVariantId: "offset-r",
        },
      ];

      expect(
        resolveEndpointConnection(document, resolver, terminal("I1", "R")),
      ).toMatchObject({
        contactPoint: { x: 136, y: 120 },
        gridLanding: { x: 160, y: 120 },
      });
    });

    it("uses one coincident connection for a Junction", () => {
      const document = createEmptyProject("ep", "EP").documents[0]!;
      document.junctions = [
        { id: "J1", netId: "N1", position: { x: 40, y: 60 } },
      ];
      expect(
        resolveEndpointConnection(document, resolver, {
          kind: "junction",
          junctionId: "J1",
        }),
      ).toEqual({
        endpoint: { kind: "junction", junctionId: "J1" },
        contactPoint: { x: 40, y: 60 },
        gridLanding: { x: 40, y: 60 },
        escapePath: [],
        outward: null,
      });
    });
  });

  describe("resolveEndpointOutwardDirection", () => {
    it("maps a pin direction through rotation", () => {
      const project = createEmptyProject("ep", "EP");
      const document = project.documents[0]!;
      // Pin R faces east {1,0}; each rotation transforms the direction vector.
      for (const [rotation, expected] of [
        [0, { x: 1, y: 0 }],
        [90, { x: 0, y: 1 }],
        [180, { x: -1, y: 0 }],
        [270, { x: 0, y: -1 }],
      ] as const) {
        document.instances = [placeDual(rotation)];
        expect(
          resolveEndpointOutwardDirection(
            document,
            resolver,
            terminal("I1", "R"),
          ),
        ).toEqual(expected);
      }
      // Pin L faces west {-1,0} at rotation 0.
      document.instances = [placeDual(0)];
      expect(
        resolveEndpointOutwardDirection(
          document,
          resolver,
          terminal("I1", "L"),
        ),
      ).toEqual({ x: -1, y: 0 });
    });

    it("returns null when instance, placement, or pin is missing", () => {
      const project = createEmptyProject("ep", "EP");
      const document = project.documents[0]!;
      expect(
        resolveEndpointOutwardDirection(
          document,
          resolver,
          terminal("no", "R"),
        ),
      ).toBeNull();
      document.instances = [{ id: "I1", symbolId: "dual", placement: null }];
      expect(
        resolveEndpointOutwardDirection(
          document,
          resolver,
          terminal("I1", "R"),
        ),
      ).toBeNull();
    });
  });

  describe("endpointBelongsToNet and netEndpoints", () => {
    it("unions terminal and net-owned Junction endpoints", () => {
      const document = createEmptyProject("ep", "EP").documents[0]!;
      const net: Net = {
        id: "net-a",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
        ],
      };
      document.junctions = [
        { id: "j-in", netId: "net-a", position: { x: 0, y: 0 } },
        { id: "j-out", netId: "other", position: { x: 0, y: 0 } },
      ];
      expect(endpointBelongsToNet(document, net, terminal("I1", "L"))).toBe(
        true,
      );
      expect(
        endpointBelongsToNet(document, net, {
          kind: "junction",
          junctionId: "j-in",
        }),
      ).toBe(true);
      expect(netEndpoints(document, net)).toEqual<RouteEndpoint[]>([
        { kind: "junction", junctionId: "j-in" },
        terminal("I1", "L"),
        terminal("I1", "R"),
      ]);
    });
  });
});
