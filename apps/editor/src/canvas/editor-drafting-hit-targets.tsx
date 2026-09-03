import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import {
  arrowArtwork,
  resolveDocumentStyleProfile,
  resolveDraftingObjectGeometry,
} from "@icm/derived";
import type {
  DraftingObject,
  LayoutGroup,
  Rect,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  draftingDragOrigin,
  type DraftingHandle,
} from "../features/drafting/drafting-manipulation";
import { draftingGroupBounds } from "../features/drafting/drafting-group-scale";
import {
  draftingPathData,
  quadraticMidpoint,
} from "../features/drafting/drafting-path";
import type { EditorTool } from "../interaction/interaction-state";
import { serializePolylinePoints } from "./canvas-geometry";

export function EditorDraftingHitTargets({
  document,
  resolver,
  tool,
  selectedDraftingId,
  supplementalDraftingIds,
  onPointerDown,
  onConstructionLineEdit,
  onArrowEdit,
  onTextEdit,
  onTextContextMenu,
}: {
  document: SchematicDocument;
  resolver: SymbolResolver;
  tool: EditorTool;
  selectedDraftingId: string | null;
  supplementalDraftingIds: readonly string[];
  onPointerDown: (
    event: ReactPointerEvent<SVGElement>,
    object: DraftingObject,
    draggable: boolean,
  ) => void;
  onConstructionLineEdit: (
    event: ReactMouseEvent<SVGElement>,
    object: Extract<DraftingObject, { kind: "construction-line" }>,
  ) => void;
  onArrowEdit: (
    event: ReactMouseEvent<SVGElement>,
    object: Extract<DraftingObject, { kind: "arrow" }>,
  ) => void;
  onTextEdit: (object: Extract<DraftingObject, { kind: "text" }>) => void;
  onTextContextMenu: (
    object: Extract<DraftingObject, { kind: "text" }>,
    clientX: number,
    clientY: number,
  ) => void;
}) {
  return (document.drafting?.objects ?? []).map((object) => {
    const geometry = resolveDraftingObjectGeometry(document, resolver, object);
    const draggable = !object.locked && Boolean(draftingDragOrigin(object));
    const selected =
      selectedDraftingId === object.id ||
      supplementalDraftingIds.includes(object.id);
    const selectedClass = selected
      ? "annotation-hit selected"
      : "annotation-hit";
    const textClass = selected
      ? "hit-target annotation-text-hit selected"
      : "hit-target annotation-text-hit";
    const common = {
      "data-testid": `drafting-hit-${object.id}`,
      "data-canvas-hit-kind": "drafting",
      "data-canvas-hit-id": object.id,
      "data-drag-object-id": object.id,
      onPointerDown: (event: ReactPointerEvent<SVGElement>) =>
        onPointerDown(event, object, draggable),
      ...(object.kind === "text"
        ? {
            onContextMenu: (event: ReactMouseEvent<SVGElement>) => {
              event.preventDefault();
              event.stopPropagation();
              onTextContextMenu(object, event.clientX, event.clientY);
            },
          }
        : {}),
      pointerEvents: tool === "wire" ? ("none" as const) : undefined,
    };
    if (
      object.kind === "construction-line" &&
      geometry.kind === "construction-line"
    ) {
      const doubleClick = (event: ReactMouseEvent<SVGElement>) =>
        onConstructionLineEdit(event, object);
      return geometry.curveControls.some(Boolean) ? (
        <path
          key={object.id}
          {...common}
          className={selectedClass}
          fill="none"
          d={draftingPathData(geometry.points, geometry.curveControls)}
          onDoubleClick={doubleClick}
        />
      ) : (
        <polyline
          key={object.id}
          {...common}
          className={selectedClass}
          fill="none"
          points={object.points
            .map((point) => `${point.x},${point.y}`)
            .join(" ")}
          onDoubleClick={doubleClick}
        />
      );
    }
    if (object.kind === "arrow" && geometry.kind === "arrow") {
      const art = arrowArtwork(
        object,
        geometry.points,
        geometry.curveControls,
        resolveDocumentStyleProfile(document.presentation),
      );
      if (art.outline)
        return (
          <polygon
            key={object.id}
            {...common}
            className={`${selectedClass} drafting-outline-arrow-hit`}
            points={serializePolylinePoints(art.outline)}
            fill="none"
          />
        );
      const doubleClick = (event: ReactMouseEvent<SVGElement>) =>
        onArrowEdit(event, object);
      const { "data-testid": _testId, ...headCommon } = common;
      return (
        <g key={object.id}>
          {geometry.curveControls.some(Boolean) ? (
            <path
              key={object.id}
              {...common}
              className={selectedClass}
              fill="none"
              d={draftingPathData(geometry.points, geometry.curveControls)}
              onDoubleClick={doubleClick}
            />
          ) : (
            <polyline
              key={object.id}
              {...common}
              className={selectedClass}
              fill="none"
              points={geometry.points
                .map((point) => `${point.x},${point.y}`)
                .join(" ")}
              onDoubleClick={doubleClick}
            />
          )}
          {art.heads.map((head, index) => (
            <polygon
              key={`head-${index}`}
              {...headCommon}
              className={selectedClass}
              points={serializePolylinePoints(head)}
              fill="transparent"
              pointerEvents={tool === "wire" ? "none" : "all"}
              onDoubleClick={doubleClick}
            />
          ))}
        </g>
      );
    }
    if (object.kind === "rectangle" && geometry.kind === "rectangle") {
      return (
        <polygon
          key={object.id}
          {...common}
          className={`${selectedClass} drafting-rectangle-hit`}
          points={serializePolylinePoints(geometry.corners)}
          fill="none"
        />
      );
    }
    if (object.kind === "circle" && geometry.kind === "circle") {
      return (
        <circle
          key={object.id}
          {...common}
          className={`${selectedClass} drafting-circle-hit`}
          cx={geometry.center.x}
          cy={geometry.center.y}
          r={geometry.radius}
          fill="none"
        />
      );
    }
    if (object.kind === "leader" && geometry.kind === "leader") {
      return (
        <line
          key={object.id}
          {...common}
          className={selectedClass}
          x1={geometry.anchor.x}
          y1={geometry.anchor.y}
          x2={geometry.target.x}
          y2={geometry.target.y}
        />
      );
    }
    if (object.kind === "callout" && geometry.kind === "callout") {
      return (
        <g key={object.id} {...common}>
          <line
            className={selectedClass}
            x1={geometry.textPosition.x}
            y1={geometry.textPosition.y}
            x2={geometry.target.x}
            y2={geometry.target.y}
          />
          <rect className={selectedClass} {...geometry.textBounds} />
        </g>
      );
    }
    return (
      <rect
        key={object.id}
        {...common}
        className={object.kind === "text" ? textClass : selectedClass}
        {...geometry.bounds}
        onDoubleClick={(event) => {
          if (object.kind !== "text") return;
          event.stopPropagation();
          onTextEdit(object);
        }}
      />
    );
  });
}

