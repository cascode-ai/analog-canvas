import {
  endpointKey,
  isVisibleEndpoint,
  resolveDocumentRoutingGeometry,
  resolveEndpointConnection,
} from "@icm/derived";
import {
  executeTransaction,
  proposeWireCommitThroughContacts,
  type SchematicEdit,
  type WireCornerOrder,
  type WireDraftStep,
  type WireRoutingMode,
  type WireSource,
} from "@icm/edit-engine";
import {
  createEmptyDocument,
  createRoutePath,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import type { WireDraftTarget } from "../../interaction/interaction-state";
import {
  resolveWireDraftPreview,
  wirePassThroughContacts,
  wireSourceForTarget,
} from "./wire-draft-preview";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function nmos(
  document: SchematicDocument,
  id: string,
  position: Point,
  variantId?: string,
): void {
  document.instances.push({
    id,
    symbolId: "nmos",
    ...(variantId ? { symbolVariantId: variantId } : {}),
    placement: { position, rotation: 0, mirror: "none" },
  });
}

/** A bare free anchor at one point, for bounding a gesture in a test. */
function freePoint(point: Point): WireSource {
  const endpoint = { kind: "junction" as const, junctionId: `at-${point.x}` };
  return {
    endpoint,
    netId: null,
    preludeEdits: [],
    connection: {
      endpoint,
      contactPoint: point,
      gridLanding: point,
      escapePath: [],
      outward: null,
    },
  };
}

function terminal(instanceId: string, pinName: string): RouteEndpoint {
  return { kind: "terminal", instanceId, pinName };
}

function wireSource(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
): WireSource {
  const connection = resolveEndpointConnection(document, resolver, endpoint)!;
  expect(connection).toBeTruthy();
  return { endpoint, connection, netId: null, preludeEdits: [] };
}

/**
 * The visible pins, which is what the editor hands the commit planner. Hidden
 * pins are excluded exactly as `visibleWireSources` excludes them: a pin
 * nobody can see is not a contact a gesture can be aimed at.
 */
function visibleTerminals(document: SchematicDocument): WireSource[] {
  return document.instances.flatMap((instance) => {
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved || !instance.placement) return [];
    return resolved.definition.pins.flatMap((pin) => {
      const endpoint = terminal(instance.id, pin.name);
      if (!isVisibleEndpoint(document, resolver, endpoint)) return [];
      const connection = resolveEndpointConnection(
        document,
        resolver,
        endpoint,
      );
      return connection
        ? [{ endpoint, connection, netId: null, preludeEdits: [] }]
        : [];
    });
  });
}

interface Draft {
  steps?: readonly WireDraftStep[];
  routingMode?: WireRoutingMode;
  cornerOrder?: WireCornerOrder;
}

/**
 * The centreline the editor actually draws once the wire is committed.
 *
 * This runs the real commit path — the same planner call `commitWire` makes,
 * through the real transaction, read back through the same
 * `resolveDocumentRoutingGeometry` the canvas renders from. Nothing here is a
 * restatement of the preview: it is what lands on the sheet.
 */
