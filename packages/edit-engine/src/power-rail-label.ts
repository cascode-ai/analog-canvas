import { resolveDocumentLogicalNets } from "@icm/derived";
import {
  foldNetName,
  routeEndpoints,
  type Annotation,
  type SchematicDocument,
} from "@icm/model";

export interface PowerRailSupply {
  netName: string;
  scope: "local" | "global";
  /** When given, only a label on this Net qualifies. */
  netId?: string;
}

/**
 * Whether this is a power label of the supply that stands on no rail, as a
 * body reset or clear-drawing leaves a rail's label for the Cell's callers.
 * The supply's next rail takes such a label over instead of drawing a second
 * one beside it (#1410).
 */
export function isFreePowerRailLabel(
  document: SchematicDocument,
  label: Annotation,
  supply: PowerRailSupply,
): boolean {
  // A locked label stays where its author fixed it.
  if (label.kind !== "power-label" || !label.netId || label.locked)
    return false;
  if (supply.netId !== undefined && label.netId !== supply.netId) return false;
  const binding = label.binding;
  const name =
    supply.scope === "local"
      ? binding?.kind === "cell-terminal-name"
        ? document.netlist?.terminals.find(
            (terminal) =>
              terminal.id === binding.terminalId &&
              terminal.netId === label.netId,
          )?.name
        : undefined
      : binding?.kind === "net-name" && binding.netId === label.netId
        ? resolveDocumentLogicalNets(document).byBaseNetId.get(label.netId)
            ?.name
        : undefined;
  if (!name || foldNetName(name) !== foldNetName(supply.netName)) return false;
  if (label.anchor.kind !== "object") return true;
  const anchorId = label.anchor.objectId;
  return !document.routes.some(
    (route) =>
      route.presentation === "power-rail" &&
      routeEndpoints(route).some(
        (end) => end.kind === "junction" && end.junctionId === anchorId,
      ),
  );
}

/** The supply's free power label, if a reset or clear left one. */
export function freePowerRailLabel(
  document: SchematicDocument,
  supply: PowerRailSupply,
): Annotation | undefined {
  return document.annotations.find((annotation) =>
    isFreePowerRailLabel(document, annotation, supply),
  );
}
