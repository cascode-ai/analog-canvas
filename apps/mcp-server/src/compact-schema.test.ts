import { describe, expect, it } from "vitest";
import { compactSchema } from "./compact-schema.js";

describe("schema compaction", () => {
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
