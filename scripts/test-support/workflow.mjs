import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { parsers } from "prettier/plugins/yaml";

// Use the formatter's parser so flow/block collections and quoted scalars
// describe the same workflow. Scalar values remain strings in this AST.
export async function workflow(path) {
  const ast = await parsers.yaml.parse(await readFile(path, "utf8"));
  function value(node) {
    if (!node) return null;
    if (["mapping", "flowMapping"].includes(node.type))
      return Object.fromEntries(
        node.children.map((item) => item.children.map(value)),
      );
    if (["sequence", "flowSequence"].includes(node.type))
      return node.children.map(value);
    if (Object.hasOwn(node, "value")) return node.value;
    return value(node.children?.[0]);
  }
  return value(
    ast.children[0].children.find((node) => node.type === "documentBody"),
  );
}

export function permitsCondition(
  condition,
  context,
  { successful = true, cancelled = false } = {},
) {
  const expression = (condition ?? "success()").replace(
    /^\$\{\{\s*|\s*\}\}$/gu,
    "",
  );
  // Actions adds success() unless the condition contains a status function.
  if (
    !/\b(?:always|success|failure|cancelled)\s*\(/u.test(expression) &&
    (!successful || cancelled)
  )
    return false;
  return Boolean(
    runInNewContext(
      expression,
      {
        ...context,
        success: () => successful && !cancelled,
        cancelled: () => cancelled,
        always: () => true,
        failure: () => !successful,
      },
      { timeout: 100 },
    ),
  );
}
