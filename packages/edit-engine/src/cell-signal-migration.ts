import { z } from "zod";
import {
  deriveStableId,
  isSupplyPortSymbol,
  renamedLabelFormat,
  type CircuitProject,
} from "@icm/model";
import { bindsProjectCell } from "@icm/devices";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
} from "@icm/symbols";
import { migrateSignalContacts } from "./signal-contact-migration.js";
import {
  planSignalMemberMigration,
  type SignalMigrationOptions,
} from "./signal-member-migration.js";
import type { ProjectStructureEdit } from "./project-transaction.js";
import { lockedLayoutOwner } from "./transaction-routing.js";
import {
  captureLockedAnnotations,
  assertLockedAnnotationsUnchanged,
} from "./annotation-locks.js";

export const CellSignalMigrationEditSchema = z.strictObject({
  kind: z.literal("migrate_cell_signal"),
  documentId: z.string().min(1),
  terminalId: z.string().min(1),
  expression: z.string().min(1).max(256),
  memberMap: z
    .record(z.string().min(1), z.string().min(1).max(256).nullable())
    .optional(),
  convertLegacy: z.boolean().optional(),
  expectedRevisions: z.record(
    z.string().min(1),
    z.number().int().nonnegative(),
  ),
});
type CellSignalMigrationEdit = z.infer<typeof CellSignalMigrationEditSchema>;

function affectedDocuments(project: CircuitProject, documentId: string) {
  return project.documents.filter(
    (document) =>
      document.id === documentId ||
      document.instances.some(
        (instance) =>
          instance.netlist?.binding?.kind === "subcircuit" &&
          instance.netlist.binding.childDocumentId === documentId,
      ),
  );
}

export function planCellSignalMigration(
  project: CircuitProject,
  documentId: string,
  terminalId: string,
  expression: string,
  options: SignalMigrationOptions,
): ProjectStructureEdit[] {
  const edit: CellSignalMigrationEdit = {
    kind: "migrate_cell_signal",
    documentId,
    terminalId,
    expression,
    ...(options.memberMap ? { memberMap: options.memberMap } : {}),
    ...(options.convertLegacy ? { convertLegacy: true } : {}),
    expectedRevisions: Object.fromEntries(
      affectedDocuments(project, documentId).map((document) => [
        document.id,
        document.revision,
      ]),
    ),
  };
  // The same semantic validation serves preview and execution.
  applyCellSignalMigration(structuredClone(project), edit);
  return [edit];
}

