import type {
  RawfileError,
  RawfileParse,
  RawfilePlot,
  RawfileVector,
} from "./rawfile.js";

/**
 * Native VACASK ASCII output (lib/outrawfile.cpp). Points are indexed and
 * contiguous, without ngspice's blank separator. Variables are `notype`:
 * quantity/unit and sweep semantics must come from the prepared acquisition,
 * never from the column's position or a guess at its name.
 *
 * Each file is collected separately by the runtime. Preserve every declared
 * column, including outer sweep axes, for the result adapter to interpret.
 */
export function parseVacaskRawfile(text: string): RawfileParse {
  try {
    return { ok: true, plots: readPlots(text) };
  } catch (error) {
    if (error instanceof ParseFault) return { ok: false, error: error.detail };
    throw error;
  }
}

class ParseFault extends Error {
  constructor(readonly detail: RawfileError) {
    super(detail.message);
  }
}

function fail(
  code: RawfileError["code"],
  message: string,
  line: number | null,
): never {
  throw new ParseFault({ code, message, line });
}

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

function number(value: string, line: number): number {
  if (!DECIMAL.test(value)) {
    fail(
      /^[+-]?(?:nan|inf)/iu.test(value)
        ? "value-not-finite"
        : "value-malformed",
      `Invalid VACASK numeric value ${JSON.stringify(value)}.`,
      line,
    );
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    fail("value-not-finite", "VACASK value is not finite.", line);
  return parsed;
}

function readPlots(text: string): RawfilePlot[] {
  if (!text.trim()) fail("empty-file", "VACASK output is empty.", null);
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const plots: RawfilePlot[] = [];
  let cursor = 0;
  const skipBlank = () => {
    while (cursor < lines.length && !lines[cursor]!.trim()) cursor++;
  };
  while (cursor < lines.length) {
    skipBlank();
    if (cursor === lines.length) break;
    if (!lines[cursor]!.startsWith("Title:"))
      fail(
        "unsupported-format",
        "Expected a VACASK rawfile Title.",
        cursor + 1,
      );
    const fields = new Map<string, string>();
    while (cursor < lines.length && lines[cursor]!.trim() !== "Variables:") {
      if (!lines[cursor]!.trim()) {
        cursor++;
        continue;
      }
      const match = /^([^:]+):\s*(.*)$/u.exec(lines[cursor]!);
      if (!match || fields.has(match[1]!))
        fail(
          "header-invalid",
          "Malformed or repeated rawfile header.",
          cursor + 1,
        );
      fields.set(match[1]!, match[2]!.trim());
      cursor++;
    }
    if (cursor === lines.length)
      fail(
        "header-incomplete",
        "Missing VACASK variable definitions.",
        cursor + 1,
      );
    for (const key of [
      "Title",
      "Date",
      "Plotname",
      "Flags",
      "No. Variables",
      "No. Points",
    ])
      if (!fields.has(key))
        fail("header-incomplete", `Missing ${key} header.`, cursor + 1);
    const count = (key: string): number => {
      const raw = fields.get(key)!;
      const parsed = Number(raw);
      if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(parsed) || parsed < 1)
        fail("header-invalid", `Invalid ${key}: ${raw}.`, cursor + 1);
      return parsed;
    };
    const variableCount = count("No. Variables");
    const pointCount = count("No. Points");
    // Bound allocation/work by bytes already received, not untrusted counts.
    if (variableCount > lines.length - cursor)
      fail(
        "header-incomplete",
        "Variable count exceeds the available data.",
        cursor + 1,
      );
    const flags = fields.get("Flags")!.split(/\s+/u);
    if (flags.length !== 1 || !["real", "complex"].includes(flags[0]!))
      fail(
        "unsupported-format",
        `Unsupported VACASK flags: ${flags.join(" ")}.`,
        cursor + 1,
      );
    const complex = flags[0] === "complex";
    const vectors: Array<
      RawfileVector & { real: number[]; imag: number[] | null }
    > = [];
    const names = new Set<string>();
    cursor++;
    for (let i = 0; i < variableCount; i++, cursor++) {
      const match = /^\s*(\d+)\s+(\S+)\s+(\S+)\s*$/u.exec(lines[cursor] ?? "");
      if (!match || Number(match[1]) !== i || names.has(match[2]!))
        fail(
          "variable-line-invalid",
          "Invalid index or duplicate VACASK variable.",
          cursor + 1,
        );
      names.add(match[2]!);
      vectors.push({
        variable: {
          index: i,
          name: match[2]!,
          quantity: match[3]!,
          qualifiers: [],
        },
        real: [],
        imag: complex ? [] : null,
      });
    }
    if (lines[cursor]?.trim() !== "Values:")
      fail(
        lines[cursor]?.trim() === "Binary:"
          ? "unsupported-format"
          : "header-incomplete",
        'Expected ASCII Values; use VACASK options rawfile="ascii".',
        cursor + 1,
      );
    cursor++;
    if (pointCount > Math.floor((lines.length - cursor) / variableCount))
      fail(
        "point-count-mismatch",
        "Point count exceeds the available data.",
        cursor + 1,
      );
    for (let point = 0; point < pointCount; point++) {
      for (let column = 0; column < variableCount; column++, cursor++) {
        const line = lines[cursor] ?? "";
        const match =
          column === 0
            ? /^\s*(\d+)\s+(\S+)\s*$/u.exec(line)
            : /^\s+(\S+)\s*$/u.exec(line);
        if (!match || (column === 0 && Number(match[1]) !== point))
          fail(
            "point-block-invalid",
            `Expected point ${point}, column ${column}.`,
            cursor + 1,
          );
        const values = match[column === 0 ? 2 : 1]!.split(",");
        if (values.length !== (complex ? 2 : 1))
          fail(
            "value-malformed",
            "Value does not match real/complex flags.",
            cursor + 1,
          );
        vectors[column]!.real.push(number(values[0]!, cursor + 1));
        if (complex)
          vectors[column]!.imag!.push(number(values[1]!, cursor + 1));
      }
    }
    plots.push({
      title: fields.get("Title")!,
      date: fields.get("Date")!,
      command: fields.get("Command") ?? "",
      plotName: fields.get("Plotname")!,
      flags,
      complex,
      pointCount,
      vectors,
    });
    skipBlank();
    if (cursor < lines.length && !lines[cursor]!.startsWith("Title:"))
      fail(
        "point-count-mismatch",
        "Unexpected data after the declared VACASK points.",
        cursor + 1,
      );
  }
  return plots;
}
