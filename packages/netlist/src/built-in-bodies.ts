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
import {
  chopperBehavioralDefinition,
  IDEAL_CHOPPER_TARGET,
  IDEAL_SWITCH_MODEL,
  spiceChopperBody,
  switchBehavioralDefinition,
} from "./ideal-switch-model.js";
import { bodySupplies } from "./implicit-mos-supplies.js";
import type { NetlistFormat } from "./net-name-codec.js";
import { printGeneratedCell, spiceModelCard } from "./printers.js";

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

/** Whether a source's statements are, statement for statement, these. */
function samePrinting(
  printed: readonly string[],
  body: readonly Statement[],
  format: NetlistFormat,
): boolean {
  const expected = comparable(statements(printed, format), format);
  const actual = comparable(body, format);
  return (
    expected.length === actual.length &&
    expected.every((text, index) => text === actual[index])
  );
}

/**
 * The part a switch Analog Canvas draws comes back as. Each such switch
 * prints the same card, its control read against the Cell's ground, whether
 * the phase its label names or its CTRL pin drives it, so each comes back as
 * the switch with a CTRL pin. An RNL drawing says which it was.
 */
const SWITCH_PART = {
  symbolId: "externally-controlled-switch",
  referencePrefix: "S",
  ports: [
    { pinName: "P" },
    { pinName: "N" },
    { pinName: "CTRL" },
    { ground: true },
  ],
} as const;

/** Whether a SPICE statement is the ideal switch's model card. */
function isIdealSwitchCard(text: string): boolean {
  const card = spiceModelCard(IDEAL_SWITCH_MODEL);
  return (
    text.replace(/\s+/gu, " ").trim().toLowerCase() ===
    card.replace(/\s+/gu, " ").toLowerCase()
  );
}

/**
 * The chopper's body, if Analog Canvas prints exactly these statements for
 * it: a call of it is the chopper, clocked by the phase its label names.
 */
function chopperBody(
  header: { name: string },
  body: readonly Statement[],
  format: NetlistFormat,
): Omit<SpiceBuiltInBody, "source"> | null {
  const name = format === "spice" ? header.name.toLowerCase() : header.name;
  if (name !== IDEAL_CHOPPER_TARGET) return null;
  const printed =
    format === "spice"
      ? spiceChopperBody()
      : printSpectreBehavioralModel(chopperBehavioralDefinition());
  if (!samePrinting(printed, body, format)) return null;
  return {
    name: header.name,
    kind: "subcircuit",
    symbolId: "chopper",
    referencePrefix: "CH",
    ports: [
      { pinName: "INP" },
      { pinName: "INN" },
      { pinName: "OUTP" },
      { pinName: "OUTN" },
      { phase: true },
    ],
  };
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
): Omit<SpiceBuiltInBody, "source"> | null {
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
  if (!samePrinting(printed, body, format)) return null;
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
    kind: "subcircuit",
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
 * The bodies Analog Canvas writes itself that a netlist source defines (an
 * op-amp's, a logic gate's, an ideal block's, the chopper's, the ideal
 * switch's), for the SPICE / SCS import to bring each card naming one in as
 * the part that wrote it. `text` is the source as the conversion to SPICE
 * takes it: a SPICE source comes back unchanged; in a Spectre one each such
 * body's statements are blanked, its header and parameters kept, so that the
 * conversion never meets a behavioral source it cannot convert, and the
 * ideal switch each Cell defines for its switches goes whole, one empty
 * definition at the end standing for them all. Every line stays where it
 * was.
 */
export function findBuiltInBodies(
  source: string,
  format: NetlistFormat,
  path: string,
): { bodies: SpiceBuiltInBody[]; text: string } {
  const lines = source.split(/(?<=\n)/u);
  const all = statements(lines, format);
  const bodies: SpiceBuiltInBody[] = [];
  const blank = (from: Statement, to: Statement) => {
    for (let index = from.first; index <= to.last; index++)
      lines[index] = lines[index]?.replace(/^[^\r\n]*/u, "") ?? "";
  };
  const open: { header: { name: string; ports: string[] }; start: number }[] =
    [];
  let switchBody: string | null = null;
  for (const [index, statement] of all.entries()) {
    if (statement.comment) continue;
    // A SPICE Cell holding switches carries the ideal switch's model card.
    if (format === "spice" && isIdealSwitchCard(statement.text)) {
      const name = statement.text.split(/\s+/u)[1] ?? IDEAL_SWITCH_MODEL.name;
      bodies.push({
        name,
        kind: "model",
        ...SWITCH_PART,
        source: { path, line: statement.first + 1 },
      });
      continue;
    }
    const opens = subcircuitHeader(statement.text, format);
    if (opens) {
      open.push({ header: opens, start: index });
      continue;
    }
    const closed = endsSubcircuit(statement.text, format)
      ? open.pop()
      : undefined;
    if (!closed) continue;
    const block = all.slice(closed.start, index + 1);
    // A Spectre Cell holding switches defines the ideal switch within it,
    // again in each such Cell, which the conversion refuses.
    if (
      format === "spectre" &&
      closed.header.name === IDEAL_SWITCH_MODEL.name &&
      samePrinting(
        printSpectreBehavioralModel(
          switchBehavioralDefinition(IDEAL_SWITCH_MODEL),
        ),
        block,
        format,
      )
    ) {
      blank(block[0] ?? statement, statement);
      if (switchBody === null) {
        switchBody = closed.header.name;
      }
      continue;
    }
    // Every other body Analog Canvas writes stands at the top level.
    if (open.length) continue;
    const body =
      builtInBody(closed.header, block, format) ??
      chopperBody(closed.header, block, format);
    if (!body) continue;
    bodies.push({ ...body, source: { path, line: block[0]!.first + 1 } });
    if (format !== "spectre") continue;
    for (const inner of block.slice(1, -1)) {
      if (!inner.comment && /^parameters\s/u.test(inner.text)) continue;
      blank(inner, inner);
    }
  }
  const text = lines.join("");
  if (switchBody !== null) {
    bodies.push({
      name: switchBody,
      kind: "subcircuit",
      ...SWITCH_PART,
      source: {
        path,
        line: text.split("\n").length + (text && !text.endsWith("\n") ? 1 : 0),
      },
    });
  }
  return {
    bodies,
    text:
      switchBody === null
        ? text
        : `${text}${text && !text.endsWith("\n") ? "\n" : ""}subckt ${switchBody} (p n cp cn)\nends ${switchBody}\n`,
  };
}
