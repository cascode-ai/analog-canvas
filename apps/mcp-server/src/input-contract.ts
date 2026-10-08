import { z } from "zod";
import { inlineSchema } from "./inline-schema.js";
import { node, operationTags, properties, variants } from "./tool-contracts.js";

/** Describe caller input, not the value after defaults/transforms have run. */
export function inputContract(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    io: "input",
    target: "draft-2020-12",
    reused: "ref",
  });
}

const contracts = new WeakMap<z.ZodType, Record<string, unknown>>();
const objectContracts = new WeakMap<z.ZodType, Record<string, unknown>>();

/**
 * A tool's input contract as JSON Schema, converted on first read and kept.
 * Converting every tool's contract when the server loaded cost each CLI
 * call most of a second before its first request (#1227); listing tools and
 * describe_tool read them, a call does not. `object` marks the top level as
 * an object for hosts that require it.
 */
export function lazyContract(
  schema: z.ZodType,
  object = false,
): Record<string, unknown> {
  const cache = object ? objectContracts : contracts;
  let built = cache.get(schema);
  if (!built) {
    built = object
      ? { ...inputContract(schema), type: "object" }
      : inputContract(schema);
    cache.set(schema, built);
  }
  return built;
}

type Issue = z.core.$ZodIssue;
function atPath(input: unknown, path: PropertyKey[]): unknown {
  return path.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === "object"
        ? (value as Record<PropertyKey, unknown>)[key]
        : undefined,
    input,
  );
}

const TAGS = ["action", "operation", "kind"];

function compatibleBranches(
  issue: z.core.$ZodIssueInvalidUnion,
  input: unknown,
  path: PropertyKey[],
) {
  return issue.errors.filter(
    (branch) =>
      !branch.some(
        (child) =>
          (child.code === "invalid_value" ||
            (child.code === "invalid_union" && child.errors.length === 0)) &&
          TAGS.includes(String(child.path.at(-1))) &&
          atPath(input, [...path, ...child.path]) !== undefined,
      ),
  );
}

type ContractNode = Record<string, unknown>;

/** The object branches the value at `path` may take, from the tool's contract. */
function objectsAt(
  contract: ContractNode,
  path: readonly PropertyKey[],
): ContractNode[] {
  let schemas: ContractNode[];
  try {
    schemas = [inlineSchema(contract)];
  } catch {
    return [];
  }
  for (const step of path)
    schemas = schemas.flatMap(variants).flatMap((schema) => {
      const child =
        typeof step === "number"
          ? schema.items
          : properties(schema)[String(step)];
      return child === undefined ? [] : [node(child)];
    });
  return schemas.flatMap(variants).filter((schema) => schema.properties);
}

/**
 * The keys the object at `path` takes, from the tool's contract: those of
 * the branches its own kind, action or operation selects, else of every
 * branch there. A contract that cannot be inlined lists none.
 */
function allowedKeys(
  contract: ContractNode,
  path: readonly PropertyKey[],
  input: unknown,
): string[] {
  const objects = objectsAt(contract, path);
  const value = node(atPath(input, [...path]));
  const selected = objects.filter((schema) => {
    const tag = operationTags(schema);
    const own = tag && value[tag.key];
    return own === undefined || tag!.values.includes(own as string);
  });
  return [
    ...new Set(
      (selected.length ? selected : objects).flatMap((schema) =>
        Object.keys(properties(schema)),
      ),
    ),
  ].sort();
}

type Tag = { key: string; values: string[] };
const strings = (values: readonly unknown[] | undefined) =>
  (values ?? []).filter((value): value is string => typeof value === "string");

/**
 * The kind, action or operation a union refused because no branch takes it
 * (#1525): a discriminated union names its tag, a plain one refuses the same
 * tag in every branch. `own` marks an issue whose path ends at the tag.
 */
function refusedTag(issue: Issue): (Tag & { own: boolean }) | undefined {
  if (issue.code !== "invalid_union") return undefined;
  if (!issue.errors.length) {
    const values = "options" in issue ? strings(issue.options) : [];
    return typeof issue.discriminator === "string" && values.length
      ? { key: issue.discriminator, values, own: true }
      : undefined;
  }
  const tags = issue.errors.map((branch) => {
    for (const child of branch) {
      const nested = refusedTag(child);
      if (!child.path.length && nested && !nested.own) return nested;
      if (child.path.length !== 1 || !TAGS.includes(String(child.path[0])))
        continue;
      if (child.code === "invalid_value")
        return { key: String(child.path[0]), values: strings(child.values) };
      if (nested?.own) return nested;
    }
    return undefined;
  });
  const key = tags[0]?.key;
  return key && tags.every((tag) => tag?.key === key)
    ? {
        key,
        values: [...new Set(tags.flatMap((tag) => tag!.values))],
        own: false,
      }
    : undefined;
}

/**
 * The tag values the contract declares for the object at `path`: a focused
 * tool's contract lists only its own. A focused simulation tool may name some
 * `operation` and others `action`, aliases its calls accept alike.
 */
