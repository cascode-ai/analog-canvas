import { z } from "zod";
import { compactSchema } from "./compact-schema.js";
import { inlineSchema } from "./inline-schema.js";

export type Schema = Record<string, unknown>;
export interface ContractTool {
  name: string;
  description: string;
  inputSchema: Schema;
}

export const DescribeToolArgs = z
  .strictObject({
    tool: z.string().min(1).optional(),
    operations: z.array(z.string().min(1)).min(1).max(64).optional(),
    field: z
      .string()
      .startsWith("/")
      .optional()
      .describe(
        "Argument JSON Pointer, not a schema-keyword path; use * for array elements, e.g. /actions/*/kind. Select operations to disambiguate.",
      ),
    editKind: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Canonical low-level edit kind, not an apply_actions action. Returns the existing edit contract and its transaction guidance.",
      ),
  })
  .superRefine((value, context) => {
    if ((value.operations || value.field) && !value.tool)
      context.addIssue({
        code: "custom",
        path: ["tool"],
        message: "tool is required for operations or field",
      });
    if (value.editKind && (value.tool || value.operations || value.field))
      context.addIssue({
        code: "custom",
        path: ["editKind"],
        message: "Select a tool contract or an editKind, not both",
      });
  });

export class ContractQueryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const node = (value: unknown): Schema =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Schema)
    : {};
const properties = (schema: Schema) => node(schema.properties);
const unionKey = (schema: Schema) =>
  Array.isArray(schema.oneOf)
    ? "oneOf"
    : Array.isArray(schema.anyOf)
      ? "anyOf"
      : undefined;
const operationTags = (
  schema: Schema,
): { key: string; values: string[] } | undefined => {
  for (const key of ["action", "operation", "kind"]) {
    const tag = node(properties(schema)[key]);
    if (typeof tag.const === "string") return { key, values: [tag.const] };
    if (
      Array.isArray(tag.enum) &&
      tag.enum.every((value) => typeof value === "string")
    )
      return { key, values: tag.enum as string[] };
  }
  return undefined;
};

function variants(schema: Schema): Schema[] {
  const key = unionKey(schema);
  return key ? (schema[key] as Schema[]).flatMap(variants) : [schema];
}

function selection(schema: Schema): { path: string[]; schema: Schema } {
  const p = properties(schema);
  if (p.request) return { path: ["request"], schema: node(p.request) };
  if (p.actions)
    return { path: ["actions", "*"], schema: node(node(p.actions).items) };
  if (p.target) return { path: ["target"], schema: node(p.target) };
  return { path: [], schema };
}

export function contractOperations(input: Schema): string[] {
  return [
    ...new Set(
      variants(selection(inlineSchema(input)).schema).flatMap(
        (s) => operationTags(s)?.values ?? [],
      ),
    ),
  ];
}

/** Filter the canonical union, retaining wrappers, constraints and discriminator
 * correlations. This changes discovery scope, never session permissions. */
export function selectToolSchema(
  input: Schema,
  operations?: readonly string[],
): Schema {
  const expanded = structuredClone(inlineSchema(input));
  if (!operations) return expanded;
  const selected = selection(expanded);
  const available = new Set(
    variants(selected.schema).flatMap((s) => operationTags(s)?.values ?? []),
  );
  if (operations.some((name) => !available.has(name)))
    throw new ContractQueryError(
      "UNKNOWN_CONTRACT_OPERATION",
      "Unknown operation; read this tool's operation directory.",
    );
  const names = new Set(operations);
  const filter = (schema: Schema): Schema | undefined => {
    const key = unionKey(schema);
    if (!key) {
      const tag = operationTags(schema);
      const values = tag?.values.filter((value) => names.has(value)) ?? [];
      if (!tag || !values.length) return undefined;
      if (values.length === tag.values.length) return schema;
      return {
        ...schema,
        properties: {
          ...properties(schema),
          [tag.key]: { ...node(properties(schema)[tag.key]), enum: values },
        },
      };
    }
    const branches = (schema[key] as Schema[]).flatMap((s): Schema[] => {
      const result = filter(s);
      return result ? [result] : [];
    });
    if (!branches.length) return undefined;
    if (branches.length === 1 && Object.keys(schema).length === 1)
      return branches[0];
    return { ...schema, [key]: branches };
  };
  const filtered = filter(selected.schema)!;
  if (!selected.path.length) return filtered;
  let parent = expanded;
  for (const segment of selected.path.slice(0, -1))
    parent = node(properties(parent)[segment]);
  const last = selected.path.at(-1)!;
  if (last === "*") parent.items = filtered;
  else properties(parent)[last] = filtered;
  return expanded;
}

