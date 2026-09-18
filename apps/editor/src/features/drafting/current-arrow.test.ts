import { resolveRouteAttachment, resolveRouteGeometry } from "@icm/derived";
import { executeTransaction, proposeGroupMoveEdits } from "@icm/edit-engine";
import { createEmptyDocument } from "@icm/model";
import { createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { copySelection, proposePaste } from "../clipboard/clipboard";

describe("route-attached current arrows", () => {
  const resolver = new InMemorySymbolResolver(builtInSymbols);

  it("copies a route-marker with its route VisualAnchor re-mapped on paste", () => {
    const document = createEmptyDocument("document-main", "Route marker");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 220, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-signal",

      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    document.routes.push(
      createRoutePath({
        id: "route-signal",
        netId: "net-signal",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
        end: { kind: "terminal", instanceId: "R2", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.annotations.push({
      id: "current-1",
      kind: "route-marker",
      markerKind: "current",
      content: { runs: [{ kind: "text", value: "I_x" }] },
      anchor: {
        kind: "route",
        routeId: "route-signal",
        legId: document.routes[0]!.legs[0]!.id,
        t: 0.5,
        normalOffset: -14,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 160, y: 100 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

    const copied = copySelection(document, ["R1", "R2"], [], {
      routeIds: ["route-signal"],
      junctionIds: [],
      annotationIds: [],
    });
    expect(copied?.annotations).toHaveLength(1);

    const proposal = proposePaste(document, copied!, { x: 20, y: 20 }, 1);
    const annotationEdit = proposal.edits.find(
      (edit) => edit.kind === "upsert_schematic_annotation",
    );
    expect(annotationEdit).toMatchObject({
      kind: "upsert_schematic_annotation",
      annotation: {
        id: "current-1-copy-1",
        kind: "route-marker",
        markerKind: "current",
        anchor: {
          routeId: "route-signal-copy-1",
          legId: proposal.idRemap.legs[document.routes[0]!.legs[0]!.id],
        },
      },
    });
  });

  it("keeps a copied current arrow on its horizontal leg after the copied circuit moves", () => {
    const document = createEmptyDocument("document-main", "Current arrow");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 220, y: 180 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-signal",

      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    document.routes.push(
      createRoutePath({
        id: "route-signal",
        netId: "net-signal",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
        end: { kind: "terminal", instanceId: "R2", pinName: "1" },
        bends: [{ x: 220, y: 120 }],
        modes: ["manual", "manual"],
      }),
    );
    document.annotations.push({
      id: "current-1",
      kind: "route-marker",
      markerKind: "current",
      content: { runs: [{ kind: "text", value: "I_x" }] },
      anchor: {
        kind: "route",
        routeId: "route-signal",
        legId: document.routes[0]!.legs[0]!.id,
        t: 0.5,
        normalOffset: -14,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 160, y: 120 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

    const copied = copySelection(document, ["R1", "R2"], [], {
      routeIds: ["route-signal"],
      junctionIds: [],
      annotationIds: [],
    });
    expect(copied?.annotations).toHaveLength(1);

    const proposal = proposePaste(document, copied!, { x: 20, y: 20 }, 1);
    const pasted = executeTransaction(
      document,
      {
        transactionId: "paste-current-arrow",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;

    const copiedInstanceIds = ["R1", "R2"].map(
      (id) => proposal.idRemap.instances[id]!,
    );
    const moves = copiedInstanceIds.map((instanceId) => {
      const instance = pasted.document.instances.find(
        (candidate) => candidate.id === instanceId,
      )!;
      return {
        instanceId,
        position: {
          x: instance.placement!.position.x + 40,
          y: instance.placement!.position.y + 20,
        },
      };
    });
    const movePlan = proposeGroupMoveEdits(
      pasted.document,
      resolver,
      moves,
      [],
      { x: 40, y: 20 },
    );
    const moved = executeTransaction(
      pasted.document,
      {
        transactionId: "move-copied-current-arrow",
        documentId: document.id,
        expectedRevision: pasted.document.revision,
        actor: { kind: "human", id: "test" },
        edits: movePlan.edits,
      },
      { symbolResolver: resolver },
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    const copiedMarker = moved.document.annotations.find(
      (annotation) =>
        annotation.id === proposal.idRemap.annotations["current-1"],
    )!;
    expect(copiedMarker.anchor.kind).toBe("route");
    if (copiedMarker.anchor.kind !== "route") return;
    const copiedAnchor = copiedMarker.anchor;
    const copiedRoute = moved.document.routes.find(
      (route) => route.id === copiedAnchor.routeId,
    )!;
    expect(copiedAnchor).toMatchObject({
      kind: "route",
      routeId: copiedRoute.id,
      direction: "forward",
    });
    expect(copiedRoute.legs.map((leg) => leg.id)).toContain(copiedAnchor.legId);
    const geometry = resolveRouteGeometry(
      moved.document,
      resolver,
      copiedRoute,
    )!;
    expect(resolveRouteAttachment(geometry, copiedAnchor)?.rotation).toBe(0);
  });
});