function committedCenterline(
  document: SchematicDocument,
  source: WireSource,
  to: WireSource,
  draft: Draft,
): Point[] {
  const proposal = proposeWireCommitThroughContacts(
    source,
    to,
    (draft.steps ?? []).map((step) => step.point),
    wirePassThroughContacts(visibleTerminals(document), {
      from: source,
      to,
      steps: draft.steps ?? [],
    }),
    1,
    {
      steps: draft.steps ?? [],
      routingMode: draft.routingMode ?? "orthogonal",
      cornerOrder: draft.cornerOrder ?? "auto",
    },
  );
  const authored = proposal.edits.flatMap((edit: SchematicEdit) =>
    edit.kind === "set_route_path" ? [edit.route.id] : [],
  );
  if (authored.length === 0) return [];
  const result = executeTransaction(
    document,
    {
      transactionId: "commit-under-test",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "test" },
      edits: proposal.edits,
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) {
    throw new Error(
      `Commit rejected: ${result.error.message} ${JSON.stringify(result.diagnostics)}`,
    );
  }
  const geometry = resolveDocumentRoutingGeometry(result.document, resolver);
  const centerlines = authored.map((routeId) => {
    const resolved = geometry.routes.get(routeId);
    expect(resolved, `committed route ${routeId} has no geometry`).toBeTruthy();
    return resolved!.centerline;
  });
  // The parts of one gesture read as one conductor: joined at the shared
  // contact each split was made at, exactly once.
  return centerlines.reduce<Point[]>((joined, centerline) => {
    const previous = joined.at(-1);
    const first = centerline[0]!;
    const overlaps =
      previous && previous.x === first.x && previous.y === first.y;
    return [...joined, ...(overlaps ? centerline.slice(1) : centerline)];
  }, []);
}

function previewFor(
  document: SchematicDocument,
  source: WireSource,
  target: WireDraftTarget,
  draft: Draft = {},
) {
  return resolveWireDraftPreview({
    document,
    source,
    target,
    steps: draft.steps ?? [],
    routingMode: draft.routingMode ?? "orthogonal",
    cornerOrder: draft.cornerOrder ?? "auto",
    visibleEndpoints: visibleTerminals(document),
  });
}

/**
 * Run one drawing intent both ways and hold the two answers against each
 * other. The commit runs on its own copy so the preview never sees a
 * Document the release has already changed.
 */
function bothWays(
  build: () => SchematicDocument,
  sourceEndpoint: RouteEndpoint,
  target: (document: SchematicDocument) => WireDraftTarget,
  draft: Draft = {},
) {
  const previewDocument = build();
  const preview = previewFor(
    previewDocument,
    wireSource(previewDocument, sourceEndpoint),
    target(previewDocument),
    draft,
  );
  const commitDocument = build();
  const commitTarget = target(commitDocument);
  const to = wireSourceForTarget(
    commitDocument,
    commitTarget,
    wireSource(commitDocument, sourceEndpoint).netId,
    () => ({
      junctionId: "junction-ui-1",
      firstRouteId: "route-a-1",
      secondRouteId: "route-b-1",
      newNetId: "net-ui-1",
    }),
  )!;
  expect(to, "the target resolves to a committable endpoint").toBeTruthy();
  const committed = committedCenterline(
    commitDocument,
    wireSource(commitDocument, sourceEndpoint),
    to,
    draft,
  );
  return { preview, committed };
}

