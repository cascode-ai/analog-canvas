import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

import { upgradeSchema45To46 } from "./index.js";

describe("schema 45 to 46 simulation Noise migration", () => {
  it("advances without inventing Noise intent", () => {
    const previous = structuredClone(
      createEmptyProject("project", "Project"),
    ) as unknown as Record<string, unknown>;
    previous.schemaVersion = 45;
    previous.simulationSetups = [];
    const upgraded = upgradeSchema45To46(previous);

    expect(upgraded).toMatchObject({ schemaVersion: 46 });
    expect(upgraded.simulationSetups).toEqual([]);
  });
});
