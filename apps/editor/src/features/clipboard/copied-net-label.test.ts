import { describe, expect, it } from "vitest";
import { createEmptyProject, createRoutePath } from "@icm/model";
import { resolveDocumentLogicalNets, resolveRouteGeometry } from "@icm/derived";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { netLabelPlacementTargetAtPoint } from "../wiring/route-interaction-geometry";
import {
  applyProjectCopyPlacement,
  captureProjectCopy,
  planProjectCopyPlacement,
} from "./project-copy";
import { standaloneCopiedNetLabel } from "./copied-net-label";

function fixture(scope: "local" | "global" = "local") {
  const project = createEmptyProject("label-copy", "Label copy");
  const document = project.documents[0]!;
  for (const [id, y] of [
    ["source", 100],
    ["target", 300],
  ] as const) {
    document.nets.push({ id, terminals: [] });
    document.junctions.push(
      {
        id: `${id}-a`,
        netId: id,
        position: { x: 100, y },
        role: "route-anchor",
      },
      {
        id: `${id}-b`,
        netId: id,
        position: { x: 300, y },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: `${id}-wire`,
        netId: id,
        start: { kind: "junction", junctionId: `${id}-a` },
        end: { kind: "junction", junctionId: `${id}-b` },
        bends: [],
        modes: ["manual"],
      }),
    );
  }
  document.annotations.push({
    id: "label",
    kind: "net-label",
    netId: "source",
    binding: { kind: "net-name", netId: "source" },
    anchor: { kind: "free", position: { x: 200, y: 80 } },
    alignment: "end",
    rotation: 0,
    locked: false,
    textColor: "#be123c",
    sizeScale: 1.25,
    formatOverride: {
      runs: [
        {
          kind: "span",
          style: "overbar",
          children: [
            { kind: "text", value: "IN" },
            {
              kind: "span",
              style: "subscript",
              children: [{ kind: "text", value: "1" }],
            },
          ],
        },
      ],
    },
  });
  document.connectivityEvidence.push({
    id: "label-name",
    kind: "name-claim",
    netId: "source",
    name: "IN_1_bar",
    scope,
    owner: { kind: "net-label", annotationId: "label" },
  });
  const clipboard = captureProjectCopy(project, document, {
    instanceIds: [],
    routeIds: [],
    junctionIds: [],
    draftingIds: [],
    annotationIds: ["label"],
  })!;
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const route = document.routes[1]!;
  const target = netLabelPlacementTargetAtPoint(
    [{ route, geometry: resolveRouteGeometry(document, resolver, route)! }],
    { x: 200, y: 294 },
    12,
  )!;
  return { project, document, clipboard, target };
}

describe("copied Net Label attachment", () => {
  it.each(["local", "global"] as const)(
    "names the destination wire with a %s claim and keeps the exact look",
    (scope) => {
      const { project, document, clipboard, target } = fixture(scope);
      const before = structuredClone(project);
      // The name it claims gives the text it stands over its new wire by.
      expect(standaloneCopiedNetLabel(clipboard)?.name).toBe("IN_1_bar");
      const plan = planProjectCopyPlacement(
        project,
        document,
        clipboard,
        { x: 0, y: 210 },
        1,
        target,
      );
      const result = applyProjectCopyPlacement(plan).documents[0]!;
      const id = plan.mapping.objects.annotations.label!;
      expect(result.annotations.find((item) => item.id === id)).toEqual({
        ...document.annotations[0],
        id,
        netId: "target",
        binding: { kind: "net-name", netId: "target" },
        anchor: {
          kind: "route",
          ...target.routeAttachment,
          orientation: "follow",
          fallbackPosition: target.labelPosition,
        },
      });
      expect(result.connectivityEvidence).toContainEqual({
        id: plan.mapping.objects.evidence["label-name"],
        kind: "name-claim",
        netId: "target",
        name: "IN_1_bar",
        scope,
        owner: { kind: "net-label", annotationId: id },
      });
      expect(plan.mapping.objects.nets.source).toBe("target");
      expect(result.nets.map((net) => net.id)).toEqual(["source", "target"]);
      expect(result.routes).toEqual(document.routes);
      expect(result.junctions).toEqual(document.junctions);
      expect(resolveDocumentLogicalNets(result).groups).toHaveLength(1);
      expect(resolveDocumentLogicalNets(result).groups[0]!.name).toBe(
        "IN_1_bar",
      );
      expect(project).toEqual(before);
    },
  );

  it("keeps a free label on an empty canvas in another Project", () => {
    const { clipboard } = fixture();
    const project = createEmptyProject("other", "Other");
    const document = project.documents[0]!;
    const plan = planProjectCopyPlacement(
      project,
      document,
      clipboard,
      { x: 40, y: 80 },
      1,
    );
    const result = applyProjectCopyPlacement(plan).documents[0]!;
    expect(result.annotations[0]).toMatchObject({
      anchor: { kind: "free", position: { x: 240, y: 160 } },
      textColor: "#be123c",
      sizeScale: 1.25,
      alignment: "end",
      formatOverride: clipboard.annotations[0]!.formatOverride,
    });
    expect(resolveDocumentLogicalNets(result).groups[0]!.name).toBe("IN_1_bar");
    expect(result.routes).toEqual([]);
  });

  it("attaches across Projects even when their source Net and annotation IDs coincide", () => {
    const { clipboard } = fixture();
    const { project, document, target } = fixture();
    project.id = "destination";
    const plan = planProjectCopyPlacement(
      project,
      document,
      clipboard,
      { x: 0, y: 210 },
      1,
      target,
    );
    const result = applyProjectCopyPlacement(plan).documents[0]!;
    expect(result.annotations.find((item) => item.id === "label")).toEqual(
      document.annotations[0],
    );
    expect(
      result.annotations.find(
        (item) => item.id === plan.mapping.objects.annotations.label,
      )!.netId,
    ).toBe("target");
    expect(result.nets).toHaveLength(2);
  });

  it("keeps a label copied with its wire on the copied Net", () => {
    const { project, document, target } = fixture();
    const clipboard = captureProjectCopy(project, document, {
      instanceIds: [],
      routeIds: ["source-wire"],
      junctionIds: [],
      draftingIds: [],
      annotationIds: ["label"],
    })!;
    expect(standaloneCopiedNetLabel(clipboard)).toBeNull();
    const plan = planProjectCopyPlacement(
      project,
      document,
      clipboard,
      { x: 0, y: 200 },
      1,
      target,
    );
    const result = applyProjectCopyPlacement(plan).documents[0]!;
    const label = result.annotations.find(
      (item) => item.id === plan.mapping.objects.annotations.label,
    )!;
    expect(label.netId).toBe(plan.mapping.objects.nets.source);
    expect(label.netId).not.toBe("target");
    expect(
      result.connectivityEvidence.some(
        (item) => item.kind === "name-claim" && item.netId === "target",
      ),
    ).toBe(false);
  });
});
