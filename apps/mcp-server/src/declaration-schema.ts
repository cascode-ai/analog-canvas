import { inlineSchema } from "./inline-schema.js";
import type { Schema } from "./tool-contracts.js";

/** Projection of generated Zod schemas for hosts lacking prefixItems. Canonical
 * resources and runtime validators remain unchanged. Zod emits fixed tuples
 * without items/minItems/maxItems; expose that runtime length explicitly. */
export function declarationSchema(input: Schema, tool?: string): Schema {
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const schema = { ...(value as Schema) };
    // Only the bounded recursive RichText payload is deferred. Keep every action,
    // wrapper, plain-string alternative, target and position directly callable.
    // The complete original remains in describe_tool and the contract resource.
    if (
      tool === "circuit_text" &&
      schema.type === "object" &&
      schema.properties &&
      Object.keys(schema.properties as object).length === 1 &&
      "runs" in (schema.properties as object)
    ) {
      return {
        type: "object",
        description:
          "RichText document, not arbitrary properties. Exact text contract: describe_tool({tool:'circuit_text',operations:[action kind],field:'/actions/*/text'}). Plain strings are also accepted where declared. Full runtime validation applies.",
        additionalProperties: true,
      };
    }
    if (
      Array.isArray(schema.prefixItems) &&
      schema.prefixItems.length > 0 &&
      (schema.items === false || schema.items === undefined)
    ) {
      const first = schema.prefixItems[0];
      if (
        schema.prefixItems.every(
          (item) => JSON.stringify(item) === JSON.stringify(first),
        )
      ) {
        schema.minItems ??= schema.prefixItems.length;
        schema.maxItems = Math.min(
          typeof schema.maxItems === "number" ? schema.maxItems : Infinity,
          schema.prefixItems.length,
        );
        schema.items = first;
        delete schema.prefixItems;
      }
    }
    for (const key of ["properties", "patternProperties", "dependentSchemas"])
      if (schema[key] && typeof schema[key] === "object")
        schema[key] = Object.fromEntries(
          Object.entries(schema[key] as object).map(([k, v]) => [k, visit(v)]),
        );
    for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"])
      if (Array.isArray(schema[key])) schema[key] = schema[key].map(visit);
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
      if (schema[key] !== undefined) schema[key] = visit(schema[key]);
    return schema;
  };
  return visit(inlineSchema(input)) as Schema;
}
