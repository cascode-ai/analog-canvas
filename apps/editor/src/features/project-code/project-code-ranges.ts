import { parser } from "@lezer/json";

type SyntaxNode = ReturnType<typeof parser.parse>["topNode"];

/** A span of Project Code, as character offsets. */
export interface ProjectCodeRange {
  from: number;
  to: number;
}

function propertyValue(
  object: SyntaxNode,
  name: string,
  source: string,
): SyntaxNode | null {
  for (let child = object.firstChild; child; child = child.nextSibling) {
    if (child.name !== "Property") continue;
    const key = child.getChild("PropertyName");
    if (key && stringAt(key, source) === name) return child.lastChild;
  }
  return null;
}

function stringAt(node: SyntaxNode | null, source: string): string | null {
  if (!node || (node.name !== "String" && node.name !== "PropertyName"))
    return null;
  try {
    const value: unknown = JSON.parse(source.slice(node.from, node.to));
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function objectsIn(node: SyntaxNode | null): SyntaxNode[] {
  const objects: SyntaxNode[] = [];
  if (node?.name !== "Array") return objects;
  for (let child = node.firstChild; child; child = child.nextSibling)
    if (child.name === "Object") objects.push(child);
  return objects;
}

/**
 * Where the selected parts of one Cell sit in Project Code: each part's whole
 * JSON object. Another Cell can use the same part id, so the Cell is found
 * first, by its own id. Text that does not parse yields what it can.
 */
export function projectCodeInstanceRanges(
  source: string,
  documentId: string,
  instanceIds: readonly string[],
): ProjectCodeRange[] {
  if (instanceIds.length === 0) return [];
  const wanted = new Set(instanceIds);
  const root = parser.parse(source).topNode.getChild("Object");
  if (!root) return [];
  const cell = objectsIn(propertyValue(root, "documents", source)).find(
    (candidate) =>
      stringAt(propertyValue(candidate, "id", source), source) === documentId,
  );
  if (!cell) return [];
  return objectsIn(propertyValue(cell, "instances", source)).flatMap(
    (instance) => {
      const id = stringAt(propertyValue(instance, "id", source), source);
      return id !== null && wanted.has(id)
        ? [{ from: instance.from, to: instance.to }]
        : [];
    },
  );
}