function declaredTag(
  contract: ContractNode,
  path: readonly PropertyKey[],
  key: string,
): Tag | undefined {
  const tags = objectsAt(contract, path).flatMap(
    (schema) => operationTags(schema) ?? [],
  );
  const values = [...new Set(tags.flatMap((tag) => tag.values))];
  return values.length
    ? {
        key: tags.some((tag) => tag.key === key) ? key : tags[0]!.key,
        values,
      }
    : undefined;
}

const LIST_LIMIT = 40;
function listed(items: readonly unknown[]): string {
  const shown = items.slice(0, LIST_LIMIT).map(String).join(", ");
  return items.length > LIST_LIMIT ? `${shown}, …` : shown;
}
function counted(count: number, origin: string | undefined): string {
  const unit =
    origin === "string" ? "character" : origin === "array" ? "item" : null;
  return unit ? `${count} ${unit}${count === 1 ? "" : "s"}` : String(count);
}
/** zod's own wording; a schema's own message is kept. */
const DEFAULT_MESSAGE =
  /^(Invalid input|Invalid option|Invalid discriminator|Too big|Too small|Unrecognized key)/u;

/**
 * What the validator knows beyond the rule that failed (#1464): the keys it
 * did not know and the ones it does, the values, limits or type it takes;
 * never the submitted value itself.
 */
function issueFacts(
  issue: Issue,
  path: readonly PropertyKey[],
  input: unknown,
  contract: ContractNode | undefined,
): { message: string; facts: Record<string, unknown> } | null {
  switch (issue.code) {
    case "unrecognized_keys": {
      const allowed = contract ? allowedKeys(contract, path, input) : [];
      return {
        message: `Unknown key${issue.keys.length === 1 ? "" : "s"} ${issue.keys
          .map((key) => `"${key}"`)
          .join(", ")}${allowed.length ? `; allowed: ${listed(allowed)}` : ""}`,
        facts: { keys: issue.keys, ...(allowed.length ? { allowed } : {}) },
      };
    }
    case "invalid_value":
      return {
        message: `Expected one of: ${listed(issue.values)}`,
        facts: { values: issue.values },
      };
    case "too_big": {
      const maximum = Number(issue.maximum);
      const inclusive = issue.inclusive !== false;
      return {
        message: inclusive
          ? `At most ${counted(maximum, issue.origin)}`
          : `Must be less than ${counted(maximum, issue.origin)}`,
        facts: { maximum, inclusive },
      };
    }
    case "too_small": {
      const minimum = Number(issue.minimum);
      const inclusive = issue.inclusive !== false;
      return {
        message: inclusive
          ? `At least ${counted(minimum, issue.origin)}`
          : `Must be more than ${counted(minimum, issue.origin)}`,
        facts: { minimum, inclusive },
      };
    }
    case "invalid_type":
      return {
        message: `Expected ${issue.expected}`,
        facts: { expected: issue.expected },
      };
    case "custom":
    case "invalid_element":
    case "invalid_format":
    case "invalid_key":
    case "invalid_union":
    case "not_multiple_of":
      return null;
  }
}

/** Select only unambiguous discriminator-compatible branches; never guess by score. */
export function inputIssues(
  issues: readonly Issue[],
  input: unknown,
  prefix: PropertyKey[] = [],
  contract?: ContractNode,
): {
  path: PropertyKey[];
  code: string;
  message: string;
}[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    if (issue.code === "invalid_union" && issue.errors.length) {
      const compatible = compatibleBranches(issue, input, path);
      if (compatible.length === 1)
        return inputIssues(compatible[0]!, input, path, contract);
    }
    const tag = refusedTag(issue);
    if (tag) {
      // A missing or unknown tag answers with the ones this tool takes.
      const object = tag.own ? path.slice(0, -1) : path;
      const { key, values } =
        (contract && declaredTag(contract, object, tag.key)) || tag;
      const missing = atPath(input, [...object, tag.key]) === undefined;
      return [
        {
          path: [...object, key],
          code: issue.code,
          message: DEFAULT_MESSAGE.test(issue.message)
            ? `${missing ? "Missing" : "Unknown"} "${key}"; expected one of: ${listed(values)}`
            : issue.message,
          values,
        },
      ];
    }
    const known = issueFacts(issue, path, input, contract);
    return [
      {
        path,
        code: issue.code,
        message:
          known &&
          (issue.code === "unrecognized_keys" ||
            DEFAULT_MESSAGE.test(issue.message))
            ? known.message
            : issue.message,
        ...known?.facts,
      },
    ];
  });
}

/** Keep the selected branch; ambiguous unions report a count, never guesses. */
export function inputIssueDetails(
  issues: readonly Issue[],
  input: unknown,
  prefix: PropertyKey[] = [],
): unknown[] {
  return issues.map((issue) => {
    const branches =
      issue.code === "invalid_union"
        ? compatibleBranches(issue, input, [...prefix, ...issue.path])
        : [];
    return {
      path: issue.path,
      code: issue.code,
      message: issue.message,
      ...(issue.code === "invalid_union"
        ? branches.length === 1
          ? {
              errors: [
                inputIssueDetails(branches[0]!, input, [
                  ...prefix,
                  ...issue.path,
                ]),
              ],
            }
          : issue.errors.length
            ? { branches: issue.errors.length }
            : {}
        : {}),
    };
  });
}
