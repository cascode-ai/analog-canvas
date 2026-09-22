import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FOCUSED_TOOLS, focusedTools } from "./focused-tools.js";
import { callTool, listToolDefinitions, toolInputSchema } from "./tools.js";
import { selectToolSchema, contractOperations } from "./tool-contracts.js";
import { inlineSchema } from "./inline-schema.js";
import { declarationSchema } from "./declaration-schema.js";
import { describeToolContract } from "./tools.js";

describe("focused tools", () => {
  it.each(FOCUSED_TOOLS)(
    "$name derives its full contract and delegates unchanged",
    async ({ name, source, operations }) => {
      const handle = vi.fn(async () => ({ ok: true, receipt: "unchanged" }));
      const originals = [...new Set(FOCUSED_TOOLS.map((t) => t.source))].map(
        (name) => ({
          definition: {
            name,
            description: "test source",
            inputSchema: toolInputSchema(name)!,
          },
          handle,
        }),
      );
      const tool = focusedTools(originals, () => "test").find(
        (t) => t.definition.name === name,
      )!;
      expect(tool.definition.inputSchema).toEqual(
        selectToolSchema(toolInputSchema(source)!, operations),
      );
      expect(contractOperations(tool.definition.inputSchema)).toEqual(
        [...operations].sort(
          (a, b) =>
            contractOperations(toolInputSchema(source)!).indexOf(a) -
            contractOperations(toolInputSchema(source)!).indexOf(b),
        ),
      );
      for (const operation of operations) {
        const args =
          source === "apply_actions"
            ? { actions: [{ kind: operation }] }
            : {
                request: {
                  [source === "simulation" ? "operation" : "action"]: operation,
                },
              };
        const session = { identity: "same session" };
        await expect(tool.handle(args, session)).resolves.toEqual({
          ok: true,
          receipt: "unchanged",
        });
        expect(handle).toHaveBeenLastCalledWith(args, session);
      }
      await expect(
        tool.handle(
          source === "apply_actions"
            ? { actions: [{ kind: "not-in-this-tool" }] }
            : { request: { operation: "not-in-this-tool" } },
          {},
        ),
      ).rejects.toMatchObject({ code: "INVALID_TOOL_OPERATION" });
    },
  );

  it.each([
    ["simulation_edit", "simulation_files", { request: { action: "update" } }],
    [
      "simulation_run",
      "simulation",
      { request: { operation: "start" }, waitMs: "bad" },
    ],
    [
      "circuit_place",
      "apply_actions",
      {
        actions: [
          {
            kind: "place-component",
            symbol: "made-up",
            position: { x: 0.5, y: 2 },
          },
        ],
      },
    ],
    ["circuit_wire", "apply_actions", { actions: [] }],
  ])(
    "%s retains original strict validation before touching a session",
    async (focused, original, args) => {
      const a = await callTool(focused as string, args, {} as never);
      const b = await callTool(original as string, args, {} as never);
      expect(a).toEqual(b);
      expect(a.isError).toBe(true);
      expect(a.content[0]!.text).toContain("INVALID_TOOL_INPUT");
    },
  );

  it("uses numeric items for homogeneous closed tuples without changing the canonical schema", () => {
    const validator = z.strictObject({
      range: z.tuple([z.number(), z.number()]),
    });
    const canonical = z.toJSONSchema(validator);
    const before = structuredClone(canonical);
    const projected = declarationSchema(canonical) as any;
    expect(projected.properties.range.items).toEqual({ type: "number" });
    expect(projected.properties.range.maxItems).toBe(2);
    expect(projected.properties.range.prefixItems).toBeUndefined();
    expect(canonical).toEqual(before);
    expect(validator.safeParse({ range: [1, 2] }).success).toBe(true);
    expect(validator.safeParse({ range: [1, 2, 3] }).success).toBe(false);
    expect(validator.safeParse({ range: ["1", "2"] }).success).toBe(false);
    const optional = {
      type: "array",
      prefixItems: [{ type: "number" }, { type: "number" }],
      items: false,
      minItems: 1,
    };
    expect(declarationSchema(optional).minItems).toBe(1);
    const mixed = z.toJSONSchema(z.tuple([z.string(), z.number()]));
    expect(declarationSchema(mixed)).toEqual(inlineSchema(mixed));
  });

  it("reports actual per-tool declaration sizes for review, not token costs", () => {
    const definitions = listToolDefinitions();
    console.info(
      JSON.stringify({
        toolsListBytes: Buffer.byteLength(JSON.stringify(definitions)),
        tools: definitions
          .filter((t) => FOCUSED_TOOLS.some((f) => f.name === t.name))
          .map((t) => ({
            name: t.name,
            bytes: Buffer.byteLength(JSON.stringify(t.inputSchema)),
          })),
      }),
    );
    expect(definitions).toHaveLength(36);
  });

  it("keeps focused declarations below the observed host budget before structural compaction", () => {
    // Codex 4607249e430dac1c961df4dc615beae88e33cec8, tools/src/json_schema/
    // compaction.rs: normalized 5,000-byte budget, descriptions removed first.
    // This is a conservative JSON upper bound, NOT a replica or native-host test:
    // retain even keywords the host drops; strip only schema-node descriptions.
    const strip = (value: any): any => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
      const result = { ...value };
      delete result.description;
      for (const key of ["properties", "patternProperties", "dependentSchemas"])
        if (result[key])
          result[key] = Object.fromEntries(
            Object.entries(result[key]).map(([name, child]) => [
              name,
              strip(child),
            ]),
          );
      for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"])
        if (Array.isArray(result[key])) result[key] = result[key].map(strip);
      for (const key of [
        "items",
        "additionalProperties",
        "contains",
        "not",
        "if",
        "then",
        "else",
        "propertyNames",
      ])
        if (result[key] !== undefined) result[key] = strip(result[key]);
      return result;
    };
    for (const tool of listToolDefinitions().filter((t) =>
      FOCUSED_TOOLS.some((f) => f.name === t.name),
    )) {
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toContain(
        '"$ref"',
      );
      expect(
        Buffer.byteLength(JSON.stringify(strip(tool.inputSchema))),
        tool.name,
      ).toBeLessThanOrEqual(5000);
    }
  });

  it("defers only RichText detail while preserving exact offline discovery and runtime rejection", async () => {
    const schema = listToolDefinitions().find((t) => t.name === "circuit_text")!
      .inputSchema as any;
    const label = schema.properties.actions.items.oneOf.find(
      (s: any) => s.properties.kind.const === "add-label",
    );
    expect(label.properties.text.anyOf[0].type).toBe("string");
    expect(label.properties.text.anyOf[1].description).toContain(
      "describe_tool",
    );
    const exact = describeToolContract({
      tool: "circuit_text",
      operations: ["add-label"],
      field: "/actions/*/text",
    }) as any;
    expect(JSON.stringify(exact)).toContain('"runs"');
    expect(JSON.stringify(exact)).toContain('"fraction"');
    expect(exact.error).toBeUndefined();
    const invalid = await callTool(
      "circuit_text",
      {
        actions: [
          {
            kind: "annotate",
            text: { fake: "not-richtext" },
            position: { x: 0, y: 0 },
          },
        ],
      },
      {} as never,
    );
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0]!.text).toContain("INVALID_TOOL_INPUT");
  });
});
