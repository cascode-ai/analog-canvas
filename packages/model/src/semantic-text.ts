import type { RichTextDocument, RichTextRun, RichTextStyle } from "./schema.js";

/**
 * Semantic text emitted by current authoring for standardized schematic names.
 *
 * This is deliberately not a markup parser: `_{}`, `\\it{}`, and other markup
 * spellings are invalid Project text. Callers either supply an explicit
 * RichText AST or use this helper for a semantic
 * identifier such as an instance reference or a conventional voltage/current
 * label.
 */
export type SemanticTextKind =
  | "default-instance"
  | "instance-label"
  | "formal-port"
  | "net-label"
  | "power-label"
  | "route-marker";

function span(children: RichTextRun[], style: RichTextStyle): RichTextRun {
  return { kind: "span", style, children };
}

function mathBase(value: string): RichTextRun {
  return span([span([{ kind: "text", value }], "bold")], "italic");
}

/**
 * Supply designators keep an italic subscript; every other subscript is
 * upright. The renderer draws scripts upright by default and treats a nested
 * italic span as a deliberate override, so this is expressed in the document
 * rather than in the renderer.
 */
const POWER_RAIL_SUBSCRIPTS = new Set(["dd", "ss", "cc", "ee", "bb"]);

function isPowerRailSubscript(value: string): boolean {
  return POWER_RAIL_SUBSCRIPTS.has(value.trim().toLowerCase());
}

function mathSubscript(value: string): RichTextRun {
  const bold = span([{ kind: "text", value }], "bold");
  return span(
    [isPowerRailSubscript(value) ? span([bold], "italic") : bold],
    "subscript",
  );
}

/**
 * House style for an authored identifier: the leading character is the
 * capitalized symbol and everything after it defaults to its subscript. Both
 * halves stay editable afterwards.
 *
 * Whitespace marks prose rather than an identifier — a drafting note must not
 * be swallowed into one long subscript — so a multi-word value keeps its
 * capitalized first letter and stays a single upright-size run.
 */
function symbolRuns(value: string): RichTextRun[] {
  const capitalized = value.slice(0, 1).toUpperCase() + value.slice(1);
  if (/\s/u.test(capitalized)) return [mathBase(capitalized)];
  const head = capitalized.slice(0, 1);
  const tail = capitalized.slice(1);
  return tail.length > 0
    ? [mathBase(head), mathSubscript(tail)]
    : [mathBase(head)];
}

/** Construct the initial Razavi-style RichText for a free drafting label. */
export function defaultDraftTextDocument(value: string): RichTextDocument {
  if (value.length === 0) return { runs: [{ kind: "line-break" }] };
  if (/[\\{}^]/u.test(value)) return { runs: [{ kind: "text", value }] };

  const underscore = value.indexOf("_");
  if (underscore > 0 && underscore < value.length - 1) {
    return {
      runs: [
        mathBase(value.slice(0, underscore)),
        mathSubscript(value.slice(underscore + 1)),
      ],
    };
  }

  return { runs: symbolRuns(value) };
}

/** Construct current-authoring RichText for a conventional semantic label. */
export function semanticTextDocument(
  value: string,
  kind: SemanticTextKind,
): RichTextDocument {
  if (value.length === 0) return { runs: [{ kind: "line-break" }] };
  // `_suffix` and `_{suffix}` are the one explicit identifier notation the
  // product accepts. Parse it before role-specific shorthand so Cell Ports,
  // ordinary labels, and hierarchy pin names never diverge on V_in.
  const explicitSubscript = /^(.+?)_(?:\{(.+)\}|(.+))$/u.exec(value);
  if (explicitSubscript) {
    return {
      runs: [
        mathBase(explicitSubscript[1]!),
        mathSubscript(explicitSubscript[2] ?? explicitSubscript[3]!),
      ],
    };
  }
  if (/[\\{}^]/u.test(value)) return { runs: [{ kind: "text", value }] };

  // Every authored label follows one rule: capitalized leading symbol, the
  // rest as its subscript. A trailing polarity sign stays outside the
  // subscript because it qualifies the whole identifier.
  const signed = /^(.+?)([+-])$/u.exec(value);
  if (!signed) return { runs: symbolRuns(value) };
  return {
    runs: [
      ...symbolRuns(signed[1]!),
      { kind: "text" as const, value: signed[2]! },
    ],
  };
}
