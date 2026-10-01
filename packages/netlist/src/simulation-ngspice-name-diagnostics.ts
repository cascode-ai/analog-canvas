import { spellGreekLetters, type SourceSpan } from "@icm/model";
import type { SimulationSourceDiagnostic } from "./simulation-source-graph.js";
import type { SimulationSourceGraph } from "./simulation-source-graph.js";

/**
 * The ASCII spelling ngspice runs authored text under. Greek letters are
 * written as their names, as Canvas netlists write them (`φ1` is `phi1`).
 * Any other character outside ASCII becomes `u` and its code point in hex
 * (`输入` is `u8f93u5165`, `né` is `nu00e9`). ngspice itself reads every such
 * byte as `_`, so two different names of equal byte length (`输入`, `输出`)
 * would merge into one node.
 */
export function spellNgspiceAuthoredText(text: string): string {
  let spelled = "";
  for (const character of spellGreekLetters(text)) {
    const code = character.codePointAt(0)!;
    spelled +=
      code < 0x80 ? character : `u${code.toString(16).padStart(4, "0")}`;
  }
  return spelled;
}

function identifierTokens(text: string): string[] {
  return [...text.matchAll(/[^\s()[\]{}=,:;]+/gu)].map((match) => match[0]!);
}

function sourceRefAt(
  sourceRef: SourceSpan,
  rawText: string,
  token: string,
  fromIndex: number,
): { sourceRef: SourceSpan; index: number } {
  const index = rawText.indexOf(token, fromIndex);
  if (index < 0) return { sourceRef, index: -1 };
  const before = rawText.slice(0, index);
  const startLine = sourceRef.start.line + (before.match(/\n/gu)?.length ?? 0);
  const lastNewline = Math.max(
    before.lastIndexOf("\n"),
    before.lastIndexOf("\r"),
  );
  const startColumn =
    (lastNewline < 0 ? sourceRef.start.column - 1 : 0) +
    before.length -
    lastNewline;
  return {
    index,
    sourceRef: {
      fileId: sourceRef.fileId,
      start: {
        offset: sourceRef.start.offset + index,
        line: startLine,
        column: startColumn,
      },
      end: {
        offset: sourceRef.start.offset + index + token.length,
        line: startLine,
        column: startColumn + token.length,
      },
    },
  };
}

function authoredIdentifierTokens(
  statement: SimulationSourceGraph["statements"][number]["statement"],
): string[] {
  switch (statement.kind) {
    case "instance":
      return [
        statement.name,
        ...statement.nodes,
        ...(statement.master ? [statement.master] : []),
        ...(statement.controlSource ? [statement.controlSource] : []),
      ];
    case "subckt_start":
      return [statement.name, ...statement.ports];
    case "global":
      return statement.names;
    case "model":
      return [statement.name, statement.modelType];
    case "directive":
    case "control_command":
      return statement.arguments;
    case "parameter":
      return statement.parameters.flatMap((parameter) => [
        parameter.name,
        parameter.rawText,
      ]);
    case "function":
      return [statement.name, ...statement.arguments, statement.rawExpression];
    case "conditional":
      return statement.rawExpression ? [statement.rawExpression] : [];
    case "opaque":
      return identifierTokens(statement.rawText);
    default:
      return [];
  }
}

interface NameReplacement {
  path: string;
  start: number;
  end: number;
  text: string;
}

export interface NgspiceAuthoredNamePreparation {
  diagnostics: SimulationSourceDiagnostic[];
  replacements: NameReplacement[];
}

/**
 * Give every non-ASCII name in authored ngspice source its ASCII spelling
 * (see `spellNgspiceAuthoredText`). Project bytes remain untouched; callers
 * apply these execution-only replacements before parsing run variants. Two
 * names that would still run under one spelling are refused.
 */
export function prepareNgspiceAuthoredNames(
  graph: SimulationSourceGraph,
): NgspiceAuthoredNamePreparation {
  const seen = new Map<string, { name: string; sourceRef: SourceSpan }>();
  const warned = new Set<string>();
  const reportedCollisions = new Set<string>();
  const replacements: NameReplacement[] = [];
  const diagnostics: SimulationSourceDiagnostic[] = [];
  const replacementKeys = new Set<string>();
  for (const { path, statement } of graph.statements) {
    let searchOffset = 0;
    for (const candidate of authoredIdentifierTokens(statement)) {
      for (const token of identifierTokens(candidate)) {
        const located = sourceRefAt(
          statement.sourceRef,
          statement.rawText,
          token,
          searchOffset,
        );
        const sourceRef = located.sourceRef;
        if (located.index >= 0) searchOffset = located.index + token.length;
        const canonical = spellNgspiceAuthoredText(token);
        // ngspice folds case, so `PHI1` and `phi1` are one node too.
        const key = canonical.toLowerCase();
        const prior = seen.get(key);
        if (
          prior &&
          prior.name !== token &&
          /[^\x00-\x7f]/u.test(token + prior.name)
        ) {
          const pair = [prior.name, token].sort().join("\u0000");
          if (!reportedCollisions.has(pair)) {
            reportedCollisions.add(pair);
            diagnostics.push({
              code: "SIMULATION_NON_ASCII_NAME_COLLISION",
              severity: "error",
              path,
              sourceRef,
              message: `Authored names ${prior.name} and ${token} both run as ${canonical} in ngspice; rename one before running`,
              related: [
                {
                  message: `The other authored name is ${prior.name}`,
                  sourceRef: prior.sourceRef,
                },
              ],
            });
          }
        } else if (!prior) {
          seen.set(key, { name: token, sourceRef });
        }
        if (!/[^\x00-\x7f]/u.test(token)) continue;
        if (canonical !== token) {
          const replacementKey = `${path}:${sourceRef.start.offset}:${sourceRef.end.offset}`;
          if (!replacementKeys.has(replacementKey)) {
            replacementKeys.add(replacementKey);
            replacements.push({
              path,
              start: sourceRef.start.offset,
              end: sourceRef.end.offset,
              text: canonical,
            });
          }
        }
        if (warned.has(token)) continue;
        warned.add(token);
        diagnostics.push({
          code: "SIMULATION_NON_ASCII_NAME",
          severity: "info",
          path,
          sourceRef,
          message: `Authored name ${token} is prepared as ${canonical} for ngspice`,
        });
      }
    }
  }
  return { diagnostics, replacements };
}
