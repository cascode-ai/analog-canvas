// The model cards a Project's imported files hold, printed again where the
// netlist calls them.
import type { CircuitProject, ProjectModelSource } from "@icm/model";
import { convertNetlist } from "@icm/spice";

import type { DesignNetlistIR } from "./ir.js";
import type { NetlistFormat } from "./net-name-codec.js";
import { inspectProjectModelSource } from "./project-model-source.js";

/** A file's top-level model statements, by name, as the file writes them. */
type Cards = Map<string, string>;

/**
 * The top-level `.model` cards of SPICE text: `+` lines continue a card;
 * cards inside a subcircuit, a `.lib` section, a `.control` block or a
 * Spectre section are the circuit's or a library corner's, not the file's.
 */
function spiceCards(text: string): Cards {
  const cards: Cards = new Map();
  let depth = 0;
  let skipped = false;
  let card: { name: string; lines: string[] } | null = null;
  const close = () => {
    if (card && !cards.has(card.name.toLowerCase()))
      cards.set(card.name.toLowerCase(), card.lines.join("\n"));
    card = null;
  };
  for (const line of text.split(/\r?\n/u)) {
    if (/^\s*\+/u.test(line)) {
      card?.lines.push(line);
      continue;
    }
    if (/^\s*(?:\*|$)/u.test(line)) continue;
    close();
    const words = line.trim().split(/\s+/u);
    const head = words[0]!.toLowerCase();
    if (head === "simulator") skipped = !/lang\s*=\s*spice/iu.test(line);
    else if (head === ".subckt") depth += 1;
    else if (head === ".ends") depth = Math.max(0, depth - 1);
    else if ((head === ".lib" && words.length === 2) || head === ".control")
      skipped = true;
    else if (head === ".endl" || head === ".endc") skipped = false;
    else if (head === ".model" && words[1] && !depth && !skipped)
      card = { name: words[1], lines: [line] };
  }
  close();
  return cards;
}

/**
 * The top-level `model` statements of Spectre text: a line ending in `\`
 * goes on; statements in a subcircuit, a library section or a SPICE section
 * are not the file's.
 */
function spectreCards(text: string): Cards {
  const cards: Cards = new Map();
  let depth = 0;
  let skipped = false;
  let card: { name: string; lines: string[] } | null = null;
  let continued = false;
  for (const line of text.split(/\r?\n/u)) {
    if (continued) {
      card?.lines.push(line);
      continued = /\\\s*$/u.test(line);
      if (!continued && card) {
        if (!cards.has(card.name.toLowerCase()))
          cards.set(card.name.toLowerCase(), card.lines.join("\n"));
        card = null;
      }
      continue;
    }
    if (/^\s*(?:\/\/|\*|$)/u.test(line)) continue;
    const words = line.trim().split(/\s+/u);
    const head = words[0]!.toLowerCase();
    if (head === "simulator") skipped = !/lang\s*=\s*spectre/iu.test(line);
    else if (head === "subckt" || (head === "inline" && words[1] === "subckt"))
      depth += 1;
    else if (head === "ends") depth = Math.max(0, depth - 1);
    else if (head === "section") skipped = true;
    else if (head === "endsection") skipped = false;
    else if (head === "model" && words[1] && !depth && !skipped) {
      card = { name: words[1], lines: [line] };
      continued = /\\\s*$/u.test(line);
      if (!continued) {
        if (!cards.has(card.name.toLowerCase()))
          cards.set(card.name.toLowerCase(), line);
        card = null;
      }
    }
  }
  return cards;
}

/**
 * A SPICE card as Spectre reads it: converted, or in a SPICE section (the
 * converter's own form for a card it keeps as SPICE).
 */
function spectreFromSpice(card: string): string {
  const converted = convertNetlist({
    text: `${card}\n`,
    source: "spice",
    target: "spectre",
    fragment: true,
  });
  return converted.status === "converted"
    ? converted.text
        .replace(/^\s*simulator\s+lang\s*=\s*spectre\s*\n/iu, "")
        .trim()
    : `simulator lang=spice\n${card}\nsimulator lang=spectre`;
}

/**
 * The model cards the files a Project was imported from define at their top
 * level for the models its printed devices call, as each file wrote them (a
 * SPICE card in Spectre as Spectre reads it): the netlist import keeps the
 * files, not their cards, so without them a netlist written again would call
 * models it no longer defines. A card some Cell carries (a stand-in, the
 * ideal switch) or a Project model source declares is printed there instead.
 */
export function sourceModelCards(
  project: Pick<CircuitProject, "source">,
  ir: DesignNetlistIR,
  sources: readonly ProjectModelSource[],
  format: NetlistFormat,
): string[] {
  if (format !== "spice" && format !== "spectre") return [];
  const called = new Set(
    ir.cells.flatMap((cell) =>
      cell.instances.flatMap((instance) =>
        instance.invocationKind === "primitive" && instance.target
          ? [instance.target.toLowerCase()]
          : [],
      ),
    ),
  );
  for (const name of [
    ...ir.cells.flatMap((cell) => (cell.models ?? []).map((m) => m.name)),
    ...sources.flatMap((source) => {
      const inspected = inspectProjectModelSource(source);
      return [...inspected.entries, ...inspected.globalModels].map(
        (declared) => declared.name,
      );
    }),
  ])
    called.delete(name.toLowerCase());
  const printed: string[] = [];
  for (const file of project.source?.files ?? []) {
    const spice = file.content?.text;
    const original = file.originalContent?.text;
    // A Spectre file is kept as written beside its SPICE reading.
    const cards =
      format === "spectre" && original !== undefined
        ? spectreCards(original)
        : spice !== undefined
          ? spiceCards(spice)
          : new Map<string, string>();
    for (const [name, card] of cards) {
      if (!called.has(name)) continue;
      called.delete(name);
      printed.push(
        format === "spectre" && original === undefined
          ? spectreFromSpice(card)
          : card,
      );
    }
  }
  return printed;
}
