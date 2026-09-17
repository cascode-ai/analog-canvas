import {
  createEmptyProject,
  createRoutePath,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "@icm/model";
import { describe, expect, it } from "vitest";

import { parseProjectWithMetadata } from "./index.js";

function schema56Rail(scope: "local" | "global") {
  const project = createEmptyProject("rail-migration", "Rail migration");
  const document = project.documents[0]!;
  project.schemaVersion = 56 as typeof project.schemaVersion;
  document.nets.push({ id: "net-vdd", terminals: [] });
  document.junctions.push(
    { id: "rail-start", netId: "net-vdd", position: { x: 0, y: 0 } },
    { id: "rail-end", netId: "net-vdd", position: { x: 100, y: 0 } },
  );
  document.routes.push(
    createRoutePath({
      id: "rail-vdd",
      netId: "net-vdd",
      start: { kind: "junction", junctionId: "rail-start" },
      end: { kind: "junction", junctionId: "rail-end" },
      bends: [],
      modes: ["manual"],
      presentation: "power-rail",
    }),
  );
  document.annotations.push({
    id: "label-vdd",
    kind: "power-label",
    binding: { kind: "net-name", netId: "net-vdd" },
    netId: "net-vdd",
    anchor: {
      kind: "object",
      objectId: "rail-end",
      localOffset: { x: 10, y: 10 },
      fallbackPosition: { x: 110, y: 10 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.connectivityEvidence.push({
    id: "claim-vdd",
    kind: "name-claim",
    netId: "net-vdd",
    name: "VDD",
    scope,
    powerDomain: "vdd",
    owner: { kind: "power-marker", objectId: "label-vdd" },
  });
  return project;
}

describe("schema 57 Power Rail formal terminals", () => {
  it("upgrades a schema 56 local rail to an annotation-owned Cell Pin", () => {
    const result = parseProjectWithMetadata(
      JSON.stringify(schema56Rail("local")),
    );
    expect(result).toMatchObject({
      sourceSchemaVersion: 56,
      migrated: true,
      project: { schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION },
    });
    const document = result.project.documents[0]!;
    expect(document.netlist?.terminals).toEqual([
      expect.objectContaining({
        name: "VDD",
        netId: "net-vdd",
        direction: "inout",
        interfaceInstanceIds: [],
        interfaceAnnotationId: "label-vdd",
      }),
    ]);
    expect(document.annotations[0]?.binding).toEqual({
      kind: "cell-terminal-name",
      terminalId: document.netlist?.terminals[0]?.id,
    });
  });

  it("preserves an explicit global rail without creating a Cell Pin", () => {
    const result = parseProjectWithMetadata(
      JSON.stringify(schema56Rail("global")),
    );
    expect(result.project.documents[0]?.netlist?.terminals).toEqual([]);
    expect(result.project.documents[0]?.annotations[0]?.binding).toEqual({
      kind: "net-name",
      netId: "net-vdd",
    });
  });
});
