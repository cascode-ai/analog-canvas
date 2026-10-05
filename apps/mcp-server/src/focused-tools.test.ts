import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  FOCUSED_TOOLS,
  canonicalSimulationSchema,
  focusedTools,
} from "./focused-tools.js";
import { callTool, listToolDefinitions, toolInputSchema } from "./tools.js";
import { selectToolSchema, contractOperations } from "./tool-contracts.js";
import { inlineSchema } from "./inline-schema.js";
import { declarationSchema } from "./declaration-schema.js";
import { describeToolContract } from "./tools.js";

// The first tool listing builds every tool's contract: about a second
// alone, and past the 5 s a test gets beside the full suite on a CI runner.
// Each worker builds them once, here, outside any one test's time.
beforeAll(() => void listToolDefinitions(), 30_000);

describe("focused tools", () => {
  it("omits repetitive scalar bounds only in discovery while preserving domain bounds and exact rejection", async () => {
    const exact = {
      type: "object",
      properties: {
        coordinate: {
          type: "integer",
          minimum: Number.MIN_SAFE_INTEGER,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        count: { type: "integer", minimum: 1, maximum: 64 },
        identifier: { type: "string", minLength: 1 },
        pair: { type: "string", minLength: 2 },
      },
    };
    expect(declarationSchema(exact, "circuit_place")).toEqual({
      type: "object",
      properties: {
        coordinate: { type: "integer" },
        count: { type: "integer", minimum: 1, maximum: 64 },
        identifier: { type: "string" },
        pair: { type: "string", minLength: 2 },
      },
    });
    expect(exact.properties.coordinate.maximum).toBe(Number.MAX_SAFE_INTEGER);
    const coordinate = describeToolContract({
      tool: "circuit_place",
      operations: ["place-component"],
      field: "/actions/*/position/x",
    }) as any;
    expect(JSON.stringify(coordinate)).toContain(
      String(Number.MAX_SAFE_INTEGER),
    );
    const rejected = await callTool(
      "circuit_place",
      {
        actions: [
          {
            kind: "place-component",
            symbol: "resistor",
            reference: "R1",
            position: { x: Number.MAX_SAFE_INTEGER + 1, y: 0 },
          },
        ],
      },
      {} as any,
    );
    expect(rejected.isError).toBe(true);
  });
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
      const selected = selectToolSchema(toolInputSchema(source)!, operations);
      expect(tool.definition.inputSchema).toEqual(
        source === "simulation_files"
          ? canonicalSimulationSchema(selected)
          : selected,
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

  it("points a focused simulation error at the owning focused tool", async () => {
    const tool = focusedTools(
      [...new Set(FOCUSED_TOOLS.map((entry) => entry.source))].map(
        (source) => ({
          definition: {
            name: source,
            description: "canonical",
            inputSchema: toolInputSchema(source)!,
          },
          handle: async () => ({ ok: true }),
        }),
      ),
      () => "focused",
    ).find((entry) => entry.definition.name === "simulation_source")!;
    await expect(
      tool.handle({ request: { action: "update" } }, {}),
    ).rejects.toMatchObject({
      code: "INVALID_TOOL_OPERATION",
      message: "update is served by simulation_edit.",
    });
  });

  it("accepts action and operation aliases across sibling simulation tools", async () => {
    const calls: unknown[] = [];
    const originals = [
      ...new Set(FOCUSED_TOOLS.map((entry) => entry.source)),
    ].map((source) => ({
      definition: {
        name: source,
        description: "canonical",
        inputSchema: toolInputSchema(source)!,
      },
      handle: async (args: unknown) => {
        calls.push(args);
        return { ok: true };
      },
    }));
    const tools = focusedTools(originals, () => "focused");
    await tools
      .find((tool) => tool.definition.name === "simulation_run")!
      .handle({ request: { action: "capabilities" } }, {});
    await tools
      .find((tool) => tool.definition.name === "simulation_source")!
      .handle({ request: { operation: "list" } }, {});
    expect(calls).toEqual([
      { request: { operation: "capabilities" } },
      { request: { action: "list" } },
    ]);
  });

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

describe("a focused tool splits actions that cannot share one call (#1231)", () => {
  const alias = { kind: "set-display-alias", instanceId: "amp", text: "A1" };
  const flow = {
    kind: "set-signal-flow",
    target: { kind: "instance", id: "block" },
    coefficient: "a",
  };
  function properties(answer: (actions: unknown[]) => unknown) {
    const calls: unknown[][] = [];
    const originals = [
      ...new Set(FOCUSED_TOOLS.map((entry) => entry.source)),
    ].map((source) => ({
      definition: {
        name: source,
        description: "canonical",
        inputSchema: toolInputSchema(source)!,
      },
      handle: async (args: unknown) => {
        const actions = (args as { actions: unknown[] }).actions;
        calls.push(actions);
        return actions.length > 1
          ? {
              ok: false,
              code: "ACTION_BATCH_NOT_ATOMIC",
              calls: [
                { actionIndices: [0], actionKinds: ["set-signal-flow"] },
                { actionIndices: [1], actionKinds: ["set-display-alias"] },
              ],
            }
          : answer(actions);
      },
    }));
    const tool = focusedTools(originals, () => "focused").find(
      (entry) => entry.definition.name === "circuit_properties",
    )!;
    return { tool, calls };
  }

  it("sends them as the named calls in order and says so", async () => {
    let revision = 4;
    const { tool, calls } = properties(() => ({
      ok: true,
      revision: ++revision,
    }));
    const result = (await tool.handle({ actions: [flow, alias] }, {})) as any;
    expect(calls).toEqual([[flow, alias], [flow], [alias]]);
    expect(result).toMatchObject({
      ok: true,
      revision: 6,
      split: {
        applied: 2,
        calls: [
          { actionIndices: [0], ok: true, revision: 5 },
          { actionIndices: [1], ok: true, revision: 6 },
        ],
      },
    });
  });

  it("stops at a failed call and says which ones stay applied", async () => {
    const { tool, calls } = properties((actions) =>
      (actions[0] as { kind: string }).kind === "set-display-alias"
        ? { ok: false, code: "EDIT_PRECONDITION", message: "no name" }
        : { ok: true, revision: 5 },
    );
    const result = (await tool.handle({ actions: [flow, alias] }, {})) as any;
    expect(calls).toHaveLength(3);
    expect(result.ok).toBe(false);
    expect(result.split.applied).toBe(1);
    expect(result.split.note).toContain("call 2 failed");
    expect(result.split.calls[1]).toMatchObject({
      ok: false,
      code: "EDIT_PRECONDITION",
    });
  });
});

describe("one envelope for simulation tools (#1231)", () => {
  function sourceTool() {
    const calls: unknown[] = [];
    const originals = [
      ...new Set(FOCUSED_TOOLS.map((entry) => entry.source)),
    ].map((source) => ({
      definition: {
        name: source,
        description: "canonical",
        inputSchema: toolInputSchema(source)!,
      },
      handle: async (args: unknown) => {
        calls.push(args);
        return { ok: true };
      },
    }));
    const tool = focusedTools(originals, () => "focused").find(
      (entry) => entry.definition.name === "simulation_source",
    )!;
    return { tool, calls };
  }

  it("puts flat arguments in the request and each detail where it belongs", async () => {
    const { tool, calls } = sourceTool();
    await tool.handle({ action: "list" }, {});
    await tool.handle({ action: "read", path: "tb.cir", detail: "text" }, {});
    await tool.handle(
      { request: { action: "read", path: "tb.cir", detail: "full" } },
      {},
    );
    await tool.handle(
      { request: { action: "read", path: "tb.cir" }, detail: "mapped" },
      {},
    );
    expect(calls).toEqual([
      { request: { action: "list" } },
      { request: { action: "read", path: "tb.cir", detail: "text" } },
      { request: { action: "read", path: "tb.cir" }, detail: "full" },
      { request: { action: "read", path: "tb.cir", detail: "mapped" } },
    ]);
  });

  it("still holds flat arguments to the tool's own operations", async () => {
    const { tool, calls } = sourceTool();
    await expect(tool.handle({ action: "update" }, {})).rejects.toMatchObject({
      code: "INVALID_TOOL_OPERATION",
    });
    expect(calls).toEqual([]);
  });
});
