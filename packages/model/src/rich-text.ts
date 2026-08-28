import type { RichTextDocument, RichTextRun } from "./schema.js";

export type RichTextMathRun = Extract<RichTextRun, { kind: "math" }>;

export function soleRichTextMathRun(
  document: RichTextDocument,
): RichTextMathRun | undefined {
  const run = document.runs.length === 1 ? document.runs[0] : undefined;
  return run?.kind === "math" ? run : undefined;
}

/** Lossy plain-text projection for search and accessibility only. */
export function flattenRichText(document: RichTextDocument): string {
  return document.runs.map(flattenRun).join("");
}

function flattenRun(run: RichTextRun): string {
  switch (run.kind) {
    case "text":
      return run.value;
    case "line-break":
      return "\n";
    case "math":
      return run.latex;
    case "span":
      return run.children.map(flattenRun).join("");
    case "fraction":
      return `${run.numerator.runs.map(flattenRun).join("")}/${run.denominator.runs.map(flattenRun).join("")}`;
  }
}

/** Canonicalize text-run boundaries recursively before structural equality. */
export function normalizeRichText(
  document: RichTextDocument,
): RichTextDocument {
  const normalized: RichTextRun[] = [];
  const append = (run: RichTextRun): void => {
    if (run.kind === "text") {
      if (run.value.length === 0) return;
      const previous = normalized.at(-1);
      if (previous?.kind === "text") previous.value += run.value;
      else normalized.push({ ...run });
      return;
    }
    if (run.kind === "span") {
      normalized.push({
        ...run,
        children: normalizeRichText({ runs: run.children }).runs,
      });
      return;
    }
    if (run.kind === "math") {
      normalized.push({ ...run });
      return;
    }
    if (run.kind === "fraction") {
      normalized.push({
        kind: "fraction",
        numerator: normalizeRichText(run.numerator),
        denominator: normalizeRichText(run.denominator),
      });
      return;
    }
    normalized.push(run);
  };
  document.runs.forEach(append);
  return { runs: normalized };
}
