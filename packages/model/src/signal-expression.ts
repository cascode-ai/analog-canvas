import type { ConnectivityEvidence, SchematicDocument } from "./schema.js";
import { foldNetName } from "./net-name.js";

/** Read the ordered scalar endpoints represented by the placed leader of a collapsed group. */
export function collapsedArrayGroup(
  document: SchematicDocument,
  instanceId: string,
) {
  return document.instanceGroups?.find(
    (group) => group.collapsed && group.memberIds[0] === instanceId,
  );
}

export function collapsedArrayReference(
  document: SchematicDocument,
  instanceId: string,
): string | undefined {
  const group = collapsedArrayGroup(document, instanceId);
  if (!group) return undefined;
  const byId = new Map(
    document.instances.map((instance) => [instance.id, instance.reference]),
  );
  const names = group.memberIds.map((id) => byId.get(id));
  const first = names[0] ?? "";
  const prefix = group.referencePrefix ?? first.replace(/\d+$/u, "");
  for (let length = prefix.length; length < first.length; length++) {
    const candidate = first.slice(0, length);
    if (group.referencePrefix && candidate !== prefix) break;
    const suffix = first.slice(length);
    if (!/^\d+$/u.test(suffix)) break;
    const start = Number(suffix);
    const step = names[1] === candidate + (start + 1) ? 1 : -1;
    const last = start + (names.length - 1) * step;
    if (
      last >= 0 &&
      names.every((name, index) => name === candidate + (start + index * step))
    )
      return candidate + "<" + start + ":" + last + ">";
  }
  return undefined;
}

/** Read-only scalar names from each owner; no copied editable name claims. */
export function scalarConnectivityEvidence(
  document: SchematicDocument,
): ConnectivityEvidence[] {
  return document.connectivityEvidence.flatMap((evidence) =>
    evidence.kind === "name-claim" && evidence.signal
      ? evidence.signal.members.map((member) => ({
          ...evidence,
          id: `${evidence.id}/${member.id}`,
          netId: member.netId,
          name: member.name,
          signal: undefined,
        }))
      : [evidence],
  );
}

/** Inclusive electrical order for an explicitly authored range. */
export function orderedSignalIndices(first: number, last: number): number[] {
  if (
    ![first, last].every(
      (index) => Number.isSafeInteger(index) && index >= 0 && index <= 65535,
    )
  )
    throw new Error("Signal indices must be between 0 and 65535");
  const width = Math.abs(first - last) + 1;
  if (width > 256) throw new Error("A signal may contain at most 256 members");
  const step = last < first ? -1 : 1;
  return Array.from(
    { length: width },
    (_, position) => first + position * step,
  );
}

/** The explicitly authored signal grammar. Loading names never calls this parser. */
export function parseSignalExpression(expression: string): readonly string[] {
  const text = expression.trim();
  if (!text || text.length > 256)
    throw new Error("A signal expression needs 1–256 characters");
  const terms: string[] = [];
  let start = 0;
  let indexed = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "<") {
      if (indexed) throw new Error("Nested signal brackets are not supported");
      indexed = true;
    } else if (character === ">") {
      if (!indexed) throw new Error("Signal brackets must be paired");
      indexed = false;
    } else if (character === "," && !indexed) {
      terms.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (indexed) throw new Error("Signal brackets must be paired");
  terms.push(text.slice(start).trim());
  const members: string[] = [];
  for (const term of terms) {
    const match = /^([^<>\[\]\s:,]+)<([^<>]+)>$/u.exec(term);
    if (!match) {
      if (!term || /[<>\[\]\s:,]/u.test(term))
        throw new Error(
          "Use scalar names, NAME<index>, ranges or ordered index lists",
        );
      members.push(term);
    } else {
      for (const selection of match[2]!.split(",")) {
        const indices = /^(\d+)(?::(\d+))?$/u.exec(selection);
        if (!indices)
          throw new Error(
            "Signal indices must be integers or inclusive ranges",
          );
        const first = Number(indices[1]);
        const last = Number(indices[2] ?? indices[1]);
        const ordered = orderedSignalIndices(first, last);
        if (members.length + ordered.length > 256)
          throw new Error("A signal may contain at most 256 members");
        members.push(...ordered.map((index) => `${match[1]}<${index}>`));
      }
    }
    if (members.length > 256)
      throw new Error("A signal may contain at most 256 members");
  }
  if (new Set(members.map(foldNetName)).size !== members.length)
    throw new Error("Signal members must be unique");
  return members;
}

/** Display only: the ordered identities remain the binding, not this short text. */
export function formatSignalMembers(names: readonly string[]): string {
  const indexed = names.map((name) => /^([^<>]+)<(\d+)>$/u.exec(name));
  const first = indexed[0];
  if (!first || indexed.some((member) => !member || member[1] !== first[1]))
    return names.join(",");
  const indices = indexed.map((member) => Number(member![2]));
  const step = indices.length > 1 ? indices[1]! - indices[0]! : 0;
  const contiguous =
    Math.abs(step) === 1 &&
    indices.every((value, index) => value === indices[0]! + index * step);
  return `${first[1]}<${contiguous ? `${indices[0]}:${indices.at(-1)}` : indices.join(",")}>`;
}
