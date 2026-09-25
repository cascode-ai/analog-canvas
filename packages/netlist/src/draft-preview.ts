import type { CircuitProject } from "@icm/model";

import {
  analyzeDesignNetlistForAuthoring,
  type DesignNetlistAnalysisOptions,
} from "./extract.js";
import type { DesignNetlistInstance, NetlistDiagnostic } from "./ir.js";
import { locateDesignNetlist, printDesignNetlist } from "./printers.js";
import type {
  DesignNetlistLocations,
  PrintedNetlistInstance,
} from "./printed-netlist.js";

/** What a draft netlist prints where the drawing does not yet say. */
export const DRAFT_NETLIST_PLACEHOLDER = "?";

export interface DraftNetlistPreview {
  text: string;
  locations: DesignNetlistLocations;
  /** Printed cards of the parts a finding names: where the ? are. */
  flagged: PrintedNetlistInstance[];
  diagnostics: NetlistDiagnostic[];
}

const UNCONNECTED = "<unconnected:";
const MODEL_BEARING = new Set<DesignNetlistInstance["deviceClass"]>([
  "mos",
  "diode",
  "bjt",
  "switch",
  "hierarchical",
]);
/** Parts extraction leaves out whole: they have no card to print. */
const UNPRINTED = new Set([
  "MISSING_DEVICE_DEFINITION",
  "NON_NETLISTABLE_DEVICE",
]);

const key = (documentId: string, instanceId: string) =>
  `${documentId}\u0000${instanceId}`;

/**
 * The netlist a drawing that does not extract yet would have, for reading
 * only. Every part prints as soon as it is placed. An unconnected pin, a
 * missing model and a missing required value print as `?`, and a part with
 * no netlist form is named in a closing comment. A `?` is no identifier in
 * either format, so a draft never passes for a netlist a simulator could
 * take. Export, copy and the Gallery's mark keep asking the strict export,
 * which still refuses.
 */
export function createDraftNetlistPreview(
  project: CircuitProject,
  options: DesignNetlistAnalysisOptions = {},
): DraftNetlistPreview | null {
  const format = options.format ?? "spice";
  const analysis = analyzeDesignNetlistForAuthoring(project, {
    groundPin: "pin",
    ...options,
    format,
  });
  if (!analysis.ir) return null;
  const ir = structuredClone(analysis.ir);
  const missing = new Map<string, string[]>();
  for (const item of analysis.diagnostics) {
    if (item.code !== "MISSING_REQUIRED_PARAMETER" || !item.parameter) continue;
    const owner = key(item.documentId, item.objectIds[0] ?? "");
    missing.set(owner, [...(missing.get(owner) ?? []), item.parameter]);
  }
  for (const cell of ir.cells)
    for (const instance of cell.instances) {
      for (const node of instance.nodes)
        if (node.netName.startsWith(UNCONNECTED))
          node.netName = DRAFT_NETLIST_PLACEHOLDER;
      if (!instance.target && MODEL_BEARING.has(instance.deviceClass))
        instance.target = DRAFT_NETLIST_PLACEHOLDER;
      for (const name of missing.get(key(cell.id, instance.id)) ?? [])
        if (
          !instance.parameters.some(
            (parameter) =>
              parameter.name.toLowerCase() === name.toLowerCase() &&
              parameter.rawValue.trim(),
          )
        )
          instance.parameters = [
            ...instance.parameters.filter(
              (parameter) =>
                parameter.name.toLowerCase() !== name.toLowerCase(),
            ),
            { name, rawValue: DRAFT_NETLIST_PLACEHOLDER },
          ];
    }

  const comment = format === "spice" ? "*" : "//";
  // The strict export drops the printer's title; a draft puts its own first
  // line there, so nobody takes it for a finished netlist. A drawing the
  // printer still cannot render shows no draft, as before.
  let text: string;
  let locations: DesignNetlistLocations;
  try {
    const printed = printDesignNetlist(format, ir).text;
    const body = printed.slice(printed.indexOf("\n") + 1).trimStart();
    text = `${comment} Draft: each ${DRAFT_NETLIST_PLACEHOLDER} is something the drawing does not say yet\n${body}`;
    // Offsets are measured on the text as printed; anything appended after
    // them must come after locating.
    locations = locateDesignNetlist(format, ir, text);
  } catch {
    return null;
  }
  const unprinted = analysis.diagnostics.flatMap((item) => {
    if (!UNPRINTED.has(item.code)) return [];
    const instance = project.documents
      .find((document) => document.id === item.documentId)
      ?.instances.find((candidate) => candidate.id === item.objectIds[0]);
    return instance
      ? [
          `${comment} ${DRAFT_NETLIST_PLACEHOLDER} ${instance.reference ?? instance.id}: ${item.message}`,
        ]
      : [];
  });
  if (unprinted.length)
    text = `${text.replace(/\n*$/u, "\n")}${unprinted.join("\n")}\n`;
  const named = new Set(
    analysis.diagnostics
      .filter((item) => item.severity === "error")
      .flatMap((item) =>
        item.objectIds.map((objectId) => key(item.documentId, objectId)),
      ),
  );
  return {
    text,
    locations,
    flagged: locations.instances.filter((instance) =>
      named.has(key(instance.documentId, instance.instanceId)),
    ),
    diagnostics: analysis.diagnostics,
  };
}
