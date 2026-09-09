import { describe, expect, it } from "vitest";

import { upgradeSchema47To48WithReport } from "./previous-to-current.js";

describe("schema 47 to 48 simulation variable migration", () => {
  it("preserves nominal behavior while adding an explicit Run Plan", () => {
    const raw = {
      schemaVersion: 47,
      simulationSetups: [
        {
          id: "structured",
          name: "OP",
          version: 2,
          input: {
            kind: "structured",
            rootDocumentId: "tb",
            analyses: [{ kind: "op" }],
            outputs: [],
            environment: { profileId: "profile" },
          },
        },
        {
          id: "raw",
          name: "Raw",
          version: 2,
          input: { kind: "raw", entry: "tb.cir" },
        },
      ],
    };

    const { project, report } = upgradeSchema47To48WithReport(raw);

    expect(project.schemaVersion).toBe(48);
    expect(report).toEqual({ migratedSetups: 1 });
    expect(project.simulationSetups).toEqual([
      expect.objectContaining({
        version: 3,
        input: expect.objectContaining({
          designVariables: [],
          runPlan: { mode: "nominal" },
        }),
      }),
      expect.objectContaining({ version: 3 }),
    ]);
    expect(raw.schemaVersion).toBe(47);
  });
});
