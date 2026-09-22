import { z } from "zod";

/** Describe caller input, not the value after defaults/transforms have run. */
export function inputContract(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    io: "input",
    target: "draft-2020-12",
    reused: "ref",
  });
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
      const compatible = issue.errors.filter(
        (branch) =>
          !branch.some(
            (child) =>
              (child.code === "invalid_value" ||
                (child.code === "invalid_union" &&
                  child.errors.length === 0)) &&
              ["action", "operation", "kind"].includes(
                String(child.path.at(-1)),
              ) &&
              atPath(input, [...path, ...child.path]) !== undefined,
          ),
      );
      if (compatible.length === 1)
        return inputIssues(compatible[0]!, input, path);
    }
    return [{ path, code: issue.code, message: issue.message }];
  });
}

/** Preserve nested diagnostics without copying submitted values into errors. */
export function inputIssueDetails(issues: readonly Issue[]): unknown[] {
  return issues.map((issue) => ({
    path: issue.path,
    code: issue.code,
    message: issue.message,
    ...(issue.code === "invalid_union"
      ? { errors: issue.errors.map(inputIssueDetails) }
      : {}),
  }));
}
