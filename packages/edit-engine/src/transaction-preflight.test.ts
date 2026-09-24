import { describe, expect, it } from "vitest";
import { createRoutePath } from "@icm/model";

import {
  gridAlignmentDiagnostics,
  gridPointsOfEdit,
} from "./transaction-preflight.js";

describe("typed-edit grid preflight", () => {
  it("reports only persisted Route waypoints with their semantic path", () => {
    const edit = {
      kind: "set_route_path" as const,
      route: createRoutePath({
        id: "R1",
        netId: "N1",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [{ x: 15, y: 20 }],
        modes: ["manual", "manual"],
      }),
    };

    expect(gridPointsOfEdit(edit)).toEqual([
      {
        point: { x: 15, y: 20 },
        path: ["route", "legs", 0, "to", "position"],
      },
    ]);
    expect(gridAlignmentDiagnostics(edit, 10)).toMatchObject([
      {
        code: "GRID_ALIGNMENT",
        path: ["route", "legs", 0, "to", "position", "x"],
      },
    ]);
    expect(
      gridAlignmentDiagnostics(
        {
          ...edit,
          route: createRoutePath({
            id: "R2",
            netId: "N1",
            start: { kind: "junction", junctionId: "J1" },
            end: { kind: "junction", junctionId: "J2" },
            bends: [{ x: 16, y: 20 }],
            modes: ["manual", "manual"],
          }),
        },
        10,
      ),
    ).toEqual([]);
  });

  it("does not reinterpret non-page scalar geometry as a coordinate", () => {
    expect(
      gridAlignmentDiagnostics(
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "A1",
            kind: "route-marker",
            content: {
              runs: [{ kind: "text", value: "I" }],
            },
            anchor: {
              kind: "route",
              routeId: "R1",
              legId: "route-leg-1",
              t: 0.375,
              normalOffset: 3.25,
              direction: "forward",
              orientation: "follow",
              fallbackPosition: { x: 20, y: 30 },
            },
            alignment: "middle",
            rotation: 0,
            locked: false,
            markerKind: "current",
          },
        },
        10,
      ),
    ).toEqual([]);
  });
});
