/** What `pnpm lint` prints from oxlint's JSON report. */
import { changedLines } from "./verify-pr-selection.mjs";

const lineOf = (item) => item.labels?.[0]?.span.line ?? 0;

/**
 * The diagnostics to show, by file and line. Every error counts. A warning
 * shows where the change touched its file, so the warnings a touched file
 * already had (non-null assertions, effect dependencies) do not bury the new
 * ones.
 *
 * `touchedLines(file)` gives the lines a change touched in a file, or null
 * to report the whole file: a new file, or a run with no base.
 */
export function lintReport(diagnostics, touchedLines = () => null) {
  const shown = [];
  let errors = 0;
  let warnings = 0;
  let quietWarnings = 0;
  for (const item of diagnostics) {
    if (item.severity === "error") errors += 1;
    else {
      const lines = touchedLines(item.filename);
      if (lines && !lines.has(lineOf(item))) {
        quietWarnings += 1;
        continue;
      }
      warnings += 1;
    }
    shown.push(item);
  }
  shown.sort(
    (left, right) =>
      left.filename.localeCompare(right.filename) ||
      lineOf(left) - lineOf(right),
  );
  return { shown, errors, warnings, quietWarnings };
}

/**
 * The lines a `git diff -U0` (with a/ and b/ prefixes) touches in each file,
 * by its new path: a Set, or null for a file the diff adds whole. A file
 * the diff leaves out is unchanged.
 */
export function touchedLinesByFile(diffText) {
  const files = new Map();
  for (const section of diffText.split(/^diff --git /mu).slice(1)) {
    const target = /^\+\+\+ b\/(.+)$/mu.exec(section)?.[1];
    if (!target) continue;
    files.set(
      target,
      /^--- \/dev\/null$/mu.test(section)
        ? null
        : new Set(changedLines(section)),
    );
  }
  return files;
}

/** One line per diagnostic, `file:line:column`, with an error's help. */
export function formatDiagnostic(item) {
  const span = item.labels?.[0]?.span;
  const where = span
    ? `${item.filename}:${span.line}:${span.column}`
    : item.filename;
  const line = `${where}  ${item.severity}  ${item.code}  ${item.message}`;
  return item.severity === "error" && item.help
    ? `${line}\n    help: ${item.help}`
    : line;
}
