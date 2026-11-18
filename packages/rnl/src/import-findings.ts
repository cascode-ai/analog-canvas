import type { Document } from "@rich-netlist/runtime";

import type { RnlImportDiagnostic } from "./import-scope.js";
import { hasCanvasTypesetting, type RnlSnapshot } from "./rnl-snapshot.js";

type RuntimeFinding = RnlSnapshot["diagnostics"][number];

/** Where RNL finds something, as its author looks it up. */
const place = (file: string, line: number, col = 0) =>
  `${file}:${line}${col ? `:${col}` : ""}`;

/**
 * What RNL itself finds wrong in the file, at the line it finds it, so its
 * author can fix that line: errors, violations, and the warnings of the
 * standard's domains (RNL0–RNL6); not hints, nor the notes of the tools or of
 * what the implementation leaves out (RNL7–RNL9, such as a K card it does
 * not draw). Findings of one kind at one place, such as a standard symbol's
 * rule binding no terminal of each part it draws, are one finding with how
 * many there are.
 */
export function runtimeFindings(
  findings: readonly RuntimeFinding[],
): RnlImportDiagnostic[] {
  const groups = new Map<string, RuntimeFinding[]>();
  for (const item of findings) {
    if (!(
      item.severity === "error" ||
      item.severity === "violation" ||
      (item.severity === "warning" && /^RNL[0-6]/u.test(item.code ?? ""))
    ))
      continue;
    const key = [item.code, item.name, item.file, item.line, item.col].join(
      "\u0000",
    );
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map((group) => {
    const [first] = group as [RuntimeFinding, ...RuntimeFinding[]];
    const more = group.length > 1 ? ` (${group.length} times)` : "";
    return {
      severity: "warning",
      code:
        first.severity === "error"
          ? "RNL_IMPORT_RNL_ERROR"
          : "RNL_IMPORT_RNL_FINDING",
      message: `RNL ${place(first.file, first.line, first.col)}${first.code ? ` ${first.code}` : ""} ${first.name}${more}: ${first.message}`,
    };
  });
}

/** Whether any level that draws something was written by another tool or an Agent. */
export function hasForeignDrawing(
  snapshot: Pick<RnlSnapshot, "levels">,
): boolean {
  return snapshot.levels.some(
    (level) =>
      level.model !== undefined &&
      level.model.objects.some((object) => object.at.value !== null) &&
      !hasCanvasTypesetting(level.model),
  );
}

/** At most this many layout hints are reported; the rest are counted. */
const LAYOUT_HINT_LIMIT = 30;

/**
 * RNL's geometry hints (RNL7…, `rnl check`) on the levels another tool or an
 * Agent wrote, where they show what to move: a wire over a symbol or a text,
 * texts over each other, a wire leaving a pin the wrong way, wires that look
 * joined. A level Analog Canvas wrote draws as Analog Canvas drew it, and
 * none is reported there. Analog Canvas draws its own junction dots
 * (`no-dot`), and does not show the values a file does not write, so hints
 * about either say nothing of the drawing it shows.
 */
export function layoutHintFindings(
  levels: Document["levels"],
  snapshot: Pick<RnlSnapshot, "levels">,
): RnlImportDiagnostic[] {
  const canvasLevels = new Set(
    snapshot.levels.flatMap((level) =>
      level.model && hasCanvasTypesetting(level.model)
        ? [`${level.kind}\u0000${level.name}`]
        : [],
    ),
  );
  const hints = levels.flatMap((level) =>
    canvasLevels.has(`${level.kind}\u0000${level.title}`)
      ? []
      : (level.hints ?? []).filter(
          (hint) =>
            hint.kind !== "no-dot" && !/\bthe value "/u.test(hint.message),
        ),
  );
  const reported: RnlImportDiagnostic[] = hints
    .slice(0, LAYOUT_HINT_LIMIT)
    .map((hint) => ({
      severity: "warning",
      code: "RNL_IMPORT_LAYOUT_HINT",
      message: `RNL ${place(hint.file, hint.line)} ${hint.code} ${hint.kind}: ${hint.message}`,
    }));
  if (hints.length > LAYOUT_HINT_LIMIT)
    reported.push({
      severity: "warning",
      code: "RNL_IMPORT_LAYOUT_HINT",
      message: `${hints.length - LAYOUT_HINT_LIMIT} more layout hints; fix those above and import again`,
    });
  return reported;
}
