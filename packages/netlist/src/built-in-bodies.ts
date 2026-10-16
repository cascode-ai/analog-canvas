import {
  ADDER_SIGNED_INPUTS,
  ADDER_TARGET,
  IDEAL_COMPARATOR_TARGET,
  OPAMP_TARGET,
  adderBodySigns,
  builtInModelContract,
  builtInSubcircuitDescriptors,
  isIdealComparatorBody,
  isIdealOpampBody,
} from "@icm/devices";
import type { SpiceBuiltInBody } from "@icm/spice";

import { printSpectreBehavioralModel } from "./behavioral-model.js";
import {
  generatedBehavioralDefinition,
  generatedBehavioralModel,
} from "./generated-models.js";
import { idealAnalogBlockCell } from "./ideal-analog-block-models.js";
import { bodySupplies } from "./implicit-mos-supplies.js";
import type { NetlistFormat } from "./net-name-codec.js";
import { printGeneratedCell } from "./printers.js";

/** One statement of a source: the lines it spans and its joined text. */
interface Statement {
  first: number;
  last: number;
  text: string;
  comment: boolean;
}

/**
 * A source's statements, each with its continuation lines joined: a SPICE
 * line starting with `+` continues the statement before it, a Spectre line
 * ending in a backslash runs on into the next.
 */
function statements(
  lines: readonly string[],
  format: NetlistFormat,
): Statement[] {
  const result: Statement[] = [];
  let runsOn = false;
  for (const [index, line] of lines.entries()) {
    let text = line.replace(/\r?\n$/u, "");
    const continues = format === "spectre" ? runsOn : /^\s*\+/u.test(text);
    if (format === "spectre") {
      runsOn = /\\\s*$/u.test(text);
      if (runsOn) text = text.replace(/\\\s*$/u, "");
    } else text = text.replace(/^\s*\+/u, "");
    const statement = continues
      ? result.findLast((candidate) => !candidate.comment)
      : undefined;
    if (statement) {
      statement.last = index;
      statement.text += ` ${text}`;
      continue;
    }
    const trimmed = text.trim();
    result.push({
      first: index,
      last: index,
      text: trimmed,
      comment:
        !trimmed ||
        trimmed.startsWith("*") ||
        (format === "spectre" && trimmed.startsWith("//")),
    });
  }
  return result;
}

/**
 * Statements as compared: comments and blank lines left out, spacing
 * collapsed, and in SPICE, which folds case, in lower case.
 */
function comparable(
  statements: readonly Statement[],
  format: NetlistFormat,
): string[] {
  return statements
    .filter((statement) => !statement.comment)
    .map((statement) => {
      const text = statement.text.replace(/\s+/gu, " ").trim();
      return format === "spice" ? text.toLowerCase() : text;
    });
}

