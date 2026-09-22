import { describe, expect, it } from "vitest";
import { compactSchema } from "./compact-schema.js";

describe("schema compaction", () => {
  it("inlines single-use schemas but keeps shared constraints and opaque examples", () => {
    const value = {
      type: "string",
      description: "A".repeat(180),
      minLength: 2,
    };
    const input = {
      type: "object",
      properties: {
        first: value,
        second: value,
        unique: { type: "number", description: "B".repeat(180), minimum: 1 },
      },
      examples: [{ $ref: "literal user data" }],
    };
    const before = structuredClone(input);
    const compact = compactSchema(input) as any;
    expect(compact.properties.unique).toEqual(input.properties.unique);
    expect(compact.properties.first).toEqual(compact.properties.second);
    expect(compact.$defs[compact.properties.first.$ref.slice(8)]).toEqual(
      value,
    );
    expect(Object.keys(compact.$defs)).toHaveLength(1);
    expect(compact.examples).toEqual(input.examples);
    expect(input).toEqual(before);
  });
  it("retains constraints beside references and resolves their definitions", () => {
    const compact = compactSchema({
      type: "object",
      properties: {
        value: {
          $ref: "#/$defs/text",
          minLength: 3,
          description: "Required name",
        },
      },
      $defs: { text: { type: "string", maxLength: 20 } },
    });
    expect(compact).toEqual({
      type: "object",
      properties: {
        value: {
          allOf: [
            { type: "string", maxLength: 20 },
            { minLength: 3, description: "Required name" },
          ],
        },
      },
    });
  });
  it("leaves recursive definitions intact", () => {
    const schema = {
      type: "object",
      properties: { child: { $ref: "#/$defs/node" } },
      $defs: {
        node: {
          type: "object",
          properties: { child: { $ref: "#/$defs/node" } },
        },
      },
    };
    expect(compactSchema(schema)).toEqual(schema);
  });
});