describe("the wire a draft preview promises is the wire that lands", () => {
  it("ends on a pin whose landing is not its contact point", () => {
    // The textbook three-terminal NMOS puts its bulk contact inside the body
    // at -4 and lands the wire on the grid at 0. A preview that treats the
    // hovered point as contact, landing, and escape all at once draws one
    // straight leg; the commit turns the corner at the landing and steps in
    // to the contact.
    const build = () => {
      const document = createEmptyDocument("main", "Main");
      nmos(document, "M1", { x: 200, y: 200 });
      nmos(document, "M2", { x: 400, y: 260 }, "textbook-3terminal");
      return document;
    };
    const { preview, committed } = bothWays(
      build,
      terminal("M1", "G"),
      (document) => ({
        kind: "endpoint",
        point: resolveEndpointConnection(
          document,
          resolver,
          terminal("M2", "B"),
        )!.contactPoint,
        source: wireSource(document, terminal("M2", "B")),
      }),
    );

    expect(preview.points).toEqual(committed);
    expect(preview.points.length).toBeGreaterThan(2);
  });

  it("ends on an ordinary grid-aligned pin", () => {
    const build = () => {
      const document = createEmptyDocument("main", "Main");
      nmos(document, "M1", { x: 200, y: 200 });
      nmos(document, "M2", { x: 500, y: 400 });
      return document;
    };
    const { preview, committed } = bothWays(
      build,
      terminal("M1", "G"),
      (document) => ({
        kind: "endpoint",
        point: resolveEndpointConnection(
          document,
          resolver,
          terminal("M2", "G"),
        )!.contactPoint,
        source: wireSource(document, terminal("M2", "G")),
      }),
    );

    expect(preview.points).toEqual(committed);
    expect(preview.contacts).toEqual([]);
  });

  it("crosses a pin without stopping on it", () => {
    // M2's gate sits exactly on the straight run from M1's gate to M3's gate.
    // The commit makes that contact and splits the gesture into two Routes;
    // a preview that draws one unbroken line is describing a wire the editor
    // will not build.
    const build = () => {
      const document = createEmptyDocument("main", "Main");
      nmos(document, "M1", { x: 200, y: 200 });
      nmos(document, "M2", { x: 400, y: 200 });
      nmos(document, "M3", { x: 600, y: 200 });
      return document;
    };
    const { preview, committed } = bothWays(
      build,
      terminal("M1", "G"),
      (document) => ({
        kind: "endpoint",
        point: resolveEndpointConnection(
          document,
          resolver,
          terminal("M3", "G"),
        )!.contactPoint,
        source: wireSource(document, terminal("M3", "G")),
      }),
    );

    expect(preview.points).toEqual(committed);
    // The crossed pin is a contact the drawing has to show, not a coincidence.
    expect(preview.contacts).toEqual([{ x: 380, y: 200 }]);
  });

  it("is dropped on empty canvas", () => {
    const build = () => {
      const document = createEmptyDocument("main", "Main");
      nmos(document, "M1", { x: 200, y: 200 });
      return document;
    };
    const { preview, committed } = bothWays(build, terminal("M1", "G"), () => ({
      kind: "free",
      point: { x: 60, y: 340 },
    }));

    expect(preview.points).toEqual(committed);
  });

  it("lands on a conductor a run arrives at off the grid", () => {
    // routeTapPoint deliberately keeps an arriving run straight by holding
    // its coordinate within one grid step; createRouteWireAnchor then rounds
    // the Junction onto the grid. The preview must show the wire the second
    // rule builds, elbow and all, rather than the straight one the first rule
    // aimed at.
    const build = () => {
      const document = createEmptyDocument("main", "Main");
      nmos(document, "M1", { x: 200, y: 200 }, "textbook-3terminal");
      document.nets.push({ id: "net-rail", terminals: [] });
      document.junctions.push(
        {
          id: "rail-a",
          netId: "net-rail",
          position: { x: 100, y: 500 },
          role: "route-anchor",
        },
        {
          id: "rail-b",
          netId: "net-rail",
          position: { x: 600, y: 500 },
          role: "route-anchor",
        },
      );
      document.routes.push(
        createRoutePath({
          id: "rail",
          netId: "net-rail",
          start: { kind: "junction", junctionId: "rail-a" },
          end: { kind: "junction", junctionId: "rail-b" },
          bends: [],
          modes: ["manual"],
        }),
      );
      return document;
    };
    // The bulk contact sits at x = 196, so a run arriving straight down from
    // it taps the rail at 196 — one grid step from 200, which is where the
    // commit will actually put the Junction.
    const { preview, committed } = bothWays(build, terminal("M1", "B"), () => ({
      kind: "route",
      point: { x: 196, y: 500 },
      routeId: "rail",
      segmentIndex: 0,
    }));

    expect(preview.points).toEqual(committed);
    expect(preview.points.at(-1)).toEqual({ x: 200, y: 500 });
  });

  it("reverses its last segment back over the leg before it", () => {
    // Drawing out and then back cancels the doubled-back leg. Preview and
    // commit have to cancel the same one.
    const build = () => {
      const document = createEmptyDocument("main", "Main");
      nmos(document, "M1", { x: 200, y: 200 });
      return document;
    };
    const { preview, committed } = bothWays(
      build,
      terminal("M1", "G"),
      () => ({ kind: "free", point: { x: 60, y: 400 } }),
      {
        steps: [
          { point: { x: 60, y: 200 }, routingMode: "orthogonal" },
          { point: { x: 60, y: 600 }, routingMode: "orthogonal" },
        ],
      },
    );

    expect(preview.points).toEqual(committed);
    expect(preview.points).toEqual([
      { x: 180, y: 200 },
      { x: 60, y: 200 },
      { x: 60, y: 400 },
    ]);
  });

  it("draws nothing while the far end rests on the source itself", () => {
    const document = createEmptyDocument("main", "Main");
    nmos(document, "M1", { x: 200, y: 200 });
    const source = wireSource(document, terminal("M1", "G"));

    expect(
      previewFor(document, source, {
        kind: "free",
        point: source.connection.contactPoint,
      }).points,
    ).toEqual([]);
  });

  it("reports no geometry for a Route target that no longer exists", () => {
    const document = createEmptyDocument("main", "Main");
    nmos(document, "M1", { x: 200, y: 200 });

    expect(
      previewFor(document, wireSource(document, terminal("M1", "G")), {
        kind: "route",
        point: { x: 400, y: 400 },
        routeId: "route-that-was-deleted",
        segmentIndex: 0,
      }),
    ).toEqual({ points: [], contacts: [] });
  });
});

