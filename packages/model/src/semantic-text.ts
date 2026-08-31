import type { RichTextDocument, RichTextRun, RichTextStyle } from "./schema.js";

/**
 * Semantic text emitted by current authoring for standardized schematic names.
 *
 * This is deliberately not a markup parser. Every input character remains in
 * the RichText projection; this helper only assigns the initial Razavi house
 * style. Callers use an explicit RichText AST for later formatting and the
 * explicit Formula editor for LaTeX syntax.
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
 * House style for an authored identifier: the leading character is the symbol
 * and everything after it defaults to its subscript. Both halves stay editable
 * afterwards. Styling must never rewrite the semantic identifier: punctuation
 * and letter case are preserved exactly.
 *
 * Whitespace marks prose rather than an identifier — a drafting note must not
 * be swallowed into one long subscript — so a multi-word value keeps its
 * authored spelling and stays a single upright-size run.
 */
function symbolRuns(value: string): RichTextRun[] {
  if (/\s/u.test(value)) return [mathBase(value)];
  const head = value.slice(0, 1);
  const tail = value.slice(1);
  return tail.length > 0
    ? [mathBase(head), mathSubscript(tail)]
    : [mathBase(head)];
}

/** Construct the initial Razavi-style RichText for a free drafting label. */
export function defaultDraftTextDocument(value: string): RichTextDocument {
  if (value.length === 0) return { runs: [{ kind: "line-break" }] };
  return { runs: symbolRuns(value) };
}

/** Construct current-authoring RichText for a conventional semantic label. */
export function semanticTextDocument(
  value: string,
  _kind: SemanticTextKind,
): RichTextDocument {
  if (value.length === 0) return { runs: [{ kind: "line-break" }] };
  // Every authored label follows one styling rule: leading symbol, then the
  // remainder as its subscript. A trailing polarity sign stays outside the
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
