import { flattenRichText, transformPoint } from "@icm/model";
import type {
  DrawingObjectEntry,
  DraftingObject,
  Point,
  Rect,
  SchematicDocument,
  SymbolPrimitive,
} from "@icm/model";
import {
  adaptiveSignalFlowSignalLeads,
  adaptiveSignalFlowSupplyLeads,
  drawnAdaptiveBodyParts,
  resolveAdaptiveSignalFlowBlockLayout,
  resolveInstanceSymbol,
  screenUprightPrimitive,
  uprightMarkPivots,
  type SymbolResolver,
} from "@icm/symbols";

import { arrowArtwork } from "./arrow-artwork.js";
import { resolveDraftingObjectGeometry } from "./drafting-geometry.js";
import {
  adaptiveFrameRegion,
  closedSymbolPathInk,
  type DrawingInkEvidence,
  type ResolvedDrawingScene,
} from "./drawing-scene.js";
import { rectangleCorners } from "./filled-region-evidence.js";
import type { ResolvedDocumentRoutingGeometry } from "./resolved-route-geometry.js";
import {
  objectStyleProfile,
  type SchematicStyleProfile,
} from "./style-profile.js";
import type { VisualDiagnostic } from "./visual.js";

function rectCenter({ x, y, width, height }: Rect): Point {
  return { x: x + width / 2, y: y + height / 2 };
}

type MutableInkEvidence = {
  points: Point[];
  segments: { from: Point; to: Point }[];
};

function addPathEvidence(
  evidence: MutableInkEvidence,
  points: readonly Point[],
  controls: readonly (Point | null)[] = [],
): void {
  let from = points[0];
  for (const [index, to] of points.slice(1).entries()) {
    if (!from) break;
    const control = controls[index];
    if (control) {
      evidence.points.push(
        from,
        {
          x: (from.x + 2 * control.x + to.x) / 4,
          y: (from.y + 2 * control.y + to.y) / 4,
        },
        to,
      );
    } else {
      evidence.segments.push({ from, to });
    }
    from = to;
  }
}

function closedPath(points: readonly Point[]): readonly Point[] {
  const first = points[0];
  return first ? [...points, first] : points;
}

function circleSamples(center: Point, radius: number): Point[] {
  return [
    { x: center.x - radius, y: center.y },
    { x: center.x + radius, y: center.y },
    { x: center.x, y: center.y - radius },
    { x: center.x, y: center.y + radius },
  ];
}

function addSymbolPrimitiveEvidence(
  evidence: MutableInkEvidence,
  primitive: SymbolPrimitive,
): void {
  switch (primitive.kind) {
    case "line":
      evidence.segments.push({ from: primitive.from, to: primitive.to });
      break;
    case "polyline":
      addPathEvidence(evidence, primitive.points);
      break;
    case "polygon":
      if (primitive.stroke !== "none" || primitive.fill === "foreground")
        addPathEvidence(evidence, closedPath(primitive.points));
      break;
    case "circle":
      if (primitive.stroke !== "none" || primitive.fill === "foreground")
        evidence.points.push(
          ...circleSamples(primitive.center, primitive.radius),
        );
      break;
    case "rectangle":
      if (primitive.stroke !== "none" || primitive.fill === "foreground")
        addPathEvidence(
          evidence,
          closedPath(rectangleCorners(primitive.bounds)),
        );
      break;
    case "path": {
      const path = closedSymbolPathInk(primitive);
      if (!path) break;
      for (const point of path.points) evidence.points.push(point);
      for (const segment of path.segments) evidence.segments.push(segment);
      break;
    }
  }
}

function symbolInkEvidence(
  instance: SchematicDocument["instances"][number],
  resolver: SymbolResolver,
): DrawingInkEvidence {
  const placement = instance.placement;
  if (!placement) return {};
  const symbol = resolveInstanceSymbol(resolver, instance);
  if (!symbol) return {};
  const { definition, variant } = symbol;
  const { hiddenPrimitiveParts, additionalPrimitives } = variant ?? {};
  const adaptive = resolveAdaptiveSignalFlowBlockLayout(
    definition,
    instance.signalFlowParameters,
  );
  const evidence: MutableInkEvidence = { points: [], segments: [] };
  if (adaptive) {
    const parts = drawnAdaptiveBodyParts(
      definition,
      hiddenPrimitiveParts,
      additionalPrimitives,
    );
    if (parts.frameVisible) {
      const frame = adaptiveFrameRegion(adaptive);
      if (frame.kind === "polygon")
        addPathEvidence(evidence, closedPath(frame.points));
      else if (frame.kind === "rectangle")
        addPathEvidence(evidence, closedPath(rectangleCorners(frame.bounds)));
    }
    for (const primitive of parts.extraBodies)
      addSymbolPrimitiveEvidence(evidence, primitive);
    const { input, output } = adaptiveSignalFlowSignalLeads(
      definition,
      adaptive,
      hiddenPrimitiveParts,
    );
    if (input) evidence.segments.push(input);
    if (output) evidence.segments.push(output);
    evidence.segments.push(
      ...adaptiveSignalFlowSupplyLeads(
        definition,
        adaptive,
        hiddenPrimitiveParts,
      ),
    );
  } else {
    const hidden = new Set(hiddenPrimitiveParts);
    const primitives = [
      ...definition.primitives,
      ...(additionalPrimitives ?? []),
    ].filter(({ part }) => !part || !hidden.has(part));
    const pivots = uprightMarkPivots(primitives);
    for (const primitive of primitives) {
      addSymbolPrimitiveEvidence(
        evidence,
        screenUprightPrimitive(
          primitive,
          placement,
          primitive.part ? pivots.get(primitive.part) : undefined,
        ),
      );
    }
  }
  const transform = (point: Point) =>
    transformPoint(point, placement.position, placement);
  return {
    points: evidence.points.map(transform),
    segments: evidence.segments.map(({ from, to }) => ({
      from: transform(from),
      to: transform(to),
    })),
  };
}

