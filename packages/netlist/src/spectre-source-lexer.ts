import type { SourceSpan } from "@icm/model";
import type { SimulationSourceDiagnostic } from "./source-file-graph.js";

export interface SpectreSourceToken {
  kind: "word" | "string" | "symbol";
  /** Decoded string/identifier, case preserved. Original spelling lives in text. */
  value: string;
  start: number;
  end: number;
}

export interface SpectreSourceStatement {
  rawText: string;
  sourceRef: SourceSpan;
  tokens: SpectreSourceToken[];
}

/**
 * Lexical scanner for Spectre model-source declarations.
 * Keeps original text and spans intact without interpreting model equations.
 */
export function inspectSpectreSource(path: string, text: string) {
  const statements: SpectreSourceStatement[] = [];
  const diagnostics: SimulationSourceDiagnostic[] = [];
  const comments: { start: number; end: number; sourceRef: SourceSpan }[] = [];
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
  let cursor = 0;
  let tokens: SpectreSourceToken[] = [];
  const brackets: string[] = [];
  function fail(message: string, at = cursor) {
    at = Math.min(at, text.length);
    if (!tokens.length)
      tokens.push({ kind: "word", value: "", start: at, end: at });
    diagnostics.push({
      code: "MODEL_SOURCE_SYNTAX",
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
  function emit(
    kind: SpectreSourceToken["kind"],
    start: number,
    value: string,
  ) {
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
      const stop = end < 0 ? text.length : end;
      comments.push({
        start: cursor,
        end: stop,
        sourceRef: span(cursor, stop),
      });
      cursor = end < 0 ? text.length : end;
      continue;
    }
    if (text.startsWith("/*", cursor)) {
      const end = text.indexOf("*/", cursor + 2);
      const stop = end < 0 ? text.length : end + 2;
      comments.push({
        start: cursor,
        end: stop,
        sourceRef: span(cursor, stop),
      });
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
