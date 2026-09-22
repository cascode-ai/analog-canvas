import { describe, expect, it } from "vitest";
import { z } from "zod";
import { inlineSchema } from "./inline-schema.js";
import {
  ContractQueryError,
  ToolContractRegistry,
  selectToolSchema,
} from "./tool-contracts.js";
import { callTool, describeToolContract, toolInputSchema } from "./tools.js";
import { readResourceContent } from "./resources.js";

const text = (result: Awaited<ReturnType<typeof callTool>>) =>
  JSON.parse(result.content[0]!.text!);

describe("on-demand tool contracts", () => {
  it("discovers operations offline without returning every input schema", async () => {
    const result = await callTool("describe_tool", {}, {} as never);
    expect(result.isError).not.toBe(true);
    const directory = text(result);
    expect(directory.contractVersion).toBeTruthy();
    expect(
      directory.tools.find((t: { name: string }) => t.name === "apply_actions")
        .operations,
    ).toContain("connect");
    expect(
      directory.tools.find((t: { name: string }) => t.name === "simulation")
        .operations,
    ).toContain("prepare");
    expect(directory.tools.every((t: object) => !("inputSchema" in t))).toBe(
      true,
    );
  });

  it("selects several high-level actions with their original array and call constraints", () => {
    const all = inlineSchema(toolInputSchema("apply_actions")!);
    const result = describeToolContract({
      tool: "apply_actions",
      operations: ["undo", "redo"],
    }) as { inputSchema: Record<string, unknown> };
    const selected = inlineSchema(result.inputSchema) as any;
    expect(selected.properties.documentId).toEqual(
      (all as any).properties.documentId,
    );
    expect(selected.required).toEqual(all.required);
    expect(selected.additionalProperties).toBe(false);
    expect(selected.properties.actions.minItems).toBe(1);
    expect(selected.properties.actions.maxItems).toBe(256);
    expect(
      selected.properties.actions.items.oneOf.map(
        (s: any) => s.properties.kind.const,
      ),
    ).toEqual(["undo", "redo"]);
    // A query does not narrow the registered executor or subsequent full contracts.
    expect(JSON.stringify(toolInputSchema("apply_actions"))).toContain(
      "place-components",
    );
  });

  it("keeps the real property named title and resolves precise formats, not all plot details", () => {
    const result = describeToolContract({
      tool: "simulation_files",
      operations: ["prepare-plot"],
      field: "/request/formats",
    }) as any;
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]).toMatchObject({
      required: false,
      operations: ["prepare-plot"],
      schema: {
        type: "array",
        minItems: 1,
        items: { type: "string", enum: ["png", "svg", "pdf"] },
      },
    });
    expect(JSON.stringify(result)).not.toContain('"panels"');
    const title = describeToolContract({
      tool: "simulation_files",
      operations: ["prepare-plot"],
      field: "/request/title",
    }) as any;
    expect(title.variants[0].schema).toEqual({ type: "string" });
  });

  it("keeps each union field alternative and required status, including array elements", () => {
    const result = describeToolContract({
      tool: "apply_actions",
      operations: ["undo", "redo"],
      field: "/actions/*/kind",
    }) as any;
    expect(
      result.variants.map((v: any) => [v.schema.const, v.required]),
    ).toEqual([
      ["undo", true],
      ["redo", true],
    ]);
  });

  it("supports a discriminator enum without loosening unrelated fields", () => {
    const schema = selectToolSchema(toolInputSchema("import_file")!, [
      "inspect",
    ]);
    expect((schema.properties as any).action.enum).toEqual(["inspect"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("resolves reused definitions but does not traverse authored examples as schemas", () => {
    const shared = z.strictObject({
      title: z.string(),
      formats: z.array(z.enum(["png", "svg"])),
    });
    const original = z.toJSONSchema(
      z.strictObject({
        request: z.discriminatedUnion("action", [
          z.strictObject({ action: z.literal("one"), value: shared }),
          z.strictObject({ action: z.literal("two"), value: shared }),
        ]),
      }),
      { reused: "ref" },
    );
    const selected = selectToolSchema(original, ["one"]) as any;
    expect(
      selected.properties.request.properties.value.properties.title.type,
    ).toBe("string");
    expect(JSON.stringify(selected)).not.toContain('"$ref"');
  });

  it("preserves the canonical structure-edit guidance instead of confusing actions and edits", async () => {
    const response = text(
      await callTool(
        "describe_tool",
        { editKind: "set_cell_symbol_presentation" },
        {} as never,
      ),
    );
    expect(response.inputSchema).toEqual(
      JSON.parse(
        readResourceContent(
          "analog-canvas://contract/edits/set_cell_symbol_presentation",
        ).text,
      ),
    );
    expect(response.inputSchema["x-transaction"].form).toBe("structureEdits");
    expect(
      text(
        await callTool("describe_tool", { editKind: "connect" }, {} as never),
      ).error.code,
    ).toBe("UNKNOWN_EDIT_CONTRACT");
  });

  it("uses the same registry for parameterized resources and tool calls", async () => {
    const query = {
      tool: "simulation_files",
      operations: ["prepare-plot"],
      field: "/request/formats",
    };
    const result = text(await callTool("describe_tool", query, {} as never));
    expect(
      JSON.parse(
        readResourceContent(
          "analog-canvas://contract/tools/simulation_files?operations=prepare-plot&field=%2Frequest%2Fformats",
        ).text,
      ),
    ).toEqual(result);
  });

  it.each([
    { operations: ["undo"] },
    { tool: "apply_actions", operations: ["not-an-action"] },
    { tool: "missing" },
    { tool: "simulation_files", field: "/request/missing" },
    { tool: "simulation_files", field: "/request/~2" },
    { tool: "simulation_files", field: "request/formats" },
    { tool: "apply_actions", editKind: "set_instance_reference" },
  ])(
    "rejects an invalid selector without a browser call: %j",
    async (query) => {
      const result = await callTool("describe_tool", query, {} as never);
      expect(result.isError).toBe(true);
      expect(text(result).error.code).not.toBe("TOOL_FAILURE");
    },
  );

  it("does not silently return a truncated contract", () => {
    const registry = new ToolContractRegistry(
      [
        {
          name: "large",
          description: "test",
          inputSchema: {
            type: "object",
            properties: {
              value: { type: "string", description: "x".repeat(100_000) },
            },
          },
        },
      ],
      "test-version",
    );
    expect(registry.describe({ tool: "large" })).toMatchObject({
      ok: false,
      error: { code: "CONTRACT_SELECTION_TOO_BROAD" },
    });
    expect(() => selectToolSchema({ type: "object" }, ["missing"])).toThrow(
      ContractQueryError,
    );
  });
});
