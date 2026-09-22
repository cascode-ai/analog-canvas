/** Host-facing schemas must not require a reference-expansion budget.
 * Complete resource contracts may still use compact local references.
 * This is representation only: constraints and runtime parsing stay intact. */
export function inlineSchema(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const defs = (input.$defs ?? {}) as Record<string, unknown>;
  const resolving = new Set<string>();
  const resolved = new Map<string, unknown>();
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const schema = { ...(value as Record<string, unknown>) };
    delete schema.$defs;
    if (typeof schema.$ref === "string") {
      const ref = schema.$ref;
      if (!ref.startsWith("#/$defs/") || resolving.has(ref))
        throw new Error("Unsupported schema reference");
      const target = defs[ref.slice(8)];
      if (target === undefined) throw new Error("Missing schema reference");
      if (!resolved.has(ref)) {
        resolving.add(ref);
        resolved.set(ref, visit(target));
        resolving.delete(ref);
      }
      delete schema.$ref;
      const base = resolved.get(ref) as Record<string, unknown>;
      const siblings = visit(schema) as Record<string, unknown>;
      // Metadata does not constrain values. Keep it on the actual typed node,
      // not a metadata-only allOf branch that hosts render as unknown.
      const metadata = new Set(["description", "title", "default", "examples"]);
      return Object.keys(siblings).every(
        (key) => !(key in base) || metadata.has(key),
      )
        ? { ...base, ...siblings }
        : { allOf: [base, siblings] };
    }
    for (const key of ["properties", "patternProperties", "dependentSchemas"]) {
      const children = schema[key];
      if (children && typeof children === "object")
        schema[key] = Object.fromEntries(
          Object.entries(children).map(([name, child]) => [name, visit(child)]),
        );
    }
    for (const key of ["oneOf", "anyOf", "allOf", "prefixItems"]) {
      if (Array.isArray(schema[key])) schema[key] = schema[key].map(visit);
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
    return schema;
  };
  return visit(input) as Record<string, unknown>;
}
