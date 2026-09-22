import { describe, expect, it } from "vitest";
import { inlineSchema } from "./inline-schema.js";
import { listToolDefinitions } from "./tools.js";

describe("host-facing inline schemas", () => {
  it("retains constraints and metadata without metadata-only intersections", () => {
    expect(
      inlineSchema({
        type: "object",
        properties: { a: { $ref: "#/$defs/a", description: "Name" } },
        $defs: { a: { type: "string", minLength: 1 } },
      }),
    ).toEqual({
      type: "object",
      properties: { a: { type: "string", minLength: 1, description: "Name" } },
    });
    expect(
      inlineSchema({
        $ref: "#/$defs/a",
        minLength: 2,
        $defs: { a: { type: "string", minLength: 1 } },
      }),
    ).toEqual({ allOf: [{ type: "string", minLength: 1 }, { minLength: 2 }] });
  });
  it("does not rewrite authored default values as schemas", () => {
    const schema = { type: "object", default: { $ref: "authored-value" } };
    expect(inlineSchema(schema)).toEqual(schema);
  });
  it("exposes simulation operations and basic fields without reference resolution", () => {
    const tools = listToolDefinitions();
    for (const name of [
      "simulation",
      "simulation_files",
      "simulation_folder",
      "connect",
    ]) {
      const schema = tools.find((tool) => tool.name === name)!.inputSchema;
      expect(JSON.stringify(schema)).not.toContain('"$ref"');
      expect(JSON.stringify(schema)).not.toContain('"$defs"');
    }
    const schema = tools.find(
      (tool) => tool.name === "simulation",
    )!.inputSchema;
    expect(schema.properties).toMatchObject({
      requestId: { type: "string" },
      waitMs: { type: "integer", maximum: 20000 },
      detail: { type: "string", enum: ["summary", "full"] },
      request: { oneOf: expect.any(Array) },
    });
    expect(
      tools.find((tool) => tool.name === "advanced_transact")!.inputSchema
        .properties,
    ).toMatchObject({ dryRun: { type: "boolean" } });
  });
});