export function selectedArgumentOperations(
  input: Schema,
  args: unknown,
): string[] {
  const { path } = selection(inlineSchema(input));
  let values: unknown[] = [args];
  for (const part of path)
    values = values.flatMap((value) =>
      part === "*" ? (Array.isArray(value) ? value : []) : [node(value)[part]],
    );
  return values.flatMap((value) => {
    const v = node(value);
    const tag = v.action ?? v.operation ?? v.kind;
    return typeof tag === "string" ? [tag] : [];
  });
}

/** Navigate argument fields, including each union alternative. Context is
 * explanatory, not a standalone parent validator; full contracts remain available. */
function fieldContracts(schema: Schema, pointer: string) {
  if (/~(?:[^01]|$)/u.test(pointer))
    throw new ContractQueryError(
      "INVALID_CONTRACT_FIELD",
      "Use a valid JSON Pointer; * selects array elements.",
    );
  const segments = pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  type Match = {
    schema: Schema;
    required: boolean | null;
    operations: string[];
    context: Schema[];
  };
  const walk = (
    current: Schema,
    remaining: string[],
    tags: string[],
    context: Schema[],
    required: boolean | null,
  ): Match[] => {
    const key = unionKey(current);
    if (key)
      return (current[key] as Schema[]).flatMap((s) =>
        walk(s, remaining, tags, context, required),
      );
    const nextTags = [...tags, ...(operationTags(current)?.values ?? [])];
    if (!remaining.length)
      return [{ schema: current, required, operations: nextTags, context }];
    const [part, ...rest] = remaining;
    const child = part === "*" ? current.items : properties(current)[part!];
    if (child === undefined) return [];
    const parentContext = Object.fromEntries(
      Object.entries(current).filter(([k]) =>
        [
          "required",
          "dependentRequired",
          "dependentSchemas",
          "if",
          "then",
          "else",
          "allOf",
          "not",
          "minItems",
          "maxItems",
        ].includes(k),
      ),
    );
    return walk(
      node(child),
      rest,
      nextTags,
      [...context, parentContext],
      part === "*"
        ? null
        : Array.isArray(current.required) && current.required.includes(part),
    );
  };
  const matches = walk(schema, segments, [], [], null);
  if (!matches.length)
    throw new ContractQueryError(
      "UNKNOWN_CONTRACT_FIELD",
      "Field not found; select an operation and use an argument path.",
    );
  return matches;
}

export class ToolContractRegistry {
  constructor(
    private readonly tools: readonly ContractTool[],
    private readonly version: string,
  ) {}

  describe(query: {
    tool?: string | undefined;
    operations?: string[] | undefined;
    field?: string | undefined;
  }) {
    if (!query.tool)
      return {
        contractVersion: this.version,
        tools: this.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          operations: contractOperations(tool.inputSchema),
          uri: `analog-canvas://contract/tools/${tool.name}`,
        })),
      };
    const tool = this.tools.find((t) => t.name === query.tool);
    if (!tool)
      throw new ContractQueryError(
        "UNKNOWN_TOOL_CONTRACT",
        "Unknown tool; query the directory without a tool name.",
      );
    const selected = selectToolSchema(tool.inputSchema, query.operations);
    const identity = {
      contractVersion: this.version,
      tool: tool.name,
      operations: query.operations ?? contractOperations(tool.inputSchema),
    };
    const result = query.field
      ? {
          ...identity,
          field: query.field,
          variants: fieldContracts(selected, query.field).map((match) => ({
            ...match,
            schema: compactSchema(match.schema),
          })),
        }
      : { ...identity, inputSchema: compactSchema(selected) };
    if (Buffer.byteLength(JSON.stringify(result)) > 96_000)
      return {
        ...identity,
        ok: false,
        error: {
          code: "CONTRACT_SELECTION_TOO_BROAD",
          message:
            "Select fewer operations or a field; no partial schema was returned.",
        },
        uri: `analog-canvas://contract/tools/${tool.name}`,
      };
    return result;
  }
}