/** Executed only inside the Project's clone/validate/commit boundary. */
export function applyCellSignalMigration(
  project: CircuitProject,
  edit: CellSignalMigrationEdit,
): string[] {
  const child = project.documents.find(
    (document) => document.id === edit.documentId,
  );
  const terminal = child?.netlist?.terminals.find(
    (item) => item.id === edit.terminalId,
  );
  if (!child || !terminal) throw new Error("Cell signal owner is unavailable");
  const marker = terminal.interfaceInstanceIds[0];
  if (
    !marker ||
    isSupplyPortSymbol(
      child.instances.find((instance) => instance.id === marker)?.symbolId ??
        "",
    )
  )
    throw new Error(
      "Native and Power Rail interfaces cannot be converted to aggregate signals",
    );
  if (!terminal.signal && !edit.convertLegacy)
    throw new Error(
      "Legacy scalar conversion requires an explicit conversion action",
    );
  const previous = terminal.signal?.members ?? [
    { id: terminal.id, name: terminal.name, netId: terminal.netId },
  ];
  const migration = planSignalMemberMigration(
    terminal.id,
    previous,
    edit.expression,
    { ...(edit.memberMap ? { memberMap: edit.memberMap } : {}) },
    String(child.revision),
  );
  if (migration.unresolved.length)
    throw new Error(
      `Explicit member mapping or disconnect is required for ${migration.unresolved.map((member) => member.name).join(", ")}`,
    );
  const documents = affectedDocuments(project, child.id);
  const lockedAnnotations = new Map(
    documents.map((document) => [
      document.id,
      captureLockedAnnotations(document),
    ]),
  );
  for (const document of documents)
    if (edit.expectedRevisions[document.id] !== document.revision)
      throw new Error(
        `Cell ${document.name} changed; review its migration again`,
      );
  const surviving = new Set(migration.members.map((member) => member.id));
  const resolver = createProjectSymbolResolver(
    structuredClone(project),
    builtInSymbols,
  );
  for (const document of documents) {
    const symbolUpdates = new Map<string, string>();
    const targets =
      document.id === child.id
        ? terminal.interfaceInstanceIds.map((instanceId) => ({
            instanceId,
            pinName: "P",
            nextName: "P",
          }))
        : [];
    for (const instance of document.instances) {
      if (
        instance.netlist?.binding?.kind !== "subcircuit" ||
        instance.netlist.binding.childDocumentId !== child.id
      )
        continue;
      if (bindsProjectCell(instance.symbolId))
        throw new Error(
          `Native Library caller ${instance.reference ?? instance.id} cannot migrate an aggregate interface; clear its model first`,
        );
      if (instance.symbolId !== hierarchicalSymbolId(child.netlist!.name)) {
        const original = resolver.resolve(instance.symbolId)?.definition;
        const captured = project.componentDefinitions?.find(
          (component) => component.symbol.id === instance.symbolId,
        );
        if (!original || captured?.circuitBinding)
          throw new Error(
            `Native or PDK caller ${instance.reference ?? instance.id} cannot migrate its interface`,
          );
        if (!original.pins.some((pin) => pin.name === terminal.name))
          throw new Error(
            `Custom caller ${instance.reference ?? instance.id} artwork lacks port ${terminal.name}`,
          );
        const symbolId = deriveStableId(
          "caller-signal-symbol",
          child.id,
          instance.symbolId,
          terminal.id,
          JSON.stringify(migration.members),
        );
        const renamePin = (pin: (typeof original.pins)[number]) => {
          if (pin.name !== terminal.name) return pin;
          const { signalMembers: _members, ...rest } = pin;
          return {
            ...rest,
            name: edit.expression.trim(),
            ...(migration.members.length > 1
              ? {
                  signalMembers: migration.members.map(({ id, name }) => ({
                    id,
                    name,
                  })),
                }
              : {}),
          };
        };
        project.componentDefinitions ??= [];
        if (
          !project.componentDefinitions.some(
            (component) => component.symbol.id === symbolId,
          )
        )
          project.componentDefinitions.push({
            symbol: {
              ...structuredClone(original),
              id: symbolId,
              pins: original.pins.map(renamePin),
              variants: original.variants.map((variant) => ({
                ...variant,
                hiddenPinNames: variant.hiddenPinNames.map((name) =>
                  name === terminal.name ? edit.expression.trim() : name,
                ),
                ...(variant.auxiliaryPins
                  ? {
                      auxiliaryPins: variant.auxiliaryPins.map((pin) => ({
                        ...pin,
                        name:
                          pin.name === terminal.name
                            ? edit.expression.trim()
                            : pin.name,
                      })),
                    }
                  : {}),
              })),
            },
          });
        symbolUpdates.set(instance.id, symbolId);
      }
      if (instance.importProvenance?.terminalMapping)
        instance.importProvenance.terminalMapping =
          instance.importProvenance.terminalMapping.map((mapping) =>
            mapping.pinName === terminal.name
              ? { ...mapping, pinName: edit.expression.trim() }
              : mapping,
          );
      targets.push({
        instanceId: instance.id,
        pinName: terminal.name,
        nextName: edit.expression.trim(),
      });
    }
    for (const target of targets) {
      const lockOwner = lockedLayoutOwner(document, target.instanceId);
      if (lockOwner)
        throw new Error(
          `Instance ${target.instanceId} is locked by layout intent ${lockOwner}`,
        );
      const matches = (endpoint: { instanceId?: string; pinName?: string }) =>
        endpoint.instanceId === target.instanceId &&
        endpoint.pinName === target.pinName;
      migrateSignalContacts(
        document,
        resolver,
        target,
        previous,
        migration.members,
      );
      for (const net of document.nets)
        net.terminals = net.terminals.flatMap((endpoint) => {
          if (!matches(endpoint)) return [endpoint];
          const id = endpoint.memberId ?? previous[0]!.id;
          if (!surviving.has(id)) return [];
          const { memberId: _memberId, ...rest } = endpoint;
          return [
            {
              ...rest,
              pinName: target.nextName,
              ...(migration.members.length > 1 ? { memberId: id } : {}),
            },
          ];
        });
      document.noConnects = document.noConnects.flatMap((noConnect) => {
        if (!matches(noConnect.endpoint)) return [noConnect];
        const id = noConnect.endpoint.memberId ?? previous[0]!.id;
        if (!surviving.has(id)) return [];
        const { memberId: _memberId, ...endpoint } = noConnect.endpoint;
        return [
          {
            ...noConnect,
            endpoint: {
              ...endpoint,
              pinName: target.nextName,
              ...(migration.members.length > 1 ? { memberId: id } : {}),
            },
          },
        ];
      });
    }
    for (const instance of document.instances) {
      const symbolId = symbolUpdates.get(instance.id);
      if (symbolId) instance.symbolId = symbolId;
    }
  }
  for (const annotation of child.annotations) {
    if (
      annotation.binding?.kind !== "cell-terminal-name" ||
      annotation.binding.terminalId !== terminal.id ||
      !annotation.formatOverride
    )
      continue;
    const format = renamedLabelFormat(
      annotation,
      terminal.name,
      edit.expression.trim(),
      child.presentation,
    );
    if (format) annotation.formatOverride = format;
    else delete annotation.formatOverride;
  }
  terminal.name = edit.expression.trim();
  terminal.signal = { expression: terminal.name, members: migration.members };
  terminal.netId = migration.members[0]!.netId;
  for (const member of migration.members) {
    let net = child.nets.find((net) => net.id === member.netId);
    if (!net) child.nets.push((net = { id: member.netId, terminals: [] }));
    for (const instanceId of terminal.interfaceInstanceIds) {
      const endpoint = {
        instanceId,
        pinName: "P",
        ...(migration.members.length > 1 ? { memberId: member.id } : {}),
      };
      if (
        !net.terminals.some(
          (existing) =>
            existing.instanceId === instanceId &&
            existing.pinName === "P" &&
            existing.memberId === endpoint.memberId,
        )
      )
        net.terminals.push(endpoint);
    }
  }
  for (const document of documents) {
    assertLockedAnnotationsUnchanged(
      document,
      lockedAnnotations.get(document.id)!,
    );
    document.revision += 1;
    document.sourceStatus = "connectivity-modified";
  }
  return documents.map((document) => document.id);
}
