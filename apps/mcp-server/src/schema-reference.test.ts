import { describe, expect, it } from "vitest";
import { compactSchema } from "./compact-schema.js";
import { inlineSchema } from "./inline-schema.js";

describe.each([
  ["compact", compactSchema],
  ["inline", inlineSchema],
] as const)("%s reference siblings", (_, project) => {
  it("keeps scalar types and field-local metadata together without changing the input", () => {
    const input = {
      type: "object",
      properties: {
        refresh: {
          $ref: "#/$defs/flag",
          description: "Reread",
          default: false,
        },
        force: { $ref: "#/$defs/flag", description: "Force", deprecated: true },
        detail: { $ref: "#/$defs/detail", description: "Response detail" },
      },
      $defs: {
        flag: { type: "boolean", description: "Shared flag" },
        detail: { type: "string", enum: ["compact", "full"] },
      },
    };
    const before = structuredClone(input);
    expect(project(input)).toEqual({
      type: "object",
      properties: {
        refresh: { type: "boolean", description: "Reread", default: false },
        force: { type: "boolean", description: "Force", deprecated: true },
        detail: {
          type: "string",
          enum: ["compact", "full"],
          description: "Response detail",
        },
      },
    });
    expect(input).toEqual(before);
  });

  it("does not merge disjoint constraint keys across closed-object scope", () => {
    const target = { type: "object", additionalProperties: false };
    const siblings = { properties: { a: { type: "string" } } };
    // {a:'x'} is rejected by the referenced closed empty object. Merging
    // properties into it would silently allow that value instead.
    expect(
      project({
        $ref: "#/$defs/closed",
        ...siblings,
        $defs: { closed: target },
      }),
    ).toEqual({
      allOf: [target, siblings],
    });
  });

  it("merges independent scalar refinements but keeps overlapping bounds and distinct patterns", () => {
    expect(
      project({
        $ref: "#/$defs/name",
        pattern: "^\\S+$",
        type: "string",
        $defs: { name: { type: "string", minLength: 1 } },
      }),
    ).toEqual({ type: "string", minLength: 1, pattern: "^\\S+$" });
    for (const [base, extra] of [
      [{ type: "string", minLength: 3 }, { minLength: 1 }],
      [{ type: "string", pattern: "^a" }, { pattern: "z$" }],
    ]) {
      expect(
        project({ $ref: "#/$defs/base", ...extra, $defs: { base } }),
      ).toEqual({ allOf: [base, extra] });
    }
  });

  it("resolves references inside constraining siblings without weakening either bound", () => {
    expect(
      project({
        $ref: "#/$defs/base",
        maxLength: 3,
        not: { $ref: "#/$defs/forbidden" },
        $defs: {
          base: { type: "string", minLength: 2 },
          forbidden: { const: "no" },
        },
      }),
    ).toEqual({
      allOf: [
        { type: "string", minLength: 2 },
        { maxLength: 3, not: { const: "no" } },
      ],
    });
  });
});

it("retains field-local annotations when compacted definitions are inlined or shared", () => {
  const base = {
    type: "string",
    maxLength: 256,
    description: "Long shared contract. ".repeat(12),
  };
  for (const fields of [["a"], ["a", "b"]]) {
    const schema = compactSchema({
      type: "object",
      properties: Object.fromEntries(
        fields.map((name) => [
          name,
          { $ref: "#/$defs/base", description: `Field ${name}` },
        ]),
      ),
      $defs: { base },
    });
    expect(inlineSchema(schema)).toEqual({
      type: "object",
      properties: Object.fromEntries(
        fields.map((name) => [name, { ...base, description: `Field ${name}` }]),
      ),
    });
  }
});
