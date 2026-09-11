import type { SourceSpan } from "@icm/model";

import { diagnostic } from "./diagnostics.js";
import type { SpiceDiagnostic } from "./diagnostics.js";
import type { SpiceSourceFile } from "./source-types.js";
import { parseSpiceNumber } from "./expression.js";

export interface LogicalLine {
  fileId: string;
  text: string;
  rawText: string;
  sourceRef: SourceSpan;
  physicalLines: number[];
  orphanContinuation: boolean;
}

export interface RawSpiceParameter {
  name: string;
  rawText: string;
  sourceRef: SourceSpan;
}

interface StatementBase {
  rawText: string;
  sourceRef: SourceSpan;
}

export interface IncludeStatement extends StatementBase {
  kind: "include";
  requestedPath: string;
}

export interface SubcircuitStartStatement extends StatementBase {
  kind: "subckt_start";
  name: string;
  ports: string[];
  parameters: RawSpiceParameter[];
}

export interface SubcircuitEndStatement extends StatementBase {
  kind: "subckt_end";
  name?: string;
}

export interface ParameterStatement extends StatementBase {
  kind: "parameter";
  parameters: RawSpiceParameter[];
}

export interface ModelStatement extends StatementBase {
  kind: "model";
  name: string;
  modelType: string;
  rawParameters: string;
}

export interface GlobalStatement extends StatementBase {
  kind: "global";
  names: string[];
}

export interface LibraryStatement extends StatementBase {
  kind: "library";
  mode: "include" | "section-start" | "section-end";
  section: string;
  requestedPath?: string;
}

export interface FunctionStatement extends StatementBase {
  kind: "function";
  name: string;
  arguments: string[];
  rawExpression: string;
}

export interface ConditionalStatement extends StatementBase {
  kind: "conditional";
  form: "if" | "elseif" | "else" | "endif";
  rawExpression?: string;
}

export interface ControlBoundaryStatement extends StatementBase {
  kind: "control_boundary";
  form: "start" | "end";
}

export interface ControlCommandStatement extends StatementBase {
  kind: "control_command";
  command: string;
  arguments: string[];
}

export interface DirectiveStatement extends StatementBase {
  kind: "directive";
  name: string;
  arguments: string[];
  category: "analysis" | "output" | "option" | "metadata";
}

export type CurrentInstanceFamily =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "voltage-source"
  | "current-source"
  | "vcvs"
  | "vccs"
  | "cccs"
  | "ccvs"
  | "diode"
  | "bjt"
  | "switch"
  | "current-switch"
  | "mosfet"
  | "jfet"
  | "mesfet"
  | "behavioral-source"
  | "mutual-inductor"
  | "lossless-transmission-line"
  | "lossy-transmission-line"
  | "coupled-multiconductor-line"
  | "uniform-rc-line"
  | "single-lossy-transmission-line"
  | "subcircuit";

export interface InstanceStatement extends StatementBase {
  kind: "instance";
  name: string;
  family: CurrentInstanceFamily;
  nodes: string[];
  parameters: RawSpiceParameter[];
  master?: string;
  controlSource?: string;
}

export interface OpaqueSyntaxStatement extends StatementBase {
  kind: "opaque";
  probableType?: "element" | "directive" | "control";
  reason: string;
}

export type SpiceStatement =
  | IncludeStatement
  | SubcircuitStartStatement
  | SubcircuitEndStatement
  | ParameterStatement
  | ModelStatement
  | GlobalStatement
  | LibraryStatement
  | FunctionStatement
  | ConditionalStatement
  | ControlBoundaryStatement
  | ControlCommandStatement
  | DirectiveStatement
  | InstanceStatement
  | OpaqueSyntaxStatement;

export interface SpiceSyntaxFile {
  fileId: string;
  statements: SpiceStatement[];
  logicalLines: LogicalLine[];
  diagnostics: SpiceDiagnostic[];
}

interface PhysicalLine {
  content: string;
  startOffset: number;
  contentEndOffset: number;
  lineNumber: number;
}

