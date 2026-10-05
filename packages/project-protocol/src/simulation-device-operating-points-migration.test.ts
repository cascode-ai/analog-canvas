import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

import { upgradeSchema46To47 } from "./index.js";

describe("schema 46 to 47 MOS operating-point migration", () => {
  it("advances without selecting devices implicitly", () => {
    const previous = structuredClone(
      createEmptyProject("project", "Project"),
    ) as unknown as Record<string, unknown>;
    previous.schemaVersion = 46;
    previous.simulationSetups = [];

    const upgraded = upgradeSchema46To47(previous);

    expect(upgraded).toMatchObject({ schemaVersion: 47 });
    expect(upgraded.simulationSetups).toEqual([]);
  });
});
