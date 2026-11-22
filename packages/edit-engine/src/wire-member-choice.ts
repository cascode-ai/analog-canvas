import type { SymbolResolver } from "@icm/symbols";
import { resolveArrayWirePair } from "./instance-array-wire.js";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { isFreeWireAnchor, type WireSource } from "./wire-commit-planner.js";
import {
  foldNetName,
  parseSignalExpression,
  type SchematicDocument,
} from "@icm/model";

export interface WireMemberOption {
  id: string;
  label: string;
}
export interface WireMemberChoice {
  source: WireSource;
  options: readonly WireMemberOption[];
  allowWhole: boolean;
  sharedPinLabel?: string;
  expectedWidth?: number;
}
export type WireMemberEvaluation =
  | { kind: "ready"; from: WireSource; to: WireSource }
  | { kind: "choose"; side: "from" | "to"; choice: WireMemberChoice }
  | { kind: "invalid"; message: string };

export function selectWireMember(
  source: WireSource,
  memberId: string,
): WireSource {
  const member = source.members?.find((item) => item.id === memberId);
  if (!member) throw new Error("That bus member is no longer available");
  const { members: _members, ...scalar } = source;
  const endpoint = { ...source.endpoint, memberId };
  return {
    ...scalar,
    endpoint,
    netId: member.netId,
    connection: { ...source.connection, endpoint },
  };
}

/** Resolve explicit ordered identities without changing the source's split/geometry prelude. */
export function selectWireMembers(
  source: WireSource,
  memberIds: readonly string[],
): WireSource {
  if (!memberIds.length || memberIds.length > 256)
    throw new Error("Select between 1 and 256 available bus members");
  if (new Set(memberIds).size !== memberIds.length)
    throw new Error("A selection must contain unique member identities");
  if (memberIds.length === 1) return selectWireMember(source, memberIds[0]!);
  const members = memberIds.map((id) => {
    const member = source.members?.find((item) => item.id === id);
    if (!member) throw new Error("That bus member is no longer available");
    return member;
  });
  return {
    ...source,
    members,
    netId: members[0]!.netId,
    memberSelection:
      source.memberSelection ||
      members.length !== source.members!.length ||
      members.some((member, index) => member.id !== source.members![index]!.id),
  };
}

/** An expression selects within this concrete source; it never names or joins its Nets. */
export function selectWireExpression(
  document: SchematicDocument,
  source: WireSource,
  expression: string,
): WireSource {
  const options = wireMemberChoice(document, source, true).options;
  let text = expression.trim();
  if (text.startsWith("<")) {
    const bases = new Set(
      options.map((option) => {
        const base = /^([^<>]+)<\d+>$/u.exec(option.label)?.[1];
        return base === undefined ? undefined : foldNetName(base);
      }),
    );
    if (bases.size !== 1 || bases.has(undefined))
      throw new Error(
        "A shorthand selection requires one explicit indexed source context",
      );
    text = `${[...bases][0]}${text}`;
  }
  const names = parseSignalExpression(text);
  return selectWireMembers(
    source,
    names.map((name) => {
      const matches = options.filter(
        (option) => foldNetName(option.label) === foldNetName(name),
      );
      if (matches.length !== 1)
        throw new Error(
          `Member ${name} is ${matches.length ? "ambiguous" : "not available"} in this source`,
        );
      return matches[0]!.id;
    }),
  );
}

export function wireMemberChoice(
  document: SchematicDocument,
  source: WireSource,
  allowWhole: boolean,
): WireMemberChoice {
  const logical = resolveDocumentLogicalNets(document);
  return {
    source,
    allowWhole,
    options: (source.members ?? []).map((member, index) => ({
      id: member.id,
      label:
        logical.byBaseNetId.get(member.netId)?.name ??
        member.name ??
        `Member ${index + 1}`,
    })),
  };
}

/** The one electrical choice shared by hover and click. Child formal names are display hints only. */
export function evaluateWireMembers(
  document: SchematicDocument,
  from: WireSource,
  to: WireSource,
  resolver?: SymbolResolver,
  shareArrayPin = false,
): WireMemberEvaluation {
  if (resolver && document.instanceGroups?.length) {
    const adapted = resolveArrayWirePair(
      document,
      resolver,
      from,
      to,
      shareArrayPin,
    );
    if (adapted.kind !== "ready") return adapted;
    from = adapted.from;
    to = adapted.to;
  }
  if (from.members && to.members) {
    if (from.members.length === to.members.length)
      return { kind: "ready", from, to };
    const side = from.members.length > to.members.length ? "from" : "to";
    return {
      kind: "choose",
      side,
      choice: {
        ...wireMemberChoice(document, side === "from" ? from : to, false),
        expectedWidth: Math.min(from.members.length, to.members.length),
      },
    };
  }
  if (!from.members && !to.members) return { kind: "ready", from, to };
  const side = from.members ? "from" : "to";
  const aggregate = from.members ? from : to;
  const scalar = from.members ? to : from;
  if (isFreeWireAnchor(scalar) && scalar.declaredScalarName === undefined)
    return { kind: "ready", from, to };
  const logical = resolveDocumentLogicalNets(document);
  const scalarName =
    scalar.declaredScalarName ??
    (scalar.netId ? logical.byBaseNetId.get(scalar.netId)?.name : undefined);
  const matches = aggregate.members!.filter(
    (member) =>
      member.netId === scalar.netId ||
      (scalarName !== undefined &&
        foldNetName(scalarName) ===
          foldNetName(logical.byBaseNetId.get(member.netId)?.name ?? "")),
  );
  if (matches.length === 1) {
    const selected = selectWireMember(aggregate, matches[0]!.id);
    return {
      kind: "ready",
      from: side === "from" ? selected : from,
      to: side === "to" ? selected : to,
    };
  }
  return {
    kind: "choose",
    side,
    choice: {
      ...wireMemberChoice(document, aggregate, false),
      expectedWidth: 1,
    },
  };
}
