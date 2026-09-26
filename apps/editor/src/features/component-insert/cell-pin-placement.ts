import { planCreateCellPin, type SchematicEdit } from "@icm/edit-engine";
import type { CircuitProject, Instance } from "@icm/model";
import {
  resolveDocumentStyleProfile,
  type SchematicStyleProfile,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import { defaultInstanceDisplayAnnotations } from "../instance-display/default-instance-display";
import { planInitialMosBulkDefault } from "./mos-bulk-defaults";
import { vddPowerLabelAnnotation } from "./vdd-power-label";

/** Shared electrical/display proposal; callers retain their own contact policy. */
export function planPlacedCellPin(
  project: CircuitProject,
  documentId: string,
  resolver: SymbolResolver,
  input: {
    instance: Instance;
    terminalId: string;
    name: string;
    netId: string;
    direction: "input" | "output" | "inout" | "passive";
    connectionEdits: readonly SchematicEdit[];
    styleProfile?: SchematicStyleProfile;
  },
) {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document) throw new Error("Cell not found");
  const supply = input.instance.symbolId === "vdd-port";
  const resolved = supply
    ? resolver.resolve(input.instance.symbolId)
    : undefined;
  const annotation =
    supply && resolved
      ? {
          ...vddPowerLabelAnnotation({
            instance: input.instance,
            resolved,
            netId: input.netId,
            grid: document.presentation.grid,
            name: input.name,
          }),
          binding: {
            kind: "cell-terminal-name" as const,
            terminalId: input.terminalId,
          },
        }
      : defaultInstanceDisplayAnnotations(
          document,
          input.instance,
          resolver,
          input.styleProfile ??
            resolveDocumentStyleProfile(document.presentation),
          { formalTerminalId: input.terminalId, formalName: input.name },
        )[0];
  return planCreateCellPin(project, documentId, {
    instance: input.instance,
    connectionEdits: [
      ...input.connectionEdits,
      ...(supply
        ? planInitialMosBulkDefault(document, "vdd", input.netId)
        : []),
    ],
    terminal: {
      id: input.terminalId,
      name: input.name,
      netId: input.netId,
      direction: input.direction,
      interfaceInstanceIds: [input.instance.id],
    },
    ...(annotation ? { annotation } : {}),
  });
}
