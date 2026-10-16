import type { ProjectModelSource } from "@icm/model";
import { inspectProjectModelSource } from "./project-model-source.js";
import { inspectVacaskSource } from "./vacask-source.js";

/** Namespace owned declarations and actual call/model targets; expressions remain authored bytes. */
export function namespaceModelSource(
  source: ProjectModelSource,
  suffix: string,
) {
  if (!/^[a-zA-Z0-9_]+$/.test(suffix))
    throw Error("Use an identifier suffix for the variant");
  const inspected = inspectProjectModelSource(source);
  const failure = inspected.diagnostics.find((d) => d.severity === "error");
  if (failure) throw Error(failure.message);
  const names = new Map(
    [...inspected.entries, ...inspected.globalModels].map((d) => [
      d.name,
      `${d.name}_${suffix}`,
    ]),
  );
  const sourceNames = new Map(
    [...names].map(([name, replacement]) => [
      source.language === "spice" ? name.toLowerCase() : name,
      replacement,
    ]),
  );
  // Scope follows the expanded include graph, including models declared in a
  // different file and used before their declaration.
  const scopes = new Map<object, Set<string>>();
  let scope: Set<string> | undefined;
  for (const occurrence of inspected.graph.statements) {
    const { statement } = occurrence;
    if (statement.kind === "subckt_start") scope = new Set();
    if (scope) scopes.set(occurrence, scope);
    if (statement.kind === "model" && scope) scope.add(statement.name);
    if (statement.kind === "parameter" && !scope)
      throw Error(
        "Move global parameters inside the subcircuit before creating a variant",
      );
    if (statement.kind === "subckt_end") scope = undefined;
  }
  const files = source.files.map((file) => {
    const replacements: { start: number; end: number; text: string }[] = [];
    const native = inspectVacaskSource(file.path, file.text, false).statements;
    const seen = new Map<number, string>();
    for (const occurrence of inspected.graph.statements) {
      const { path, statement } = occurrence;
      if (path !== file.path) continue;
      const language = statement.sourceLanguage ?? source.language;
      const start = statement.sourceRef.start.offset;
      const end = statement.sourceRef.end.offset;
      const occurrenceEdits: typeof replacements = [];
      const localModels = new Set(
        [...(scopes.get(occurrence) ?? [])].map((name) =>
          language === "spice" ? name.toLowerCase() : name,
        ),
      );
      const tokens =
        language === "spectre"
          ? (native.find((s) => s.sourceRef.start.offset === start)?.tokens ??
            [])
          : [
              ...file.text
                .slice(start, end)
                .matchAll(/\{[^}]*\}|"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+/g),
            ]
              .map((m) => ({
                value: m[0],
                start: start + m.index,
                end: start + m.index + m[0].length,
              }))
              .filter((t) => t.value !== "+");
      const replace = (index: number, allowLocal = false) => {
        const token = tokens[index];
        if (!token) return;
        const key =
          language === "spice" ? token.value.toLowerCase() : token.value;
        if (!allowLocal && localModels.has(key)) return;
        const value =
          language === source.language
            ? sourceNames.get(key)
            : [...names].find(([name]) =>
                language === "spice"
                  ? name.toLowerCase() === key
                  : name === key,
              )?.[1];
        if (value)
          occurrenceEdits.push({
            start: token.start,
            end: token.end,
            text: value,
          });
      };
      if (statement.kind === "subckt_start") {
        replace(1, true);
      } else if (statement.kind === "subckt_end") {
        replace(1, true);
      } else if (statement.kind === "model" && !scopes.has(occurrence))
        replace(1, true);
      else if (statement.kind === "instance" && statement.master) {
        const index = statement.nodes.length + 1;
        if (
          tokens[index]?.value.toLowerCase() !== statement.master.toLowerCase()
        )
          throw Error(
            `Cannot isolate model reference on ${file.path}:${statement.sourceRef.start.line}`,
          );
        replace(index);
      } else if (
        language === "spice" &&
        statement.kind === "instance" &&
        ["resistor", "capacitor", "inductor"].includes(statement.family) &&
        tokens
          .slice(statement.nodes.length + 1)
          .some((t) => sourceNames.has(t.value.toLowerCase()))
      ) {
        // The parser does not distinguish passive values from model references.
        // Refuse this shorthand rather than rewriting a parameter as a model.
        throw Error(
          `Cannot isolate a passive model reference on ${file.path}:${statement.sourceRef.start.line}; use an explicit independent model source`,
        );
      } else if (language === "spectre" && statement.kind === "opaque") {
        const close = tokens.findIndex((t) => t.value === ")");
        if (close >= 0) replace(close + 1);
      } else if (
        statement.kind === "opaque" &&
        tokens.some((t) =>
          sourceNames.has(
            language === "spice" ? t.value.toLowerCase() : t.value,
          ),
        )
      ) {
        throw Error(
          `Cannot isolate an opaque model reference on ${file.path}:${statement.sourceRef.start.line}`,
        );
      }
      const signature = JSON.stringify(occurrenceEdits);
      const previous = seen.get(start);
      if (previous !== undefined && previous !== signature)
        throw Error(
          `The include ${file.path}:${statement.sourceRef.start.line} has different model scopes; split the include before creating a variant`,
        );
      if (previous === undefined) replacements.push(...occurrenceEdits);
      seen.set(start, signature);
    }
    let text = file.text;
    for (const edit of replacements.sort((a, b) => b.start - a.start))
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    return { ...file, text };
  });
  return { source: { ...structuredClone(source), files }, names };
}
