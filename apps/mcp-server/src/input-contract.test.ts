import { describe, expect, it } from "vitest";
import { z } from "zod";
import { inputContract } from "./input-contract.js";
import {
  callTool,
  describeToolContract,
  listToolDefinitions,
} from "./tools.js";
import { selectToolSchema } from "./tool-contracts.js";

describe("caller input contracts", () => {
  it("describes input before defaults and transforms without changing execution", () => {
    const schema = z.strictObject({
      required: z.string(),
      optional: z.string().optional(),
      defaults: z.array(z.string()).default([]),
      transformed: z.string().transform((value) => value.length),
    });
    const contract = inputContract(schema) as any;
    expect(contract.required).toEqual(["required", "transformed"]);
    expect(contract.properties.transformed.type).toBe("string");
    expect(schema.parse({ required: "yes", transformed: "abc" })).toEqual({
      required: "yes",
      transformed: 3,
      defaults: [],
    });
  });

  it("keeps update defaults optional in discovery and precise queries", () => {
    const tool = listToolDefinitions().find(
      (t) => t.name === "simulation_edit",
    )!;
    const selected = selectToolSchema(tool.inputSchema, ["update"]) as any;
    expect(selected.properties.request.required).not.toContain("patches");
    const field = describeToolContract({
      tool: "simulation_edit",
      operations: ["update"],
      field: "/request/patches",
    }) as any;
    expect(field.variants[0].required).toBe(false);
  });

  it("rejects wrong tuple lengths at the selected nested field without network access", async () => {
    const args = {
      request: {
        action: "prepare-plot",
        runId: "run",
        name: "plot",
        panels: [
          {
            analysisIndex: 0,
            signals: [{ signal: "v(out)" }],
            xRange: [0, 1, 2],
          },
        ],
      },
    };
    for (const tool of ["simulation_files", "simulation_plot"]) {
      const result = await callTool(tool, args, {} as never);
      expect(result.isError).toBe(true);
      const failure = JSON.parse(result.content[0]!.text!);
      expect(failure.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["request", "panels", 0, "xRange"],
          code: "too_big",
          message: "Expected exactly two numbers: [minimum, maximum].",
        }),
      );
      expect(failure.error.details).toBeDefined();
    }
    const field = describeToolContract({
      tool: "simulation_plot",
      field: "/request/panels/*/xRange",
    }) as any;
    expect(field.variants[0].schema).toMatchObject({
      minItems: 2,
      maxItems: 2,
      description: "Exactly two numbers: [minimum, maximum].",
    });
  });

  it("does not guess a union branch for an unknown operation or expose submitted values", async () => {
    const result = await callTool(
      "simulation_files",
      {
        request: { action: "private-unknown-action", secret: "private-value" },
      },
      {} as never,
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(JSON.parse(result.content[0]!.text!).error.issues[0].path).toEqual([
      "request",
    ]);
  });
});