function physicalLines(text: string): PhysicalLine[] {
  const result: PhysicalLine[] = [];
  let offset = 0;
  let lineNumber = 1;
  while (offset < text.length) {
    let cursor = offset;
    while (
      cursor < text.length &&
      text[cursor] !== "\n" &&
      text[cursor] !== "\r"
    ) {
      cursor += 1;
    }
    result.push({
      content: text.slice(offset, cursor),
      startOffset: offset,
      contentEndOffset: cursor,
      lineNumber,
    });
    if (text[cursor] === "\r" && text[cursor + 1] === "\n") {
      cursor += 2;
    } else if (cursor < text.length) {
      cursor += 1;
    }
    offset = cursor;
    lineNumber += 1;
  }
  return result;
}

function stripInlineComment(text: string): string {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (
      character === "$" ||
      character === ";" ||
      (character === "/" && text[index + 1] === "/")
    ) {
      return text.slice(0, index).trimEnd();
    }
  }
  return text.trimEnd();
}

export function buildLogicalLines(source: SpiceSourceFile): LogicalLine[] {
  const physical = physicalLines(source.text);
  const logical: LogicalLine[] = [];
  let pending:
    | {
        first: PhysicalLine;
        last: PhysicalLine;
        parts: string[];
        lines: number[];
        orphanContinuation: boolean;
      }
    | undefined;

  function flush(): void {
    if (!pending) {
      return;
    }
    logical.push({
      fileId: source.id,
      text: pending.parts
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" "),
      rawText: source.text.slice(
        pending.first.startOffset,
        pending.last.contentEndOffset,
      ),
      sourceRef: {
        fileId: source.id,
        start: {
          offset: pending.first.startOffset,
          line: pending.first.lineNumber,
          column: 1,
        },
        end: {
          offset: pending.last.contentEndOffset,
          line: pending.last.lineNumber,
          column: pending.last.content.length + 1,
        },
      },
      physicalLines: pending.lines,
      orphanContinuation: pending.orphanContinuation,
    });
    pending = undefined;
  }

  for (const line of physical) {
    const trimmed = line.content.trimStart();
    if (!trimmed || trimmed.startsWith("*")) {
      continue;
    }
    const cleaned = stripInlineComment(line.content);
    if (!cleaned.trim()) {
      continue;
    }
    const continuation = cleaned.trimStart().startsWith("+");
    if (continuation) {
      const part = cleaned.trimStart().slice(1).trimStart();
      if (pending) {
        pending.last = line;
        pending.parts.push(part);
        pending.lines.push(line.lineNumber);
      } else {
        pending = {
          first: line,
          last: line,
          parts: [part],
          lines: [line.lineNumber],
          orphanContinuation: true,
        };
      }
      continue;
    }
    if (pending?.parts.at(-1)?.trimEnd().endsWith("\\\\")) {
      pending.parts[pending.parts.length - 1] = pending.parts
        .at(-1)!
        .trimEnd()
        .slice(0, -2);
      pending.last = line;
      pending.parts.push(cleaned);
      pending.lines.push(line.lineNumber);
      continue;
    }
    flush();
    pending = {
      first: line,
      last: line,
      parts: [cleaned],
      lines: [line.lineNumber],
      orphanContinuation: false,
    };
  }
  flush();
  return logical;
}