export function EditorDraftingHandles({
  document,
  resolver,
  selectedDraftingId,
  selectedDraftingIds,
  onHandlePointerDown,
  onGroupScalePointerDown,
  onDeleteVertex,
}: {
  document: SchematicDocument;
  resolver: SymbolResolver;
  selectedDraftingId: string | null;
  selectedDraftingIds: readonly string[];
  onHandlePointerDown: (
    event: ReactPointerEvent<SVGElement>,
    object: DraftingObject,
    handle: DraftingHandle,
  ) => void;
  onGroupScalePointerDown: (
    event: ReactPointerEvent<SVGElement>,
    group: LayoutGroup,
    bounds: Rect,
  ) => void;
  onDeleteVertex: (
    object: Extract<DraftingObject, { kind: "construction-line" }>,
    index: number,
  ) => void;
}) {
  const selectedIds = new Set(selectedDraftingIds);
  const selectedGroup = document.layoutGroups.find(
    (group) =>
      group.id.startsWith("waveform-group-") &&
      group.objectIds.length > 1 &&
      selectedDraftingId !== null &&
      group.objectIds.includes(selectedDraftingId) &&
      group.objectIds.every((objectId) => selectedIds.has(objectId)),
  );
  if (selectedGroup) {
    const bounds = draftingGroupBounds(
      document,
      resolver,
      selectedGroup.objectIds,
    );
    if (!bounds) return null;
    const handle = {
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
    };
    return (
      <g data-testid={`drafting-group-handles-${selectedGroup.id}`}>
        <rect
          className="draft-group-bounds"
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
        />
        <rect
          className="draft-handle draft-group-scale-handle"
          data-testid={`draft-group-scale-${selectedGroup.id}`}
          aria-label="Scale waveform"
          x={handle.x - 5}
          y={handle.y - 5}
          width="10"
          height="10"
          onPointerDown={(event) =>
            onGroupScalePointerDown(event, selectedGroup, bounds)
          }
        />
      </g>
    );
  }
  const object = document.drafting?.objects.find(
    (candidate) => candidate.id === selectedDraftingId,
  );
  if (!object || object.locked) return null;
  const geometry = resolveDraftingObjectGeometry(document, resolver, object);
  const circle = (
    point: { x: number; y: number },
    testId: string,
    handle: DraftingHandle,
  ) => (
    <circle
      key={testId}
      className="draft-handle"
      data-testid={testId}
      cx={point.x}
      cy={point.y}
      r="5"
      onPointerDown={(event) => onHandlePointerDown(event, object, handle)}
    />
  );
  const curve = (
    from: { x: number; y: number },
    control: { x: number; y: number } | null,
    to: { x: number; y: number },
    index: number,
  ) => {
    const point = quadraticMidpoint(from, control, to);
    return (
      <rect
        key={`curve-${index}`}
        className="draft-handle draft-midpoint-handle"
        data-testid={`draft-handle-segment-${index}-${object.id}`}
        x={point.x - 3}
        y={point.y - 3}
        width="6"
        height="6"
        transform={`rotate(45 ${point.x} ${point.y})`}
        onPointerDown={(event) =>
          onHandlePointerDown(event, object, { kind: "curve", index })
        }
      />
    );
  };
  if (object.kind === "arrow" && geometry.kind === "arrow") {
    const dx = geometry.to.x - geometry.from.x,
      dy = geometry.to.y - geometry.from.y;
    const length = Math.hypot(dx, dy) || 1;
    const offset = object.outline ? object.outline.width / 2 + 18 : 25;
    const rotationHandle = {
      x: geometry.center.x + (dy / length) * offset,
      y: geometry.center.y - (dx / length) * offset,
    };
    const widthHandle = {
      x: geometry.center.x - ((dy / length) * (object.outline?.width ?? 0)) / 2,
      y: geometry.center.y + ((dx / length) * (object.outline?.width ?? 0)) / 2,
    };
    return (
      <g data-testid={`drafting-handles-${object.id}`}>
        {object.from.kind === "free" && object.to.kind === "free" ? (
          <>
            <line
              className="draft-rotation-stem"
              x1={geometry.center.x}
              y1={geometry.center.y}
              x2={rotationHandle.x}
              y2={rotationHandle.y}
              pointerEvents="none"
            />
            {circle(rotationHandle, `draft-handle-rotate-${object.id}`, {
              kind: "rotate",
            })}
          </>
        ) : null}
        {object.outline
          ? circle(widthHandle, `draft-handle-width-${object.id}`, {
              kind: "outline-width",
            })
          : null}
        {circle(geometry.from, `draft-handle-from-${object.id}`, {
          kind: "from",
        })}
        {geometry.points.slice(1, -1).map((point, index) =>
          circle(point, `draft-handle-waypoint-${index}-${object.id}`, {
            kind: "waypoint",
            index,
          }),
        )}
        {!object.outline &&
          geometry.points
            .slice(0, -1)
            .map((point, index) =>
              curve(
                point,
                geometry.curveControls[index] ?? null,
                geometry.points[index + 1]!,
                index,
              ),
            )}
        {circle(geometry.to, `draft-handle-to-${object.id}`, { kind: "to" })}
      </g>
    );
  }
  if (
    object.kind === "construction-line" &&
    geometry.kind === "construction-line"
  ) {
    return (
      <g data-testid={`drafting-handles-${object.id}`}>
        {geometry.vertices.map((vertex, index) => (
          <circle
            key={`vertex-${index}`}
            className="draft-handle"
            data-testid={`draft-handle-vx-${index}-${object.id}`}
            cx={vertex.x}
            cy={vertex.y}
            r="5"
            onPointerDown={(event) =>
              onHandlePointerDown(event, object, { kind: "vertex", index })
            }
            onDoubleClick={(event) => {
              event.stopPropagation();
              onDeleteVertex(object, index);
            }}
          />
        ))}
        {geometry.vertices
          .slice(0, -1)
          .map((vertex, index) =>
            curve(
              vertex,
              geometry.curveControls[index] ?? null,
              geometry.vertices[index + 1]!,
              index,
            ),
          )}
      </g>
    );
  }
  if (object.kind === "rectangle" && geometry.kind === "rectangle") {
    return (
      <g data-testid={`drafting-handles-${object.id}`}>
        {geometry.corners.map((corner, index) => (
          <rect
            key={`corner-${index}`}
            className="draft-handle"
            data-testid={`draft-handle-corner-${index}-${object.id}`}
            x={corner.x - 4}
            y={corner.y - 4}
            width="8"
            height="8"
            onPointerDown={(event) =>
              onHandlePointerDown(event, object, {
                kind: "rectangle-corner",
                index,
              })
            }
          />
        ))}
      </g>
    );
  }
  if (object.kind === "circle" && geometry.kind === "circle") {
    const point = {
      x: geometry.center.x + geometry.radius,
      y: geometry.center.y,
    };
    return (
      <g data-testid={`drafting-handles-${object.id}`}>
        <circle
          className="draft-handle"
          data-testid={`draft-handle-radius-${object.id}`}
          cx={point.x}
          cy={point.y}
          r="5"
          onPointerDown={(event) =>
            onHandlePointerDown(event, object, {
              kind: "circle-radius",
              index: 0,
            })
          }
        />
      </g>
    );
  }
  return null;
}
