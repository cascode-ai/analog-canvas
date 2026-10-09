import {
  resolveEndpointConnection,
  visibleSymbolInkBounds,
} from "@icm/derived";
import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import distribution from "../../../docs/agent/distribution.json";

import {
  AGENT_OPERATING_KIT_FORMAT,
  AGENT_OPERATING_KIT_VERSION,
  agentOperatingKit,
} from "./agent-kit.js";
import { createAgentCircuitService } from "./service.js";
import type { AgentPermissions } from "./schema.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const authoringPermissions: AgentPermissions = {
  snapshot: true,
  render: true,
  sourceSpans: false,
  edit: { geometry: true, connectivity: true, presentation: true },
};

function kitFile(path: string): string {
  const file = agentOperatingKit.files.find(
    (candidate) => candidate.path === path,
  );
  if (!file) throw new Error(`Missing Kit file: ${path}`);
  return file.content;
}

type Point = { x: number; y: number };
type Bounds = Point & { width: number; height: number };
type CatalogPin = {
  name: string;
  direction: "north" | "east" | "south" | "west";
  at: Point;
  landing?: Point;
};

function authoringCatalog() {
  return JSON.parse(kitFile("references/razavi-authoring-catalog.json")) as {
    symbols: Array<{
      symbolId: string;
      bounds: Bounds | null;
      pins: Array<CatalogPin & { role: string }>;
      defaultVariantId: string | null;
      variants: Array<{
        id: string;
        hiddenPinNames: string[];
        auxiliaryPins?: CatalogPin[];
        bounds: Bounds;
      }>;
    }>;
    primitives: Array<{
      id: string;
      editKind: string;
      powerDomain: string;
      forbiddenSymbolId: string;
    }>;
  };
}

function symbol(
  catalog: ReturnType<typeof authoringCatalog>,
  symbolId: string,
) {
  const value = catalog.symbols.find(
    (candidate) => candidate.symbolId === symbolId,
  );
  if (!value) throw new Error(`Missing catalog symbol: ${symbolId}`);
  return value;
}

