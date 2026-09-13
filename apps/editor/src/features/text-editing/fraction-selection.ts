import { flattenRichText, normalizeRichText } from "@icm/model";
import type { RichTextDocument, RichTextRun } from "@icm/model";

/** Split only an unambiguous slash selection, retaining its character styles. */
export function fractionFromSelection(
  content: RichTextDocument,
): Extract<RichTextRun, { kind: "fraction" }> {
  const plain = flattenRichText(content);
  const slash = plain.indexOf("/");
  const splitAt = (
    runs: RichTextRun[],
    offset: number,
  ): [RichTextRun[], RichTextRun[]] => {
    const before: RichTextRun[] = [],
      after: RichTextRun[] = [];
    for (const run of runs) {
      const length = flattenRichText({ runs: [run] }).length;
      if (offset >= length) before.push(run);
      else if (offset <= 0) after.push(run);
      else if (run.kind === "text") {
        before.push({ kind: "text", value: run.value.slice(0, offset) });
        after.push({ kind: "text", value: run.value.slice(offset) });
      } else if (run.kind === "span") {
        const [left, right] = splitAt(run.children, offset);
        if (left.length) before.push({ ...run, children: left });
        if (right.length) after.push({ ...run, children: right });
      } else after.push(run);
      offset -= length;
    }
    return [before, after];
  };
  const ordinary = (runs: RichTextRun[]): boolean =>
    runs.every(
      (run) =>
        run.kind === "text" || (run.kind === "span" && ordinary(run.children)),
    );
  if (
    ordinary(content.runs) &&
    slash > 0 &&
    slash === plain.lastIndexOf("/") &&
    plain.slice(slash + 1).trim()
  ) {
    const [numerator, rest] = splitAt(content.runs, slash);
    const [, denominator] = splitAt(rest, 1);
    return {
      kind: "fraction",
      numerator: normalizeRichText({ runs: numerator }),
      denominator: normalizeRichText({ runs: denominator }),
    };
  }
  return {
    kind: "fraction",
    numerator: plain.trim()
      ? content
      : { runs: [{ kind: "text", value: "a" }] },
    denominator: { runs: [{ kind: "text", value: "b" }] },
  };
}
