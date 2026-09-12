import { CURRENT_PROJECT_SCHEMA_VERSION, createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { parseProject, serializeProject } from "./index.js";

describe("schema 52 to 53 rotation-step migration", () => {
  it("preserves a quarter-turn project while advancing its version", () => {
    const previous = createEmptyProject("rotation-52", "Rotation 52");
    previous.schemaVersion = 52 as typeof previous.schemaVersion;
    previous.documents[0]!.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 90,
        mirror: "none",
      },
    });

    const migrated = parseProject(JSON.stringify(previous));
    expect(migrated.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(migrated.documents[0]!.instances[0]!.placement?.rotation).toBe(90);
  });

  it("round-trips a new 45-degree placement", () => {
    const project = createEmptyProject("rotation-53", "Rotation 53");
    project.documents[0]!.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 45,
        mirror: "none",
      },
    });

    expect(parseProject(serializeProject(project))).toEqual(project);
  });
});