function draftingInkEvidence(
  document: SchematicDocument,
  resolver: SymbolResolver,
  object: DraftingObject,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  styleProfile: SchematicStyleProfile,
): DrawingInkEvidence {
  const geometry = resolveDraftingObjectGeometry(
    document,
    resolver,
    object,
    routingGeometry,
  );
  const evidence: MutableInkEvidence = { points: [], segments: [] };
  switch (geometry.kind) {
    case "arrow": {
      if (object.kind !== "arrow") return {};
      const art = arrowArtwork(
        object,
        geometry.points,
        geometry.curveControls,
        objectStyleProfile(styleProfile, object),
      );
      if (art.outline) addPathEvidence(evidence, closedPath(art.outline));
      else addPathEvidence(evidence, art.shaft, art.controls);
      for (const { points, style } of art.heads)
        addPathEvidence(
          evidence,
          style === "open" ? points : closedPath(points),
        );
      for (const { center, radius } of art.dots)
        evidence.points.push(center, ...circleSamples(center, radius));
      return evidence;
    }
    case "construction-line":
      addPathEvidence(evidence, geometry.points, geometry.curveControls);
      return evidence;
    case "rectangle":
      addPathEvidence(evidence, closedPath(geometry.corners));
      return evidence;
    case "circle":
      return { points: circleSamples(geometry.center, geometry.radius) };
    case "leader":
      return { segments: [{ from: geometry.anchor, to: geometry.target }] };
    case "callout":
      return {
        points: [rectCenter(geometry.textBounds)],
        segments: [{ from: geometry.textPosition, to: geometry.target }],
      };
    case "text":
      return object.kind === "text" &&
        (object.polarity || flattenRichText(object.content).trim())
        ? {
            points: [rectCenter(geometry.bounds)],
            segments: geometry.polarityLines,
          }
        : {};
    case "floating-symbol":
      return {};
  }
}

export function drawingOcclusionFindings(
  document: SchematicDocument,
  resolver: SymbolResolver,
  scene: ResolvedDrawingScene,
  styleProfile: SchematicStyleProfile,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  annotationBounds: readonly { id: string; name: string; bounds: Rect }[],
  instanceName: (id: string) => string,
): VisualDiagnostic[] {
  if (!scene.hasOcclusion) return [];
  const diagnostics: VisualDiagnostic[] = [];
  const drafting = document.drafting?.objects ?? [];
  const draftingById = new Map(drafting.map((object) => [object.id, object]));
  const annotationNames = new Map(
    annotationBounds.map(({ id, name }) => [id, name]),
  );
  const nameOf = (entry: DrawingObjectEntry): string => {
    if (entry.kind === "instance") return instanceName(entry.id);
    if (entry.kind === "annotation")
      return annotationNames.get(entry.id) ?? entry.id;
    const object = draftingById.get(entry.id);
    if (object?.kind === "text" || object?.kind === "callout")
      return flattenRichText(object.content).trim() || object.id;
    return (object?.kind ?? "drawing") + " " + entry.id;
  };
  const report = (
    target: {
      kind: DrawingObjectEntry["kind"] | "route";
      id: string;
      label: string;
    },
    covered: ReturnType<ResolvedDrawingScene["occlusionOf"]>,
  ): void => {
    if (!covered) return;
    diagnostics.push({
      code: "VISUAL_DRAWING_OCCLUSION",
      severity: "info",
      category: "observation",
      confidence: "medium",
      gateEligible: false,
      message: `${nameOf(covered.front)} covers part of ${target.label}`,
      objectIds: [target.id, covered.front.id],
      point: covered.point,
      parameters: {
        coveredObjectKind: target.kind,
        coveredObjectId: target.id,
        ...(target.kind === "drafting" ? { drawingTargetId: target.id } : {}),
      },
    });
  };
  for (const annotation of annotationBounds) {
    const entry = { kind: "annotation", id: annotation.id } as const;
    report(
      { ...entry, label: annotation.name },
      scene.occlusionOf(entry, { points: [rectCenter(annotation.bounds)] }),
    );
  }
  for (const object of drafting) {
    const entry = { kind: "drafting", id: object.id } as const;
    report(
      { ...entry, label: nameOf(entry) },
      scene.occlusionOf(
        entry,
        draftingInkEvidence(
          document,
          resolver,
          object,
          routingGeometry,
          styleProfile,
        ),
      ),
    );
  }
  for (const instance of document.instances) {
    const entry = { kind: "instance", id: instance.id } as const;
    report(
      { ...entry, label: nameOf(entry) },
      scene.occlusionOf(entry, symbolInkEvidence(instance, resolver)),
    );
  }
  for (const route of routingGeometry.routes.values()) {
    report(
      { kind: "route", id: route.routeId, label: "route " + route.routeId },
      scene.occlusionOf({ kind: "electrical" }, { segments: route.segments }),
    );
  }
  return diagnostics;
}