/** A subcircuit definition's name and ports, from its first statement. */
function subcircuitHeader(
  text: string,
  format: NetlistFormat,
): { name: string; ports: string[] } | null {
  if (format === "spice") {
    const [keyword, name, ...rest] = text.split(/\s+/u);
    if (keyword?.toLowerCase() !== ".subckt" || !name) return null;
    const end = rest.findIndex(
      (token) => token.toLowerCase() === "params:" || token.includes("="),
    );
    return { name, ports: end < 0 ? rest : rest.slice(0, end) };
  }
  const [, name, rest = ""] =
    /^(?:inline\s+)?subckt\s+([^\s(]+)\s*(.*)$/u.exec(text) ?? [];
  if (!name) return null;
  return {
    name,
    ports: rest.replace(/[()]/gu, " ").split(/\s+/u).filter(Boolean),
  };
}

function endsSubcircuit(text: string, format: NetlistFormat): boolean {
  const keyword = text.split(/\s+/u)[0] ?? "";
  return format === "spice"
    ? keyword.toLowerCase() === ".ends"
    : keyword === "ends";
}

/**
 * The block a subcircuit is the body of, if Analog Canvas prints exactly
 * these statements for it with these ports: printing the body again and
 * comparing statement for statement tells it from an author's subcircuit of
 * the same name.
 */
function builtInBody(
  header: { name: string; ports: readonly string[] },
  body: readonly Statement[],
  format: NetlistFormat,
): SpiceBuiltInBody | null {
  const name = format === "spice" ? header.name.toLowerCase() : header.name;
  const behavioral =
    isIdealOpampBody(name) ||
    isIdealComparatorBody(name) ||
    ["logic", "signal"].includes(builtInModelContract(name)?.family ?? "");
  const cell = behavioral ? null : idealAnalogBlockCell(name, format);
  if (!behavioral && !cell) return null;
  const own = cell
    ? cell.ports.map((port) => port.name)
    : generatedBehavioralDefinition(name).ports;
  const order = header.ports.map((port) =>
    own.find((candidate) =>
      format === "spice"
        ? candidate.toLowerCase() === port.toLowerCase()
        : candidate === port,
    ),
  );
  if (
    order.length !== own.length ||
    !order.every((port): port is string => port !== undefined) ||
    new Set(order).size !== own.length
  )
    return null;
  const printed = cell
    ? printGeneratedCell(
        {
          ...cell,
          ports: order.flatMap((port) =>
            cell.ports.filter((candidate) => candidate.name === port),
          ),
        },
        format,
      )
    : format === "spice"
      ? generatedBehavioralModel(name, order)
      : printSpectreBehavioralModel(generatedBehavioralDefinition(name, order));
  const expected = comparable(statements(printed, format), format);
  const actual = comparable(body, format);
  if (
    expected.length !== actual.length ||
    expected.some((text, index) => text !== actual[index])
  )
    return null;
  const target = isIdealOpampBody(name)
    ? OPAMP_TARGET
    : isIdealComparatorBody(name)
      ? "comparator"
      : adderBodySigns(name)
        ? ADDER_TARGET
        : name;
  const descriptor = builtInSubcircuitDescriptors.find(
    (candidate) => candidate.target === target,
  );
  const ports = order.flatMap((port) => {
    const found = descriptor?.ports.find(
      (candidate) => candidate.name === port,
    );
    return found ? [found] : [];
  });
  if (!descriptor || ports.length !== order.length) return null;
  // A body that reads neither supply takes ground for one nothing was
  // bound to. The op-amp is the exception: a bound VDD powers it, and only
  // its numeric body is unpowered.
  const unread = bodySupplies(name, new Set(), format).length === 0;
  const signs = adderBodySigns(name);
  return {
    name: header.name,
    symbolId: descriptor.symbolId,
    target: isIdealComparatorBody(name)
      ? IDEAL_COMPARATOR_TARGET
      : descriptor.target,
    ...(signs?.includes("-")
      ? {
          parameters: Object.fromEntries(
            ADDER_SIGNED_INPUTS.flatMap((input, index) =>
              signs[index] === "-" ? [[input.parameter, "-"]] : [],
            ),
          ),
        }
      : {}),
    ports: ports.map((port) =>
      port.supply
        ? {
            supply: port.supply,
            unboundAtGround:
              unread &&
              !(
                port.supply === "VDD" &&
                isIdealOpampBody(name) &&
                name !== OPAMP_TARGET
              ),
          }
        : { pinName: port.pinName },
    ),
  };
}

/**
 * The bodies Analog Canvas writes itself (an op-amp's, a logic gate's, an
 * ideal block's) that a netlist source defines, for the SPICE / SCS import
 * to bring each call of one in as the block that wrote it. `text` is the
 * source with each such Spectre body's statements blanked, its header and
 * parameters kept, so that the conversion to SPICE never meets a behavioral
 * source it cannot convert; a SPICE source comes back unchanged. Every line
 * stays where it was.
 */
export function findBuiltInBodies(
  source: string,
  format: NetlistFormat,
): { bodies: SpiceBuiltInBody[]; text: string } {
  const lines = source.split(/(?<=\n)/u);
  const bodies: SpiceBuiltInBody[] = [];
  let depth = 0;
  let header: ReturnType<typeof subcircuitHeader> = null;
  let block: Statement[] = [];
  for (const statement of statements(lines, format)) {
    const opens = statement.comment
      ? null
      : subcircuitHeader(statement.text, format);
    if (opens && depth++ === 0) {
      header = opens;
      block = [];
    }
    if (depth) block.push(statement);
    if (statement.comment || opens || !depth) continue;
    if (!endsSubcircuit(statement.text, format) || --depth) continue;
    const body = header && builtInBody(header, block, format);
    if (!body) continue;
    bodies.push(body);
    if (format !== "spectre") continue;
    for (const inner of block.slice(1, -1)) {
      if (!inner.comment && /^parameters\s/u.test(inner.text)) continue;
      for (let index = inner.first; index <= inner.last; index++)
        lines[index] = lines[index]?.replace(/^[^\r\n]*/u, "") ?? "";
    }
  }
  return { bodies, text: lines.join("") };
}
