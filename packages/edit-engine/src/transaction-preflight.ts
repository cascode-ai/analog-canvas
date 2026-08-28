import type { DraftingObject, Point, VisualAnchor } from "@icm/model";
import { z } from "zod";

import type { SchematicEdit } from "./edit-schema.js";
import type { EditDiagnostic } from "./transaction-result.js";

export function schemaDiagnostics(
  error: z.ZodError,
  code: string,
): EditDiagnostic[] {
  return error.issues.map((issue) => ({
    code,
    severity: "error" as const,
    message: issue.message,
    path: issue.path.map((segment) =>
      typeof segment === "symbol" ? (segment.description ?? "symbol") : segment,
    ),
  }));
}

type LocatedPoint = {
  point: Point;
  path: ReadonlyArray<string | number>;
};

function anchorPoints(
  anchor: VisualAnchor,
  path: ReadonlyArray<string | number>,
): LocatedPoint[] {
  switch (anchor.kind) {
    case "free":
      return [{ point: anchor.position, path: [...path, "position"] }];
    case "object":
      return [
        { point: anchor.localOffset, path: [...path, "localOffset"] },
        { point: anchor.fallbackPosition, path: [...path, "fallbackPosition"] },
      ];
    case "route":
      return [
        { point: anchor.fallbackPosition, path: [...path, "fallbackPosition"] },
      ];
  }
}

function draftingPoints(object: DraftingObject): LocatedPoint[] {
  const points = anchorPoints(object.anchor, ["object", "anchor"]);
  switch (object.kind) {
    case "text":
    case "floating-symbol":
      return points;
    case "leader":
    case "callout":
      return [...points, ...anchorPoints(object.target, ["object", "target"])];
    case "arrow":
      return [
        ...points,
        ...anchorPoints(object.from, ["object", "from"]),
        ...anchorPoints(object.to, ["object", "to"]),
        ...(object.waypoints ?? []).map((point, index) => ({
          point,
          path: ["object", "waypoints", index],
        })),
        ...(object.curveControls ?? []).flatMap((point, index) =>
          point ? [{ point, path: ["object", "curveControls", index] }] : [],
        ),
      ];
    case "construction-line":
      return [
        ...points,
        ...object.points.map((point, index) => ({
          point,
          path: ["object", "points", index],
        })),
        ...(object.curveControls ?? []).flatMap((point, index) =>
          point ? [{ point, path: ["object", "curveControls", index] }] : [],
        ),
      ];
    case "rectangle":
      return [...points, { point: object.center, path: ["object", "center"] }];
    case "circle":
      return [...points, { point: object.center, path: ["object", "center"] }];
  }
}

/** Extract only persisted Document-page coordinates from an Edit. */
export function gridPointsOfEdit(edit: SchematicEdit): LocatedPoint[] {
  switch (edit.kind) {
    case "add_instance":
      return edit.instance.placement
        ? [
            {
              point: edit.instance.placement.position,
              path: ["instance", "placement", "position"],
            },
          ]
        : [];
    case "place_instance":
      return [
        { point: edit.placement.position, path: ["placement", "position"] },
      ];
    case "move_instance":
    case "move_junction":
      return [{ point: edit.position, path: ["position"] }];
    case "set_route_path":
      return edit.route.legs.flatMap((leg, index) =>
        leg.to.kind === "bend"
          ? [
              {
                point: leg.to.position,
                path: ["route", "legs", index, "to", "position"],
              },
            ]
          : [],
      );
    case "add_junction":
      return [{ point: edit.position, path: ["position"] }];
    case "attach_endpoint_to_route":
      return [{ point: edit.point, path: ["point"] }];
    case "add_power_rail":
      return [
        { point: edit.start, path: ["start"] },
        { point: edit.end, path: ["end"] },
      ];
    case "upsert_schematic_annotation":
      return anchorPoints(edit.annotation.anchor, ["annotation", "anchor"]);
    case "upsert_drafting_object":
      return draftingPoints(edit.object);
    default:
      return [];
  }
}

export function gridAlignmentDiagnostics(
  edit: SchematicEdit,
  grid: number,
): EditDiagnostic[] {
  // Annotations and drafting objects position at 1-unit precision (schema
  // 29); the Document grid remains the hard contract for electrical edits so
  // pins, wires, and junctions always coincide.
  const pitch =
    edit.kind === "upsert_schematic_annotation" ||
    edit.kind === "upsert_drafting_object"
      ? 1
      : grid;
  return gridPointsOfEdit(edit).flatMap(({ point, path }) =>
    (["x", "y"] as const).flatMap((axis) =>
      point[axis] % pitch === 0
        ? []
        : [
            {
              code: "GRID_ALIGNMENT",
              severity: "error" as const,
              message: `Document page coordinates must align to grid ${pitch}`,
              path: [...path, axis],
            },
          ],
    ),
  );
}

export function snapPointToDocumentGrid(point: Point, grid: number): Point {
  return {
    x: Math.round(point.x / grid) * grid,
    y: Math.round(point.y / grid) * grid,
  };
}

export function isHistoryEdit(
  edit: SchematicEdit,
): edit is Extract<SchematicEdit, { kind: "undo" | "redo" }> {
  return edit.kind === "undo" || edit.kind === "redo";
}