describe("Agent operating Kit", () => {
  it("contains the small provider-neutral authoring working set", () => {
    expect(agentOperatingKit.files.map((file) => file.path)).toEqual(
      distribution.documents
        .filter(
          (document) =>
            document.kitPath && document.consumers.includes("http-kit"),
        )
        .map((document) => document.kitPath),
    );
    expect(agentOperatingKit).toMatchObject({
      format: AGENT_OPERATING_KIT_FORMAT,
      version: AGENT_OPERATING_KIT_VERSION,
    });
    expect(agentOperatingKit.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "README.md",
        "AGENTS.md",
        "skills/icm-circuit-session/SKILL.md",
        "references/session-contract.md",
        "references/authoring-contract.md",
        "references/razavi-authoring-catalog.json",
      ]),
    );
  });

  it("contains operating guidance but never a credential or Project payload", () => {
    const text = agentOperatingKit.files.map((file) => file.content).join("\n");
    expect(text).toContain("snapshot");
    expect(text).toContain("transact");
    expect(text).toContain("OpenAPI");
    expect(text).not.toContain("agentToken:");
    expect(text).not.toContain("claimCode:");
  });

  it("publishes reviewed built-in facts without leaking symbol drawing geometry", () => {
    const catalog = authoringCatalog();
    const nmos = symbol(catalog, "nmos");
    const pmos = symbol(catalog, "pmos");

    expect(nmos.pins.map((pin) => pin.name)).toEqual(["D", "G", "S", "B"]);
    expect(pmos.pins.map((pin) => pin.name)).toEqual(["D", "G", "S", "B"]);
    expect(nmos.variants).toContainEqual(
      expect.objectContaining({
        id: "textbook-3terminal",
        hiddenPinNames: ["B"],
      }),
    );
    expect(catalog.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vdd-rail",
          editKind: "add_power_rail",
          powerDomain: "vdd",
          forbiddenSymbolId: "vdd",
        }),
      ]),
    );
    // Pin offsets and the body's extent, but no artwork.
    for (const key of ['"viewBox"', '"polyline"', '"polygon"', '"part"'])
      expect(kitFile("references/razavi-authoring-catalog.json")).not.toContain(
        key,
      );
  });

  it("gives each pin's offset and the body a wire must keep clear of, as a placed part has them (#1526)", () => {
    const catalog = authoringCatalog();
    const document = createEmptyDocument("document-main", "Main");
    const placed = (symbolId: string, variantId?: string) => ({
      ...document,
      instances: [
        {
          id: "part",
          symbolId,
          ...(variantId ? { symbolVariantId: variantId } : {}),
          placement: {
            position: { x: 0, y: 0 },
            rotation: 0 as const,
            mirror: "none" as const,
          },
        },
      ],
    });
    // The catalog rounds the ink outward to hundredths.
    const covers = (outer: Bounds, inner: Bounds, label: string) => {
      for (const [low, high] of [
        [outer.x - inner.x, outer.x + outer.width - inner.x - inner.width],
        [outer.y - inner.y, outer.y + outer.height - inner.y - inner.height],
      ] as const) {
        expect(low, label).toBeLessThanOrEqual(1e-9);
        expect(low, label).toBeGreaterThan(-0.01);
        expect(high, label).toBeGreaterThanOrEqual(-1e-9);
        expect(high, label).toBeLessThan(0.01);
      }
    };
    const lands = (
      pins: readonly CatalogPin[],
      symbolId: string,
      variantId?: string,
    ) => {
      for (const pin of pins) {
        const connection = resolveEndpointConnection(
          placed(symbolId, variantId),
          resolver,
          { kind: "terminal", instanceId: "part", pinName: pin.name },
        );
        expect(connection, `${symbolId}.${pin.name}`).toMatchObject({
          contactPoint: pin.at,
          gridLanding: pin.landing ?? pin.at,
        });
      }
    };
    for (const symbol of catalog.symbols) {
      const resolved = resolver.resolve(symbol.symbolId)!;
      // A frame that grows with its formula has no fixed extent; its pins
      // are where the default formula puts them.
      if (resolved.definition.formulaPresentation?.adaptiveFrame)
        expect(symbol.bounds, symbol.symbolId).toBeNull();
      else
        covers(
          symbol.bounds!,
          visibleSymbolInkBounds(resolved),
          symbol.symbolId,
        );
      for (const variant of symbol.variants) {
        const label = `${symbol.symbolId}/${variant.id}`;
        covers(
          variant.bounds,
          visibleSymbolInkBounds(
            resolver.resolve(symbol.symbolId, variant.id)!,
          ),
          label,
        );
        lands(
          symbol.pins.filter(
            (pin) => !variant.hiddenPinNames.includes(pin.name),
          ),
          symbol.symbolId,
          variant.id,
        );
        lands(variant.auxiliaryPins ?? [], symbol.symbolId, variant.id);
      }
      if (!symbol.defaultVariantId) lands(symbol.pins, symbol.symbolId);
    }

    // The convention authoring.md states: rotation turns pins clockwise on
    // the page, and mirror then reflects the turned part.
    const nmos = symbol(catalog, "nmos");
    const drain = nmos.pins.find((pin) => pin.name === "D")!;
    expect([drain.direction, drain.at]).toEqual(["north", { x: 10, y: -20 }]);
    const turned = (
      pinName: string,
      rotation: 0 | 90 | 180 | 270,
      mirror: "none" | "horizontal" | "vertical",
    ) =>
      resolveEndpointConnection(
        {
          ...document,
          instances: [
            {
              id: "part",
              symbolId: "nmos",
              symbolVariantId: "textbook-3terminal",
              placement: { position: { x: 100, y: 100 }, rotation, mirror },
            },
          ],
        },
        resolver,
        { kind: "terminal", instanceId: "part", pinName },
      );
    expect(turned("D", 90, "none")).toMatchObject({
      contactPoint: { x: 100 + 20, y: 100 + 10 },
      outward: { x: 1, y: 0 },
    });
    expect(turned("G", 0, "horizontal")).toMatchObject({
      contactPoint: { x: 120, y: 100 },
      outward: { x: 1, y: 0 },
    });
    expect(turned("D", 90, "horizontal")).toMatchObject({
      contactPoint: { x: 80, y: 110 },
      outward: { x: -1, y: 0 },
    });
  });

  it("gives a black-box Agent enough facts to create, refresh, and wire a CMOS inverter", () => {
    const catalog = authoringCatalog();
    const pmos = symbol(catalog, "pmos");
    const nmos = symbol(catalog, "nmos");
    const ground = symbol(catalog, "ground");
    const port = symbol(catalog, "port");
    const vddRail = catalog.primitives.find(
      (primitive) => primitive.id === "vdd-rail",
    );
    expect(pmos.pins.map((pin) => pin.name)).toEqual(["D", "G", "S", "B"]);
    expect(nmos.pins.map((pin) => pin.name)).toEqual(["D", "G", "S", "B"]);
    expect(ground.pins.map((pin) => pin.name)).toEqual(["0"]);
    expect(port.pins.map((pin) => pin.name)).toEqual(["P"]);
    expect(vddRail).toMatchObject({
      editKind: "add_power_rail",
      powerDomain: "vdd",
    });

    let document = createEmptyDocument("document-main", "Main");
    const service = createAgentCircuitService({
      agentId: "black-box-agent",
      resolver,
      permissions: authoringPermissions,
      store: {
        getDocument: () => document,
        commitDocument: (next) => {
          document = next;
        },
      },
    });
    const createEdits = [
      {
        kind: "add_instance" as const,
        instance: {
          id: "MP1",
          symbolId: pmos.symbolId,
          placement: {
            position: { x: 300, y: 180 },
            rotation: 0,
            mirror: "none" as const,
          },
        },
      },
      {
        kind: "add_instance" as const,
        instance: {
          id: "MN1",
          symbolId: nmos.symbolId,
          placement: {
            position: { x: 300, y: 300 },
            rotation: 0,
            mirror: "none" as const,
          },
        },
      },
      {
        kind: "add_instance" as const,
        instance: {
          id: "GND1",
          symbolId: ground.symbolId,
          placement: {
            position: { x: 310, y: 390 },
            rotation: 0,
            mirror: "none" as const,
          },
        },
      },
      {
        kind: "add_power_rail" as const,
        netId: "net-vdd",
        routeId: "route-vdd",
        startJunctionId: "junction-vdd-left",
        endJunctionId: "junction-vdd-right",
        labelId: "label-vdd",
        netName: "VDD",
        scope: "local",
        powerDomain: vddRail!.powerDomain as "vdd",
        start: { x: 260, y: 100 },
        end: { x: 360, y: 100 },
      },
    ];
    const request = (requestId: string, dryRun?: boolean) => ({
      apiVersion: "3.0" as const,
      requestId,
      operation: "transact" as const,
      documentId: document.id,
      transactionId: requestId,
      expectedRevision: document.revision,
      ...(dryRun ? { dryRun: true } : {}),
      edits: createEdits,
    });

    const dryRun = service.handle(request("inverter-create-dry-run", true));
    if (!dryRun.ok) throw new Error(JSON.stringify(dryRun, null, 2));
    expect(dryRun).toMatchObject({
      ok: true,
      applied: false,
      revision: 0,
    });
    expect(service.handle(request("inverter-create-commit"))).toMatchObject({
      ok: true,
      applied: true,
      revision: 1,
    });

    const snapshot = service.handle({
      apiVersion: "3.0",
      requestId: "inverter-after-create",
      operation: "snapshot",
      documentId: document.id,
    });
    expect(snapshot).toMatchObject({ ok: true, operation: "snapshot" });
    if (
      !snapshot.ok ||
      snapshot.operation !== "snapshot" ||
      !("snapshot" in snapshot)
    )
      return;
    expect(snapshot.snapshot.document.instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "MP1",
          pins: expect.arrayContaining([
            expect.objectContaining({ name: "G" }),
          ]),
        }),
        expect.objectContaining({
          id: "MN1",
          pins: expect.arrayContaining([
            expect.objectContaining({ name: "B" }),
          ]),
        }),
      ]),
    );

    const wire = (
      requestId: string,
      from: string,
      fromPin: string,
      to: string,
      toPin: string,
    ) =>
      service.handle({
        apiVersion: "3.0",
        requestId,
        operation: "transact",
        documentId: document.id,
        transactionId: requestId,
        expectedRevision: document.revision,
        wireIntent: {
          id: requestId,
          from: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: from, pinName: fromPin },
          },
          to: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: to, pinName: toPin },
          },
        },
      });
    for (const [requestId, from, fromPin, to, toPin] of [
      ["wire-gates", "MP1", "G", "MN1", "G"],
      ["wire-output", "MP1", "D", "MN1", "D"],
      ["wire-ground", "MN1", "S", "GND1", "0"],
    ] as const) {
      expect(wire(requestId, from, fromPin, to, toPin)).toMatchObject({
        ok: true,
        applied: true,
      });
    }
    expect(
      service.handle({
        apiVersion: "3.0",
        requestId: "wire-vdd-source",
        operation: "transact",
        documentId: document.id,
        transactionId: "wire-vdd-source",
        expectedRevision: document.revision,
        wireIntent: {
          id: "wire-vdd-source",
          from: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: "MP1", pinName: "S" },
          },
          to: {
            kind: "endpoint",
            endpoint: { kind: "junction", junctionId: "junction-vdd-left" },
          },
        },
      }),
    ).toMatchObject({ ok: true, applied: true });

    const afterWiring = service.handle({
      apiVersion: "3.0",
      requestId: "inverter-after-wire",
      operation: "snapshot",
      documentId: document.id,
    });
    expect(afterWiring).toMatchObject({ ok: true, operation: "snapshot" });
    if (
      !afterWiring.ok ||
      afterWiring.operation !== "snapshot" ||
      !("snapshot" in afterWiring)
    )
      return;
    const groundNetId = afterWiring.snapshot.document.instances
      .find((instance) => instance.id === "GND1")
      ?.pins.find((pin) => pin.name === "0")?.netId;
    expect(groundNetId).toBeTruthy();

    expect(
      service.handle({
        apiVersion: "3.0",
        requestId: "inverter-bulk-defaults",
        operation: "transact",
        documentId: document.id,
        transactionId: "inverter-bulk-defaults",
        expectedRevision: document.revision,
        edits: [
          {
            kind: "set_mos_bulk_defaults",
            nmosNetId: groundNetId!,
            pmosNetId: "net-vdd",
          },
          { kind: "reconcile_mos_bulk", instanceIds: ["MP1", "MN1"] },
        ],
      }),
    ).toMatchObject({ ok: true, applied: true });

    const finalSnapshot = service.handle({
      apiVersion: "3.0",
      requestId: "inverter-final-snapshot",
      operation: "snapshot",
      documentId: document.id,
    });
    expect(finalSnapshot).toMatchObject({ ok: true, operation: "snapshot" });
    if (
      !finalSnapshot.ok ||
      finalSnapshot.operation !== "snapshot" ||
      !("snapshot" in finalSnapshot)
    )
      return;
    expect(finalSnapshot.snapshot.document.instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "MP1",
          mosBulk: { status: "cell-default", netId: "net-vdd" },
        }),
        expect.objectContaining({
          id: "MN1",
          mosBulk: { status: "cell-default", netId: groundNetId },
        }),
      ]),
    );
    expect(
      finalSnapshot.snapshot.document.diagnostics.filter((diagnostic) =>
        diagnostic.code.startsWith("ERC_"),
      ),
    ).toEqual([]);
    expect(
      service.handle({
        apiVersion: "3.0",
        requestId: "inverter-formal-render",
        operation: "render",
        documentId: document.id,
        mode: "formal",
      }),
    ).toMatchObject({
      ok: true,
      operation: "render",
      artifact: { mediaType: "image/svg+xml" },
    });
  });
});