describe("wirePassThroughContacts", () => {
  const document = createEmptyDocument("main", "Main");
  nmos(document, "M1", { x: 200, y: 200 });
  nmos(document, "M2", { x: 900, y: 900 });
  const junction: WireSource = {
    endpoint: { kind: "junction", junctionId: "j1" },
    netId: null,
    preludeEdits: [],
    connection: {
      endpoint: { kind: "junction", junctionId: "j1" },
      contactPoint: { x: 210, y: 210 },
      gridLanding: { x: 210, y: 210 },
      escapePath: [],
      outward: null,
    },
  };
  const across = (from: Point, to: Point) => ({
    from: freePoint(from),
    to: freePoint(to),
    steps: [],
  });

  it("offers pins and never Junctions, which are already wire ends", () => {
    const inRange = visibleTerminals(document).filter(
      (source) => source.connection.contactPoint.x < 500,
    );

    expect(
      wirePassThroughContacts(
        [...visibleTerminals(document), junction],
        across({ x: 0, y: 0 }, { x: 500, y: 500 }),
      ).map((source) => endpointKey(source.endpoint)),
    ).toEqual(inRange.map((source) => endpointKey(source.endpoint)));
  });

  it("drops pins the gesture cannot reach, which the planner would drop too", () => {
    // The narrowing is only sound because a contact off the drawn path is
    // never selected. Hold it against the planner's own answer over the
    // complete pin list: the same wire, the same contacts.
    const build = () => {
      const wide = createEmptyDocument("main", "Main");
      nmos(wide, "M1", { x: 200, y: 200 });
      nmos(wide, "M2", { x: 400, y: 200 });
      nmos(wide, "M3", { x: 600, y: 200 });
      nmos(wide, "Far", { x: 2000, y: 2000 });
      return wide;
    };
    const wide = build();
    const source = wireSource(wide, terminal("M1", "G"));
    const target: WireDraftTarget = {
      kind: "endpoint",
      point: resolveEndpointConnection(wide, resolver, terminal("M3", "G"))!
        .contactPoint,
      source: wireSource(wide, terminal("M3", "G")),
    };
    const narrowed = wirePassThroughContacts(visibleTerminals(wide), {
      from: source,
      to: target.source,
      steps: [],
    });

    expect(
      narrowed.some(
        (contact) =>
          contact.endpoint.kind === "terminal" &&
          contact.endpoint.instanceId === "Far",
      ),
    ).toBe(false);
    expect(previewFor(wide, source, target).contacts).toEqual([
      { x: 380, y: 200 },
    ]);
  });
});
