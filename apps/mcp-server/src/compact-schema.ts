/** Deduplicate structurally identical generated subschemas, not authored values.
 * Zod's reused:ref handles shared identities; bounded RichText creates distinct
 * but equal schemas, so identity-only reuse can still produce 100 KB edits. */
export function compactSchema(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const definitions: Record<string, unknown> = {};
  const interned = new Map<string, string>();
  const occupied = new Set(Object.keys((input.$defs ?? {}) as object));
  let next = 0;
  const originalDefs = (input.$defs ?? {}) as Record<string, unknown>;
  const resolved = new Map<string, unknown>();
  const resolving = new Set<string>();
  let recursive = false;
  const visit = (value: unknown, root = false): unknown => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return value;
    const schema = { ...(value as Record<string, unknown>) };
    if (root) delete schema.$defs;
    if (typeof schema.$ref === "string" && schema.$ref.startsWith("#/$defs/")) {
      const name = schema.$ref.slice("#/$defs/".length);
      const siblings = { ...schema };
      delete siblings.$ref;
      const withSiblings = (target: unknown) =>
        Object.keys(siblings).length
          ? { allOf: [target, visit(siblings)] }
          : target;
      if (resolved.has(name)) return withSiblings(resolved.get(name));
      if (resolving.has(name) || originalDefs[name] === undefined) {
        recursive = true;
        return schema;
      }
      resolving.add(name);
      const target = visit(originalDefs[name]);
      resolving.delete(name);
      resolved.set(name, target);
      return withSiblings(target);
    }
    for (const key of [
      "properties",
      "patternProperties",
      "$defs",
      "dependentSchemas",
    ]) {
      const map = schema[key];
      if (map && typeof map === "object")
        schema[key] = Object.fromEntries(
          Object.entries(map).map(([name, child]) => [name, visit(child)]),
        );
    }
    for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
      if (Array.isArray(schema[key]))
        schema[key] = schema[key].map((child: unknown) => visit(child));
    }
    for (const key of [
      "items",
      "additionalProperties",
      "contains",
      "not",
      "if",
      "then",
      "else",
      "propertyNames",
    ]) {
      if (schema[key] !== undefined) schema[key] = visit(schema[key]);
    }
    const serialized = JSON.stringify(schema);
    if (root || serialized.length < 160) return schema;
    let name = interned.get(serialized);
    if (!name) {
      do {
        name = `compact${next++}`;
      } while (occupied.has(name));
      occupied.add(name);
      interned.set(serialized, name);
      definitions[name] = schema;
    }
    return { $ref: `#/$defs/${name}` };
  };
  const result = visit(input, true) as Record<string, unknown>;
  if (recursive) return input;
  // A definition used once adds an indirection and bytes without deduplication.
  // Count only generated references; authored examples/defaults are opaque.
  const counts = new Map<string, number>();
  const children = (
    schema: Record<string, unknown>,
    visitChild: (value: unknown) => unknown,
  ) => {
    for (const key of ["properties", "patternProperties", "dependentSchemas"])
      if (schema[key] && typeof schema[key] === "object")
        schema[key] = Object.fromEntries(
          Object.entries(schema[key] as object).map(([k, v]) => [
            k,
            visitChild(v),
          ]),
        );
    for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"])
      if (Array.isArray(schema[key])) schema[key] = schema[key].map(visitChild);
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
      if (schema[key] !== undefined) schema[key] = visitChild(schema[key]);
    return schema;
  };
  const count = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const schema = value as Record<string, unknown>;
    if (typeof schema.$ref === "string")
      counts.set(schema.$ref, (counts.get(schema.$ref) ?? 0) + 1);
    return children(schema, count);
  };
  count(result);
  Object.values(definitions).forEach(count);
  const inline = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const schema = value as Record<string, unknown>;
    const ref = schema.$ref;
    if (
      typeof ref === "string" &&
      counts.get(ref) === 1 &&
      definitions[ref.slice(8)]
    )
      return inline(definitions[ref.slice(8)]);
    return children(schema, inline);
  };
  const compacted = inline(result) as Record<string, unknown>;
  const shared = Object.fromEntries(
    Object.entries(definitions)
      .filter(([name]) => (counts.get(`#/$defs/${name}`) ?? 0) > 1)
      .map(([name, schema]) => [name, inline(schema)]),
  );
  if (Object.keys(shared).length) compacted.$defs = shared;
  return compacted;
}
