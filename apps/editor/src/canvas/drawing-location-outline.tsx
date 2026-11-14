import { useMemo } from "react";
import {
  resolveDraftingObjectGeometry,
  type ResolvedDrawingScene,
  type SchematicStyleProfile,
} from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import { renderInstanceOutlineGeometry } from "@icm/render-svg";
import type { SymbolResolver } from "@icm/symbols";
import { serializePolylinePoints } from "./canvas-geometry";

interface DrawingLocationOutlineProps {
  document: SchematicDocument;
  resolver: SymbolResolver;
  styleProfile: SchematicStyleProfile;
  scene: ResolvedDrawingScene;
  selectedInstanceIds: readonly string[];
  selectedDraftingIds: readonly string[];
  locatedInstanceId?: string | undefined;
}

/** An explicit locator stays readable in front of the formal drawing. */
export function DrawingLocationOutline({
  document,
  resolver,
  styleProfile,
  scene,
  selectedInstanceIds,
  selectedDraftingIds,
  locatedInstanceId,
}: DrawingLocationOutlineProps) {
  const instanceOutline = useMemo(() => {
    if (!locatedInstanceId && !scene.hasOcclusion) return "";
    const selected = new Set(selectedInstanceIds);
    const ids: string[] = [];
    for (const { id, placement } of document.instances) {
      if (!placement || !selected.has(id)) continue;
      if (
        id === locatedInstanceId ||
        !scene.isVisibleAt({ kind: "instance", id }, placement.position)
      )
        ids.push(id);
    }
    return ids.length
      ? renderInstanceOutlineGeometry(document, resolver, ids, styleProfile)
      : "";
  }, [
    document,
    resolver,
    styleProfile,
    scene,
    selectedInstanceIds,
    locatedInstanceId,
  ]);
  const draftingOutlines = useMemo(() => {
    if (!selectedDraftingIds.length) return [];
    const selected = new Set(selectedDraftingIds);
    return (document.drafting?.objects ?? []).flatMap((object) => {
      if (
        !selected.has(object.id) ||
        (object.kind !== "rectangle" && object.kind !== "circle")
      )
        return [];
      const geometry = resolveDraftingObjectGeometry(
        document,
        resolver,
        object,
      );
      if (geometry.kind === "rectangle")
        return [
          <polygon
            key={object.id}
            data-drafting-id={object.id}
            points={serializePolylinePoints(geometry.corners)}
          />,
        ];
      if (geometry.kind === "circle")
        return [
          <circle
            key={object.id}
            data-drafting-id={object.id}
            cx={geometry.center.x}
            cy={geometry.center.y}
            r={geometry.radius}
          />,
        ];
      return [];
    });
  }, [document, resolver, selectedDraftingIds]);
  if (!instanceOutline && !draftingOutlines.length) return null;
  return (
    <g
      aria-hidden="true"
      className="drawing-location-outline"
      data-testid="layer-location-outlines"
      pointerEvents="none"
    >
      {instanceOutline && (
        <g dangerouslySetInnerHTML={{ __html: instanceOutline }} />
      )}
      {draftingOutlines}
    </g>
  );
}
