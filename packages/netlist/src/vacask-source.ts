import type { SimulationSourceInput, SourceSpan } from "@icm/model";
import {
  inspectSourceFileGraph,
  type InspectedSourceItem,
  type SimulationSourceDiagnostic,
} from "./source-file-graph.js";

export interface VacaskSourceToken {
  kind: "word" | "string" | "symbol";
  /** Decoded string/identifier, case preserved. Original spelling lives in text. */
  value: string;
  start: number;
  end: number;
}
export interface VacaskSourceStatement {
  rawText: string;
  sourceRef: SourceSpan;
  tokens: VacaskSourceToken[];
}

/** Lexical inspection, not a second simulator grammar or expression evaluator.
 * Unknown native statements stay available for the simulator to interpret.
 * Based on pinned VACASK input-overview/identifiers/strings and dfllexer.l. */
export function inspectVacaskSource(path: string, text: string, entry = false) {
  const statements: VacaskSourceStatement[] = [];
  const diagnostics: SimulationSourceDiagnostic[] = [];
  const comments: { start: number; end: number }[] = [];
  const starts = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") starts.push(i + 1);
  function position(offset: number) {
    let low = 0,
      high = starts.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (starts[mid]! <= offset) low = mid;
      else high = mid;
    }
    return { offset, line: low + 1, column: offset - starts[low]! + 1 };
  }
  const span = (start: number, end: number): SourceSpan => ({
    fileId: path,
    start: position(start),
    end: position(end),
  });
  let cursor = entry
    ? text.includes("\n")
      ? text.indexOf("\n") + 1
      : text.length
    : 0;
  let tokens: VacaskSourceToken[] = [];
  const brackets: string[] = [];
  function fail(message: string, at = cursor) {
    at = Math.min(at, text.length);
    // Keep a lexical failure visible to section-aware graph filtering even if
    // an unterminated comment/string did not produce an ordinary statement.
    if (!tokens.length)
      tokens.push({ kind: "word", value: "", start: at, end: at });
    diagnostics.push({
      code: "VACASK_SOURCE_SYNTAX",
      severity: "error",
      message,
      sourceRef: span(tokens[0]!.start, Math.max(at, tokens[0]!.start)),
    });
  }
  function flush() {
    if (!tokens.length) return;
    const start = tokens[0]!.start,
      end = tokens.at(-1)!.end;
    statements.push({
      rawText: text.slice(start, end),
      sourceRef: span(start, end),
      tokens,
    });
    tokens = [];
  }
  function emit(kind: VacaskSourceToken["kind"], start: number, value: string) {
    tokens.push({ kind, value, start, end: Math.min(text.length, cursor) });
  }
  while (cursor < text.length) {
    const c = text[cursor]!;
    if (c === "\n") {
      if (!brackets.length) flush();
      cursor++;
      continue;
    }
    if (/\s/u.test(c)) {
      cursor++;
      continue;
    }
    if (text.startsWith("//", cursor)) {
      const end = text.indexOf("\n", cursor);
      comments.push({ start: cursor, end: end < 0 ? text.length : end });
      cursor = end < 0 ? text.length : end;
      continue;
    }
    if (text.startsWith("/*", cursor)) {
      const end = text.indexOf("*/", cursor + 2);
      comments.push({ start: cursor, end: end < 0 ? text.length : end + 2 });
      if (end < 0) {
        fail("Unterminated block comment");
        cursor = text.length;
      } else cursor = end + 2;
      continue;
    }
    if (c === "\\") {
      const continuation = /^\\[ \t]*\r?\n/u.exec(text.slice(cursor));
      if (continuation) {
        cursor += continuation[0].length;
        continue;
      }
    }
    const start = cursor;
    if (text.startsWith("<<<", cursor)) {
      const marker = /^<<<([A-Za-z0-9_]+)[ \t]*\r?\n/u.exec(text.slice(cursor));
      if (marker) {
        cursor += marker[0].length;
        const end = text.indexOf(`>>>${marker[1]}`, cursor);
        if (end < 0) {
          fail(`Unterminated long string ${marker[1]}`, start);
          emit("string", start, text.slice(cursor));
          cursor = text.length;
        } else {
          const value = text.slice(cursor, end);
          cursor = end + 3 + marker[1]!.length;
          emit("string", start, value);
        }
        continue;
      }
    }
    if (c === '"') {
      cursor++;
      let value = "",
        closed = false;
      while (cursor < text.length) {
        const part = text[cursor++]!;
        if (part === '"') {
          closed = true;
          break;
        }
        if (part === "\n" || part === "\r") {
          cursor--;
          break;
        }
        if (part !== "\\") {
          value += part;
          continue;
        }
        const escape = text[cursor++];
        if (escape === undefined) break;
        const octal = /^[0-7]{1,3}/u.exec(text.slice(cursor - 1));
        if (octal) {
          value += String.fromCharCode(parseInt(octal[0], 8));
          cursor += octal[0].length - 1;
        } else
          value +=
            (
              { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<
                string,
                string
              >
            )[escape] ?? escape;
      }
      emit("string", start, value);
      if (!closed) fail("Unterminated short string", start);
      continue;
    }
    if ("()[]{}=,+-*/<>!?:;".includes(c)) {
      cursor++;
      if ("([{".includes(c)) brackets.push(c);
      else if (")]}".includes(c)) {
        const opening = "([{"[")]}".indexOf(c)];
        if (brackets.pop() !== opening) fail(`Unmatched ${c}`, start);
      }
      emit("symbol", start, c);
      continue;
    }
    let value = "";
    // Quoted and unquoted identifier fragments concatenate. Single quote
    // doubling is an identifier escape, not a SPICE arithmetic expression.
    while (cursor < text.length) {
      const part = text[cursor]!;
      if (part === "'") {
        cursor++;
        let closed = false;
        while (cursor < text.length) {
          const quoted = text[cursor++]!;
          if (quoted === "'" && text[cursor] === "'") {
            value += "'";
            cursor++;
          } else if (quoted === "'") {
            closed = true;
            break;
          } else if (/\s/u.test(quoted)) {
            cursor--;
            break;
          } else value += quoted;
        }
        if (!closed) {
          fail(
            "Unterminated or whitespace-containing quoted identifier",
            start,
          );
          break;
        }
      } else if (/\s/u.test(part) || '"()[]{}=,+-*/<>!?:;'.includes(part))
        break;
      else {
        value += part;
        cursor++;
      }
    }
    if (cursor === start) cursor++;
    emit("word", start, value);
  }
  if (brackets.length) fail("Unterminated bracketed statement");
  flush();
  return { statements, diagnostics, comments };
}

