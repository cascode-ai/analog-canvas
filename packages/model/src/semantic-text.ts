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
  | "net-label"
  | "power-label"
  | "route-marker";

function span(children: RichTextRun[], style: RichTextStyle): RichTextRun {
  return { kind: "span", style, children };
}

function mathBase(value: string): RichTextRun {
  return span([span([{ kind: "text", value }], "bold")], "italic");
}

function mathSubscript(value: string): RichTextRun {
  return span([span([{ kind: "text", value }], "bold")], "subscript");
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

  return { runs: [mathBase(value)] };
}

/** Construct current-authoring RichText for a conventional semantic label. */
export function semanticTextDocument(
  value: string,
  kind: SemanticTextKind,
): RichTextDocument {
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

  if (kind === "default-instance" || kind === "instance-label") {
    const match = /^([A-Za-z]+)(.+)$/u.exec(value);
    return match
      ? { runs: [mathBase(match[1]!), mathSubscript(match[2]!)] }
      : { runs: [mathBase(value)] };
  }

  const conventional = /^([VI])(.+?)([+-])?$/u.exec(value);
  if (!conventional) return { runs: [{ kind: "text", value }] };
  return {
    runs: [
      mathBase(conventional[1]!),
      mathSubscript(conventional[2]!),
      ...(conventional[3]
        ? [{ kind: "text" as const, value: conventional[3] }]
        : []),
    ],
  };
}
