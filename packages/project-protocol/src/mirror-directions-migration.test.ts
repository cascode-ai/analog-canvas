import {
  createEmptyProject,
  CURRENT_PROJECT_SCHEMA_VERSION,
  transformPoint,
} from "@icm/model";
import { describe, expect, it } from "vitest";

import { parseProject, serializeProject } from "./index.js";

function oldLocalXPoint(
  point: { x: number; y: number },
  rotation: 0 | 90 | 180 | 270,
): { x: number; y: number } {
  const mirrored = { x: -point.x, y: point.y };
  switch (rotation) {
    case 0:
      return mirrored;
    case 90:
      return { x: -mirrored.y, y: mirrored.x };
    case 180:
      return { x: -mirrored.x, y: -mirrored.y };
    case 270:
      return { x: mirrored.y, y: -mirrored.x };
  }
}

describe("independent mirror direction migration", () => {
  it("preserves old local-X geometry without rewriting rotation", () => {
    const project = createEmptyProject("mirror-migration", "Mirror migration");
    const document = project.documents[0]!;
    for (const rotation of [0, 90, 180, 270] as const) {
      document.instances.push({
        id: `R-${rotation}`,
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation,
          mirror: "none",
        },
      });
    }
    document.drafting!.objects.push({
      id: "floating",
      kind: "floating-symbol",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 300, y: 300 } },
      symbolId: "resistor",
      transform: { rotation: 90, mirror: "none" },
    });

    const previous = JSON.parse(serializeProject(project)) as {
      schemaVersion: number;
      documents: Array<{
        instances: Array<{
          placement: { rotation: 0 | 90 | 180 | 270; mirror: string };
        }>;
        drafting: {
          objects: Array<{
            transform: { rotation: 0 | 90 | 180 | 270; mirror: string };
          }>;
        };
      }>;
    };
    previous.schemaVersion = 51;
    for (const instance of previous.documents[0]!.instances) {
      instance.placement.mirror = "x";
    }
    previous.documents[0]!.drafting.objects[0]!.transform.mirror = "x";

    const migrated = parseProject(JSON.stringify(previous));
    expect(migrated.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    for (const instance of migrated.documents[0]!.instances) {
      const placement = instance.placement!;
      expect(placement.rotation).toBe(Number(instance.id.slice(2)));
      expect(placement.mirror).toBe(
        placement.rotation === 90 || placement.rotation === 270
          ? "vertical"
          : "horizontal",
      );
      expect(
        transformPoint({ x: 13, y: -7 }, { x: 0, y: 0 }, placement),
      ).toEqual(
        oldLocalXPoint(
          { x: 13, y: -7 },
          placement.rotation as 0 | 90 | 180 | 270,
        ),
      );
    }
    expect(migrated.documents[0]!.drafting!.objects[0]).toMatchObject({
      kind: "floating-symbol",
      transform: { rotation: 90, mirror: "vertical" },
    });
    expect(parseProject(serializeProject(migrated))).toEqual(migrated);
  });
});