/** Native includes use the same ownership graph as the existing compiler.
 * No SPICE-to-native fallback, extension-based language guessing or host reads. */
export function inspectVacaskSourceGraph(input: SimulationSourceInput) {
  return inspectSourceFileGraph(
    input,
    (path, text, entry) => {
      const parsed = inspectVacaskSource(path, text, entry);
      const diagnostics = [...parsed.diagnostics];
      const items: InspectedSourceItem<VacaskSourceStatement>[] =
        parsed.statements.map((statement) => {
          const item: InspectedSourceItem<VacaskSourceStatement> = {
            statement,
            sourceRef: statement.sourceRef,
          };
          const [head, name, ...rest] = statement.tokens;
          const bare = (
            token: VacaskSourceToken | undefined,
            keyword?: string,
          ) =>
            token?.kind === "word" &&
            text.slice(token.start, token.end) === token.value &&
            (keyword === undefined || token.value === keyword);
          const sectionName = (token: VacaskSourceToken | undefined) =>
            bare(token) && /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(token!.value);
          const fail = (message: string) =>
            diagnostics.push({
              code: "VACASK_SOURCE_SYNTAX",
              severity: "error",
              message,
              sourceRef: statement.sourceRef,
            });
          if (bare(head, "include")) {
            if (name?.kind !== "string" || text[name.start] !== '"')
              fail("Native include requires a literal double-quoted filename");
            else if (!rest.length) item.include = { requestedPath: name.value };
            else if (
              rest.length === 3 &&
              bare(rest[0], "section") &&
              rest[1]?.value === "=" &&
              sectionName(rest[2])
            )
              item.include = {
                requestedPath: name.value,
                section: rest[2]!.value,
              };
            else
              fail(
                "Use a native include with an optional section; foreign-language includes are not this migration's native compilation path",
              );
          } else if (bare(head, "section")) {
            if (!sectionName(name) || rest.length)
              fail("section requires exactly one native identifier");
            else item.section = { kind: "start", name: name!.value };
          } else if (bare(head, "endsection")) {
            if (name) fail("endsection takes no name");
            else item.section = { kind: "end", name: "" };
          } else if (bare(head) && head!.value.startsWith("."))
            fail(
              "SPICE directives are not native VACASK source; preserve and explicitly translate the old experiment before running it",
            );
          return item;
        });
      return { items, diagnostics };
    },
    { sectionKey: (name) => name, rootFallback: true, flatSections: true },
  );
}
