import { z } from "zod";

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
          ["action", "operation", "kind"].includes(String(child.path.at(-1))) &&
          atPath(input, [...path, ...child.path]) !== undefined,
      ),
  );
}

/** Select only unambiguous discriminator-compatible branches; never guess by score. */
export function inputIssues(
  issues: readonly Issue[],
  input: unknown,
  prefix: PropertyKey[] = [],
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
        return inputIssues(compatible[0]!, input, path);
    }
    return [{ path, code: issue.code, message: issue.message }];
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
          : { branches: issue.errors.length }
        : {}),
    };
  });
}
