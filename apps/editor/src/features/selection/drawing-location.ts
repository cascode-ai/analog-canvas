import {
  resolveAnnotationPresentation,
  resolveDraftingObjectGeometry,
  type ResolvedDocumentLogicalNets,
  type ResolvedDocumentRoutingGeometry,
  type SchematicStyleProfile,
} from "@icm/derived";
import type { DrawingObjectEntry, Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { centerOfBounds } from "../../canvas/canvas-geometry";

export interface DrawingInstanceLocation {
  scope: string;
  id: string;
}

export interface DrawingLocationContext {
  document: SchematicDocument;
  resolver: SymbolResolver;
  styleProfile: SchematicStyleProfile;
  routingGeometry?: ResolvedDocumentRoutingGeometry | undefined;
  logicalNets?: ResolvedDocumentLogicalNets | undefined;
}

export function drawingLocationPoint(
  entry: DrawingObjectEntry,
  {
    document,
    resolver,
    styleProfile,
    routingGeometry,
    logicalNets,
  }: DrawingLocationContext,
): Point | undefined {
  switch (entry.kind) {
    case "instance":
      return document.instances.find(({ id }) => id === entry.id)?.placement
        ?.position;
    case "annotation": {
      const annotation = document.annotations.find(({ id }) => id === entry.id);
      if (!annotation) return undefined;
      return centerOfBounds(
        resolveAnnotationPresentation(
          document,
          resolver,
          annotation,
          styleProfile,
          routingGeometry,
          logicalNets,
        ).inkBounds,
      );
    }
    case "drafting": {
      const object = document.drafting?.objects.find(
        ({ id }) => id === entry.id,
      );
      if (!object) return undefined;
      return centerOfBounds(
        resolveDraftingObjectGeometry(
          document,
          resolver,
          object,
          routingGeometry,
        ).bounds,
      );
    }
  }
}