export function splitSpiceFields(text: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let parentheses = 0;
  let braces = 0;
  for (const character of text.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      current += character;
      quote = character;
      continue;
    }
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
    if (character === "{") braces += 1;
    if (character === "}") braces -= 1;
    if (
      (/\s/u.test(character) || character === ",") &&
      parentheses === 0 &&
      braces === 0
    ) {
      if (current) {
        fields.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (current) {
    fields.push(current);
  }
  return fields;
}

function parametersFromTokens(
  tokens: string[],
  sourceRef: SourceSpan,
): RawSpiceParameter[] {
  const text = tokens
    .filter((token) => token.toLowerCase() !== "params:")
    .join(" ")
    .replace(/^\s*\(/u, "")
    .replace(/\)\s*$/u, "");
  return scanParameterAssignments(text).map(({ name, rawText }) => ({
    name,
    rawText,
    sourceRef,
  }));
}

function scanParameterAssignments(text: string) {
  const result: {
    name: string;
    rawText: string;
    start: number;
    end: number;
  }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const assignment = /^\s*([a-z_][a-z0-9_.]*)\s*=\s*/iu.exec(
      text.slice(cursor),
    );
    if (!assignment) break;
    const name = assignment[1]!;
    cursor += assignment[0].length;
    const valueStart = cursor;
    let quote: "'" | '"' | null = null;
    let parentheses = 0;
    let braces = 0;
    while (cursor < text.length) {
      const character = text[cursor]!;
      if (quote) {
        if (character === quote) quote = null;
        cursor += 1;
        continue;
      }
      if (character === "'" || character === '"') quote = character;
      else if (character === "(") parentheses += 1;
      else if (character === ")") parentheses -= 1;
      else if (character === "{") braces += 1;
      else if (character === "}") braces -= 1;
      if (
        /\s/u.test(character) &&
        parentheses === 0 &&
        braces === 0 &&
        /^\s+[a-z_][a-z0-9_.]*\s*=/iu.test(text.slice(cursor))
      ) {
        break;
      }
      cursor += 1;
    }
    const rawText = text.slice(valueStart, cursor).trim();
    if (!rawText) break;
    result.push({
      name,
      rawText,
      start: valueStart,
      end: valueStart + text.slice(valueStart, cursor).trimEnd().length,
    });
  }
  return result;
}

/** Physical UTF-16 ranges for a parsed .param; same assignment grammar, not textual name replacement. */
export function locateSpiceParameterValues(statement: ParameterStatement) {
  // Mask comments and continuation prefixes without shifting any physical offsets.
  const raw = statement.rawText;
  const chars = raw.split("");
  for (const line of physicalLines(raw)) {
    const content = line.content;
    const trimmed = content.trimStart();
    const visible = trimmed.startsWith("*") ? "" : stripInlineComment(content);
    for (let i = visible.length; i < content.length; i++)
      chars[line.startOffset + i] = " ";
    if (trimmed.startsWith("+"))
      chars[line.startOffset + content.indexOf("+")] = " ";
  }
  const masked = chars.join("");
  const prefix = /^\s*\.param\s+/iu.exec(masked);
  if (!prefix) return [];
  const offset = prefix[0].length;
  const assignments = scanParameterAssignments(masked.slice(offset));
  // A locator cannot authorize an edit if it did not recover the parser's assignments exactly.
  if (
    assignments.length !== statement.parameters.length ||
    assignments.some(
      (p, i) =>
        p.name.toLowerCase() !== statement.parameters[i]!.name.toLowerCase() ||
        p.rawText.replace(/\s+/gu, "") !==
          statement.parameters[i]!.rawText.replace(/\s+/gu, ""),
    )
  )
    return [];
  return assignments.map((p) => ({
    name: p.name,
    startOffset: statement.sourceRef.start.offset + offset + p.start,
    endOffset: statement.sourceRef.start.offset + offset + p.end,
  }));
}

function positionalAndParameters(
  tokens: string[],
  sourceRef: SourceSpan,
): { positional: string[]; parameters: RawSpiceParameter[] } {
  const firstParameter = tokens.findIndex(
    (token, index) =>
      token.toLowerCase() === "params:" ||
      token.includes("=") ||
      tokens[index + 1] === "=",
  );
  if (firstParameter < 0) {
    return { positional: tokens, parameters: [] };
  }
  return {
    positional: tokens.slice(0, firstParameter),
    parameters: parametersFromTokens(tokens.slice(firstParameter), sourceRef),
  };
}

function opaque(
  line: LogicalLine,
  reason: string,
  probableType: OpaqueSyntaxStatement["probableType"],
  severity: "warning" | "error" = "warning",
): { statement: OpaqueSyntaxStatement; diagnostic: SpiceDiagnostic } {
  return {
    statement: {
      kind: "opaque",
      rawText: line.rawText,
      sourceRef: line.sourceRef,
      reason,
      ...(probableType ? { probableType } : {}),
    },
    diagnostic: diagnostic(
      severity === "error" ? "SPICE_SYNTAX_MALFORMED" : "SPICE_SYNTAX_OPAQUE",
      severity,
      "syntax",
      `Statement preserved as opaque: ${reason}`,
      line.sourceRef,
    ),
  };
}

function valueParameter(
  name: string,
  rawText: string | undefined,
  sourceRef: SourceSpan,
): RawSpiceParameter[] {
  return rawText ? [{ name, rawText, sourceRef }] : [];
}

function parseInstance(
  fields: string[],
  line: LogicalLine,
): { statement: SpiceStatement; diagnostic?: SpiceDiagnostic } {
  const name = fields[0] ?? "";
  const prefix = name.slice(0, 1).toUpperCase();
  const { positional, parameters } = positionalAndParameters(
    fields.slice(1),
    line.sourceRef,
  );
  const base = { name, rawText: line.rawText, sourceRef: line.sourceRef };
  const malformed = (reason: string) =>
    opaque(line, reason, "element", "error");

  const simple: Record<
    string,
    { family: CurrentInstanceFamily; nodes: number; value: string }
  > = {
    R: { family: "resistor", nodes: 2, value: "value" },
    C: { family: "capacitor", nodes: 2, value: "value" },
    L: { family: "inductor", nodes: 2, value: "value" },
    V: { family: "voltage-source", nodes: 2, value: "value" },
    I: { family: "current-source", nodes: 2, value: "value" },
    E: { family: "vcvs", nodes: 4, value: "gain" },
    G: { family: "vccs", nodes: 4, value: "gain" },
  };
  const shape = simple[prefix];
  if (shape) {
    if (
      positional.length < shape.nodes ||
      (positional.length === shape.nodes && parameters.length === 0)
    ) {
      return malformed(
        `${prefix} instance requires ${shape.nodes} nodes and a ${shape.value}`,
      );
    }
    const rawValueTokens = positional.slice(shape.nodes);
    const isIndependentSource =
      shape.family === "voltage-source" || shape.family === "current-source";
    const hasExplicitDc =
      isIndependentSource && rawValueTokens[0]?.toLowerCase() === "dc";
    const isBareDcValue = isIndependentSource && rawValueTokens.length === 1;
    const valueName = hasExplicitDc || isBareDcValue ? "dc" : shape.value;
    const rawValue = (
      hasExplicitDc ? rawValueTokens.slice(1) : rawValueTokens
    ).join(" ");
    return {
      statement: {
        kind: "instance",
        ...base,
        family: shape.family,
        nodes: positional.slice(0, shape.nodes),
        parameters: [
          ...parameters,
          ...valueParameter(valueName, rawValue, line.sourceRef),
        ],
      },
    };
  }
  if (prefix === "B") {
    if (positional.length < 2) {
      return malformed("B instance requires two nodes and an expression");
    }
    const expression = positional.slice(2).join(" ");
    if (!expression && parameters.length === 0) {
      return malformed("B instance expression is missing");
    }
    return {
      statement: {
        kind: "instance",
        ...base,
        family: "behavioral-source",
        nodes: positional.slice(0, 2),
        parameters: [
          ...parameters,
          ...valueParameter(
            "expression",
            expression || undefined,
            line.sourceRef,
          ),
        ],
      },
    };
  }
  if (prefix === "F" || prefix === "H") {
    if (
      positional.length < 3 ||
      (positional.length === 3 && parameters.length === 0)
    ) {
      return malformed(
        `${prefix} instance requires two nodes, a control source, and gain`,
      );
    }
    return {
      statement: {
        kind: "instance",
        ...base,
        family: prefix === "F" ? "cccs" : "ccvs",
        nodes: positional.slice(0, 2),
        controlSource: positional[2]!,
        parameters: [
          ...parameters,
          ...valueParameter(
            "gain",
            positional.slice(3).join(" "),
            line.sourceRef,
          ),
        ],
      },
    };
  }
  if (prefix === "K") {
    if (
      positional.length < 2 ||
      (positional.length === 2 && parameters.length === 0)
    ) {
      return malformed(
        "K instance requires at least two inductors and a coupling value",
      );
    }
    return {
      statement: {
        kind: "instance",
        ...base,
        family: "mutual-inductor",
        nodes: [],
        parameters: [
          ...parameters,
          {
            name: "inductors",
            rawText: (positional.length >= 3
              ? positional.slice(0, -1)
              : positional
            ).join(" "),
            sourceRef: line.sourceRef,
          },
          ...valueParameter(
            "coupling",
            positional.length >= 3 ? positional.at(-1) : undefined,
            line.sourceRef,
          ),
        ],
      },
    };
  }
  if (prefix === "T") {
    if (
      positional.length < 4 ||
      (positional.length === 4 && parameters.length === 0)
    ) {
      return malformed("T instance requires four nodes and line parameters");
    }
    return {
      statement: {
        kind: "instance",
        ...base,
        family: "lossless-transmission-line",
        nodes: positional.slice(0, 4),
        parameters: [
          ...parameters,
          ...valueParameter(
            "line-specification",
            positional.slice(4).join(" ") || undefined,
            line.sourceRef,
          ),
        ],
      },
    };
  }
  const fixedModeled: Record<
    string,
    { family: CurrentInstanceFamily; nodes: number }
  > = {
    D: { family: "diode", nodes: 2 },
    J: { family: "jfet", nodes: 3 },
    M: { family: "mosfet", nodes: 4 },
    O: { family: "lossy-transmission-line", nodes: 4 },
    S: { family: "switch", nodes: 4 },
    U: { family: "uniform-rc-line", nodes: 3 },
    Y: { family: "single-lossy-transmission-line", nodes: 4 },
    Z: { family: "mesfet", nodes: 3 },
  };
  const modeledShape = fixedModeled[prefix];
  if (modeledShape) {
    if (positional.length < modeledShape.nodes + 1) {
      return malformed(`${prefix} instance is missing nodes or model`);
    }
    return {
      statement: {
        kind: "instance",
        ...base,
        family: modeledShape.family,
        nodes: positional.slice(0, modeledShape.nodes),
        master: positional[modeledShape.nodes]!,
        parameters: [
          ...parameters,
          ...valueParameter(
            "positional-tail",
            positional.slice(modeledShape.nodes + 1).join(" ") || undefined,
            line.sourceRef,
          ),
        ],
      },
    };
  }
  if (prefix === "Q") {
    if (positional.length < 4) {
      return malformed("Q instance is missing nodes or model");
    }
    const possibleTail = positional[4]?.toLowerCase();
    const fourthAfterModelLooksLikeValue =
      possibleTail === "off" ||
      possibleTail?.startsWith("{") ||
      possibleTail?.startsWith("'") ||
      (possibleTail ? parseSpiceNumber(possibleTail) !== null : false);
    const hasSubstrate =
      positional.length >= 5 && !fourthAfterModelLooksLikeValue;
    const nodeCount = hasSubstrate ? 4 : 3;
    return {
      statement: {
        kind: "instance",
        ...base,
        family: "bjt",
        nodes: positional.slice(0, nodeCount),
        master: positional[nodeCount]!,
        parameters: [
          ...parameters,
          ...valueParameter(
            "positional-tail",
            positional.slice(nodeCount + 1).join(" ") || undefined,
            line.sourceRef,
          ),
        ],
      },
    };
  }
  if (prefix === "W") {
    if (positional.length < 4) {
      return malformed(
        "W instance requires two nodes, a control source, and model",
      );
    }
    return {
      statement: {
        kind: "instance",
        ...base,
        family: "current-switch",
        nodes: positional.slice(0, 2),
        controlSource: positional[2]!,
        master: positional[3]!,
        parameters,
      },
    };
  }
  if (prefix === "P") {
    if (positional.length < 3) {
      return malformed(
        "P instance requires conductor nodes and a coupled-line model",
      );
    }
    return {
      statement: {
        kind: "instance",
        ...base,
        family: "coupled-multiconductor-line",
        nodes: positional.slice(0, -1),
        master: positional.at(-1)!,
        parameters,
      },
    };
  }
  if (prefix === "X") {
    if (positional.length < 2) {
      return malformed("X instance requires at least one node and a master");
    }
    return {
      statement: {
        kind: "instance",
        ...base,
        family: "subcircuit",
        nodes: positional.slice(0, -1),
        master: positional.at(-1)!,
        parameters,
      },
    };
  }
  return opaque(line, "unsupported element family", "element");
}

function parseLogicalLine(line: LogicalLine): {
  statement: SpiceStatement;
  diagnostic?: SpiceDiagnostic;
} {
  if (line.orphanContinuation) {
    return opaque(line, "orphan continuation", "element", "error");
  }
  const fields = splitSpiceFields(line.text);
  const keyword = fields[0]?.toLowerCase() ?? "";
  const rawText = line.rawText;
  const sourceRef = line.sourceRef;
  if (keyword === ".include") {
    const requestedPath = fields[1]?.replace(/^(?:"|')|(?:"|')$/gu, "");
    if (!requestedPath)
      return opaque(line, "include path is missing", "directive", "error");
    return {
      statement: { kind: "include", requestedPath, rawText, sourceRef },
    };
  }
  if (keyword === ".incpslt") {
    const requestedPath = fields[1]?.replace(/^(?:"|')|(?:"|')$/gu, "");
    if (!requestedPath)
      return opaque(line, "incpslt path is missing", "directive", "error");
    return {
      statement: {
        kind: "include",
        requestedPath,
        rawText,
        sourceRef,
      },
    };
  }
  if (keyword === ".lib") {
    const first = fields[1]?.replace(/^(?:"|')|(?:"|')$/gu, "");
    const section = fields[2];
    if (!first)
      return opaque(line, "library section is missing", "directive", "error");
    return {
      statement: section
        ? {
            kind: "library",
            mode: "include",
            requestedPath: first,
            section,
            rawText,
            sourceRef,
          }
        : {
            kind: "library",
            mode: "section-start",
            section: first,
            rawText,
            sourceRef,
          },
    };
  }
  if (keyword === ".endl") {
    return {
      statement: {
        kind: "library",
        mode: "section-end",
        section: fields[1] ?? "",
        rawText,
        sourceRef,
      },
    };
  }
  if (keyword === ".subckt") {
    const name = fields[1];
    if (!name)
      return opaque(line, "subckt name is missing", "directive", "error");
    const { positional, parameters } = positionalAndParameters(
      fields.slice(2),
      sourceRef,
    );
    return {
      statement: {
        kind: "subckt_start",
        name,
        ports: positional,
        parameters,
        rawText,
        sourceRef,
      },
    };
  }
  if (keyword === ".ends") {
    const name = fields[1];
    return {
      statement: {
        kind: "subckt_end",
        ...(name ? { name } : {}),
        rawText,
        sourceRef,
      },
    };
  }
  if (keyword === ".param") {
    const parameters = parametersFromTokens(fields.slice(1), sourceRef);
    if (parameters.length === 0)
      return opaque(line, "param assignment is missing", "directive", "error");
    return { statement: { kind: "parameter", parameters, rawText, sourceRef } };
  }
  if (keyword === ".model") {
    if (!fields[1] || !fields[2])
      return opaque(
        line,
        "model name or type is missing",
        "directive",
        "error",
      );
    return {
      statement: {
        kind: "model",
        name: fields[1],
        modelType: fields[2],
        rawParameters: fields.slice(3).join(" "),
        rawText,
        sourceRef,
      },
    };
  }
  if (keyword === ".global") {
    if (fields.length < 2)
      return opaque(line, "global net list is missing", "directive", "error");
    return {
      statement: { kind: "global", names: fields.slice(1), rawText, sourceRef },
    };
  }
  if (keyword === ".func") {
    const signature = fields[1] ?? "";
    const match = /^([a-z_][a-z0-9_.]*)\(([^)]*)\)$/iu.exec(signature);
    const rawExpression = fields.slice(2).join(" ");
    if (!match || !rawExpression) {
      return opaque(
        line,
        "function signature is malformed",
        "directive",
        "error",
      );
    }
    return {
      statement: {
        kind: "function",
        name: match[1]!,
        arguments: match[2]!
          .split(",")
          .map((argument) => argument.trim())
          .filter(Boolean),
        rawExpression,
        rawText,
        sourceRef,
      },
    };
  }
  if ([".if", ".elseif", ".else", ".endif"].includes(keyword)) {
    const form = keyword.slice(1) as ConditionalStatement["form"];
    const rawExpression = fields.slice(1).join(" ");
    if ((form === "if" || form === "elseif") && !rawExpression) {
      return opaque(
        line,
        `${form} expression is missing`,
        "directive",
        "error",
      );
    }
    return {
      statement: {
        kind: "conditional",
        form,
        ...(rawExpression ? { rawExpression } : {}),
        rawText,
        sourceRef,
      },
    };
  }
  if (keyword === ".control" || keyword === ".endc") {
    return {
      statement: {
        kind: "control_boundary",
        form: keyword === ".control" ? "start" : "end",
        rawText,
        sourceRef,
      },
    };
  }
  const directiveCategories: Record<string, DirectiveStatement["category"]> = {
    ac: "analysis",
    csparam: "option",
    dc: "analysis",
    disto: "analysis",
    end: "metadata",
    four: "output",
    ic: "option",
    meas: "output",
    measure: "output",
    nodeset: "option",
    noise: "analysis",
    op: "analysis",
    options: "option",
    plot: "output",
    print: "output",
    probe: "output",
    pss: "analysis",
    pz: "analysis",
    save: "output",
    sens: "analysis",
    sp: "analysis",
    temp: "option",
    tf: "analysis",
    title: "metadata",
    tran: "analysis",
    width: "output",
  };
  if (keyword.startsWith(".")) {
    const name = keyword.slice(1);
    const category = directiveCategories[name];
    if (category) {
      return {
        statement: {
          kind: "directive",
          name,
          arguments: fields.slice(1),
          category,
          rawText,
          sourceRef,
        },
      };
    }
    return opaque(line, `unsupported directive ${keyword}`, "directive");
  }
  return parseInstance(fields, line);
}

export function parseSpiceSource(
  source: SpiceSourceFile,
  options: { titleLine?: boolean } = {},
): SpiceSyntaxFile {
  const logicalLines = buildLogicalLines(source);
  const statements: SpiceStatement[] = [];
  const diagnostics: SpiceDiagnostic[] = [];
  let inControl = false;
  for (const line of logicalLines) {
    const fields = splitSpiceFields(line.text);
    const keyword = fields[0]?.toLowerCase() ?? "";
    if (
      options.titleLine !== false &&
      line.physicalLines[0] === 1 &&
      !keyword.startsWith(".")
    ) {
      statements.push({
        kind: "directive",
        name: "title",
        arguments: [line.text],
        category: "metadata",
        rawText: line.rawText,
        sourceRef: line.sourceRef,
      });
      continue;
    }
    if (inControl && keyword !== ".endc") {
      statements.push({
        kind: "control_command",
        command: fields[0] ?? "",
        arguments: fields.slice(1),
        rawText: line.rawText,
        sourceRef: line.sourceRef,
      });
      continue;
    }
    const parsed = parseLogicalLine(line);
    statements.push(parsed.statement);
    if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
    if (
      parsed.statement.kind === "control_boundary" &&
      parsed.statement.form === "end" &&
      !inControl
    ) {
      diagnostics.push(
        diagnostic(
          "SPICE_SYNTAX_UNMATCHED_ENDC",
          "error",
          "syntax",
          ".endc has no matching .control",
          parsed.statement.sourceRef,
        ),
      );
    }
    if (
      parsed.statement.kind === "control_boundary" &&
      parsed.statement.form === "start"
    ) {
      inControl = true;
    } else if (
      parsed.statement.kind === "control_boundary" &&
      parsed.statement.form === "end"
    ) {
      inControl = false;
    }
  }
  if (inControl) {
    const start = statements.findLast(
      (statement) =>
        statement.kind === "control_boundary" && statement.form === "start",
    );
    diagnostics.push(
      diagnostic(
        "SPICE_SYNTAX_UNTERMINATED_CONTROL",
        "error",
        "syntax",
        ".control section has no matching .endc",
        start?.sourceRef,
      ),
    );
  }
  return { fileId: source.id, statements, logicalLines, diagnostics };
}
