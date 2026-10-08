import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { inputContract } from "./input-contract.js";
import { FOCUSED_TOOLS } from "./focused-tools.js";
import { inlineSchema } from "./inline-schema.js";
import {
  callTool,
  describeToolContract,
  listToolDefinitions,
  toolInputSchema,
} from "./tools.js";
import {
  contractOperations,
  properties,
  selectToolSchema,
} from "./tool-contracts.js";

// The first tool listing builds every tool's contract: about a second
// alone, and past the 5 s a test gets beside the full suite on a CI runner.
// Each worker builds them once, here, outside any one test's time.
beforeAll(() => void listToolDefinitions(), 30_000);

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
      // Details must not re-expand unrelated file/workspace union branches.
      if (failure.error.details[0].code === "invalid_union")
        expect(failure.error.details[0].errors).toHaveLength(1);
      else expect(failure.error.details[0].code).toBe("too_big");
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

  it("says what would pass: the known keys, values, limits and type (#1464)", async () => {
    const issue = async (tool: string, args: unknown) => {
      const result = await callTool(tool, args, {} as never);
      expect(result.isError).toBe(true);
      return JSON.parse(result.content[0]!.text!).error.issues[0];
    };
    // describe_tool takes `tool`, not `name`.
    expect(
      await issue("describe_tool", { name: "circuit_properties" }),
    ).toMatchObject({
      path: [],
      code: "unrecognized_keys",
      keys: ["name"],
      allowed: ["editKind", "field", "operations", "tool"],
      message: 'Unknown key "name"; allowed: editKind, field, operations, tool',
    });
    // An object in a union lists the keys of the branch its action selects.
    expect(
      await issue("simulation_files", { request: { action: "list", page: 2 } }),
    ).toMatchObject({
      path: ["request"],
      code: "unrecognized_keys",
      keys: ["page"],
      allowed: ["action", "owner"],
    });
    expect(await issue("render", { mode: "raw" })).toMatchObject({
      path: ["mode"],
      code: "invalid_value",
      values: ["formal", "diagnostics"],
      message: "Expected one of: formal, diagnostics",
    });
    expect(
      await issue("render", { bounds: { x: 0, y: 0, width: 0, height: 10 } }),
    ).toMatchObject({
      path: ["bounds", "width"],
      code: "too_small",
      minimum: 0,
      inclusive: false,
      message: "Must be more than 0",
    });
    expect(
      await issue("describe_tool", { operations: Array(65).fill("x") }),
    ).toMatchObject({
      path: ["operations"],
      code: "too_big",
      maximum: 64,
      inclusive: true,
      message: "At most 64 items",
    });
    expect(await issue("render", { documentId: 5 })).toMatchObject({
      path: ["documentId"],
      code: "invalid_type",
      expected: "string",
      message: "Expected string",
    });
  });

  it("answers a missing or unknown kind, action or operation with the ones the tool takes (#1525)", async () => {
    const refusal = async (tool: string, args: unknown) =>
      JSON.parse((await callTool(tool, args, {} as never)).content[0]!.text!)
        .error;
    expect((await refusal("netlist_code", {})).issues).toEqual([
      {
        path: ["action"],
        code: "invalid_union",
        message: 'Missing "action"; expected one of: read, replace',
        values: ["read", "replace"],
      },
    ]);
    expect(
      (await refusal("netlist_code", { action: "private-x" })).issues[0]
        .message,
    ).toBe('Unknown "action"; expected one of: read, replace');
    let checked = 0;
    for (const tool of listToolDefinitions()) {
      const operations = contractOperations(tool.inputSchema);
      if (!operations.length) continue;
      checked++;
      const fields = Object.keys(properties(inlineSchema(tool.inputSchema)));
      const at = fields.includes("request")
        ? ["request"]
        : fields.includes("actions")
          ? ["actions", 0]
          : fields.includes("target")
            ? ["target"]
            : [];
      const args = (tag: Record<string, string> = {}) =>
        at.reduceRight<unknown>(
          (value, step) => (step === 0 ? [value] : { [step]: value }),
          tag,
        );
      const missing = await refusal(tool.name, args());
      if (missing.code === "SIMULATION_HELPER_INPUT_INVALID") {
        // The saved-experiment helpers answer in one message.
        for (const operation of operations)
          expect(missing.message, tool.name).toContain(`'${operation}'`);
        continue;
      }
      const issue = missing.issues.find((issue: any) => issue.values);
      expect([...issue.values].sort(), tool.name).toEqual(
        [...operations].sort(),
      );
      const unknown = await refusal(
        tool.name,
        args({ [issue.path.at(-1)]: "private-unknown" }),
      );
      expect(JSON.stringify(unknown), tool.name).not.toContain("private-");
      const focused = FOCUSED_TOOLS.find((entry) => entry.name === tool.name);
      if (focused)
        expect(unknown.message).toContain(focused.operations.join(", "));
      else
        expect(unknown.issues[0], tool.name).toMatchObject({
          path: issue.path,
          values: issue.values,
        });
    }
    expect(checked).toBeGreaterThan(20);
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
    expect(JSON.parse(result.content[0]!.text!).error.issues[0]).toMatchObject({
      path: ["request", "action"],
      values: contractOperations(toolInputSchema("simulation_files")!),
    });
    expect(result.content[0]!.text!.length).toBeLessThan(1500);
    expect(
      JSON.parse(result.content[0]!.text!).error.details[0],
    ).not.toHaveProperty("errors");
  });
});
