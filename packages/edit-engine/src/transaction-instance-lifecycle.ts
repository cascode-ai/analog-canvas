import { InstanceSchema, NoConnectSchema, routeEndpoints } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { EditTransaction } from "./edit-schema.js";
import type { EditMutationOutcome, RejectEdit } from "./transaction-domain.js";
import { removeConnectivityEvidenceOwnedBy } from "./transaction-connectivity.js";
import { lockedLayoutOwner } from "./transaction-routing.js";
import {
  coupledInductorSwapRefusal,
  remapCoupledInductorDots,
} from "./transaction-inductor-coupling.js";

type InstanceLifecycleEdit = Extract<
  EditTransaction["edits"][number],
  {
    kind:
      | "add_instance"
      | "remove_instance"
      | "add_no_connect"
      | "remove_no_connect"
      | "set_instance_symbol";
  }
>;

export interface InstanceLifecycleEditContext {
  draft: SchematicDocument;
  resolver: SymbolResolver | undefined;
  changedObjectIds: Set<string>;
  deferNetPrune(netId: string): void;
  reject: RejectEdit;
}

export type InstanceLifecycleEditOutcome = EditMutationOutcome;

export function applyInstanceLifecycleEdit(
  edit: InstanceLifecycleEdit,
  context: InstanceLifecycleEditContext,
): InstanceLifecycleEditOutcome {
  const { draft, resolver, changedObjectIds, deferNetPrune, reject } = context;

  switch (edit.kind) {
    case "add_instance": {
      const objectIdExists = [
        ...draft.instances,
        ...draft.nets,
        ...draft.routes,
        ...draft.junctions,
        ...draft.noConnects,
        ...draft.annotations,
        ...draft.layoutGroups,
        ...draft.constraints,
        ...(draft.inductorCouplings ?? []),
      ].some((candidate) => candidate.id === edit.instance.id);
      if (objectIdExists) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Object ID already exists: ${edit.instance.id}`,
          ),
        };
      }
      if (
        !resolver?.resolve(
          edit.instance.symbolId,
          edit.instance.symbolVariantId,
        )
      ) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Symbol does not exist: ${edit.instance.symbolId}`,
          ),
        };
      }
      draft.instances.push(InstanceSchema.parse(edit.instance));
      changedObjectIds.add(edit.instance.id);
      return { ok: true, connectivityChanged: true };
    }
    case "remove_instance": {
      const index = draft.instances.findIndex(
        (candidate) => candidate.id === edit.instanceId,
      );
      if (index < 0) {
        return {
          ok: false,
          rejection: reject(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          ),
        };
      }
      const referenced =
        draft.nets.some((net) =>
          net.terminals.some(
            (terminal) => terminal.instanceId === edit.instanceId,
          ),
        ) ||
        draft.noConnects.some(
          (noConnect) =>
            noConnect.endpoint.kind === "terminal" &&
            noConnect.endpoint.instanceId === edit.instanceId,
        ) ||
        draft.annotations.some(
          (annotation) =>
            annotation.anchor.kind === "object" &&
            annotation.anchor.objectId === edit.instanceId,
        ) ||
        draft.layoutGroups.some((group) =>
          group.objectIds.includes(edit.instanceId),
        ) ||
        draft.constraints.some((constraint) =>
          constraint.objectIds.includes(edit.instanceId),
        ) ||
        (draft.inductorCouplings ?? []).some((coupling) =>
          coupling.members.some(
            (member) => member.instanceId === edit.instanceId,
          ),
        );
      if (referenced) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Instance is still connected or referenced: ${edit.instanceId}`,
          ),
        };
      }
      const ownerNetIds = removeConnectivityEvidenceOwnedBy(
        draft,
        new Set([edit.instanceId]),
        changedObjectIds,
      );
      draft.instances.splice(index, 1);
      changedObjectIds.add(edit.instanceId);
      for (const netId of ownerNetIds) deferNetPrune(netId);
      return { ok: true, connectivityChanged: true };
    }
    case "add_no_connect": {
      const idExists = [
        ...draft.instances,
        ...draft.nets,
        ...draft.routes,
        ...draft.junctions,
        ...draft.noConnects,
        ...draft.annotations,
        ...draft.layoutGroups,
        ...draft.constraints,
        ...(draft.inductorCouplings ?? []),
      ].some((candidate) => candidate.id === edit.noConnect.id);
      if (idExists) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Object ID already exists: ${edit.noConnect.id}`,
          ),
        };
      }
      draft.noConnects.push(NoConnectSchema.parse(edit.noConnect));
      changedObjectIds.add(edit.noConnect.id);
      return { ok: true, connectivityChanged: true };
    }
    case "remove_no_connect": {
      const index = draft.noConnects.findIndex(
        (candidate) => candidate.id === edit.noConnectId,
      );
      if (index < 0) {
        return {
          ok: false,
          rejection: reject(
            "OBJECT_NOT_FOUND",
            `NoConnect does not exist: ${edit.noConnectId}`,
            [],
            [edit.noConnectId],
          ),
        };
      }
      draft.noConnects.splice(index, 1);
      changedObjectIds.add(edit.noConnectId);
      return { ok: true, connectivityChanged: true };
    }
    case "set_instance_symbol": {
      const instance = draft.instances.find(
        (candidate) => candidate.id === edit.instanceId,
      );
      if (!instance) {
        return {
          ok: false,
          rejection: reject(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          ),
        };
      }
      const lockOwner = lockedLayoutOwner(draft, edit.instanceId);
      if (lockOwner) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Instance ${edit.instanceId} is locked by layout intent ${lockOwner}`,
          ),
        };
      }
      if (!resolver) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_CONTEXT_REQUIRED",
            "Symbol edits require a Symbol Resolver",
          ),
        };
      }
      const couplingRefusal = coupledInductorSwapRefusal(
        draft,
        edit.instanceId,
        edit.symbolId,
      );
      if (couplingRefusal)
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            couplingRefusal,
            [],
            [edit.instanceId],
          ),
        };
      const symbolVariantId = edit.symbolVariantId ?? undefined;
      const resolved = resolver.resolve(edit.symbolId, symbolVariantId);
      if (!resolved) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Symbol or variant does not exist: ${edit.symbolId}${symbolVariantId ? `/${symbolVariantId}` : ""}`,
          ),
        };
      }
      const targetPins = new Set(
        resolved.definition.pins.map((pin) => pin.name),
      );
      const pinMap = edit.pinMap ?? {};
      if (
        instance.netlist?.binding?.kind === "subcircuit" &&
        instance.importProvenance?.terminalMapping
      ) {
        instance.importProvenance.terminalMapping =
          instance.importProvenance.terminalMapping.filter((terminal) =>
            targetPins.has(pinMap[terminal.pinName] ?? terminal.pinName),
          );
      }
      const currentPins = new Set(
        draft.nets.flatMap((net) =>
          net.terminals
            .filter((terminal) => terminal.instanceId === edit.instanceId)
            .map((terminal) => terminal.pinName),
        ),
      );
      for (const route of draft.routes) {
        for (const endpoint of routeEndpoints(route)) {
          if (
            endpoint.kind === "terminal" &&
            endpoint.instanceId === edit.instanceId
          ) {
            currentPins.add(endpoint.pinName);
          }
        }
      }
      for (const noConnect of draft.noConnects) {
        if (noConnect.endpoint.instanceId === edit.instanceId) {
          currentPins.add(noConnect.endpoint.pinName);
        }
      }
      for (const terminal of instance.importProvenance?.terminalMapping ?? []) {
        currentPins.add(terminal.pinName);
      }
      for (const sourcePin of Object.keys(pinMap)) {
        if (!currentPins.has(sourcePin)) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `Pin map source is not connected or routed: ${edit.instanceId}.${sourcePin}`,
            ),
          };
        }
      }
      const mappedPins = new Map<string, string>();
      for (const sourcePin of currentPins) {
        const targetPin = pinMap[sourcePin] ?? sourcePin;
        if (!targetPins.has(targetPin)) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `Target symbol pin does not exist: ${edit.instanceId}.${targetPin}`,
            ),
          };
        }
        const previousSource = mappedPins.get(targetPin);
        if (previousSource && previousSource !== sourcePin) {
          const ownerNetIds = new Set(
            draft.nets.flatMap((net) =>
              net.terminals.some(
                (terminal) =>
                  terminal.instanceId === edit.instanceId &&
                  (terminal.pinName === previousSource ||
                    terminal.pinName === sourcePin),
              )
                ? [net.id]
                : [],
            ),
          );
          if (ownerNetIds.size > 1) {
            return {
              ok: false,
              rejection: reject(
                "EDIT_PRECONDITION",
                `Pin map aliases ${previousSource} and ${sourcePin} to ${targetPin} before their Nets are merged`,
              ),
            };
          }
        }
        mappedPins.set(targetPin, sourcePin);
      }
      for (const net of draft.nets) {
        let changed = false;
        for (const terminal of net.terminals) {
          if (terminal.instanceId !== edit.instanceId) continue;
          terminal.pinName = pinMap[terminal.pinName] ?? terminal.pinName;
          changed = true;
        }
        if (changed) changedObjectIds.add(net.id);
        if (changed) {
          net.terminals = net.terminals.filter(
            (terminal, index, terminals) =>
              terminals.findIndex(
                (candidate) =>
                  candidate.instanceId === terminal.instanceId &&
                  candidate.pinName === terminal.pinName,
              ) === index,
          );
        }
      }
      for (const route of draft.routes) {
        let changed = false;
        for (const endpoint of routeEndpoints(route)) {
          if (
            endpoint.kind === "terminal" &&
            endpoint.instanceId === edit.instanceId
          ) {
            endpoint.pinName = pinMap[endpoint.pinName] ?? endpoint.pinName;
            changed = true;
          }
        }
        if (changed) changedObjectIds.add(route.id);
      }
      for (const noConnect of draft.noConnects) {
        if (noConnect.endpoint.instanceId !== edit.instanceId) continue;
        noConnect.endpoint.pinName =
          pinMap[noConnect.endpoint.pinName] ?? noConnect.endpoint.pinName;
        changedObjectIds.add(noConnect.id);
      }
      if (instance.importProvenance?.terminalMapping) {
        instance.importProvenance.terminalMapping =
          instance.importProvenance.terminalMapping.map((terminal) => ({
            ...terminal,
            pinName: pinMap[terminal.pinName] ?? terminal.pinName,
          }));
      }
      remapCoupledInductorDots(
        draft,
        instance.id,
        instance.symbolId,
        edit.symbolId,
        pinMap,
        changedObjectIds,
      );
      instance.symbolId = edit.symbolId;
      if (symbolVariantId === undefined) delete instance.symbolVariantId;
      else instance.symbolVariantId = symbolVariantId;
      changedObjectIds.add(instance.id);
      return { ok: true, connectivityChanged: false };
    }
  }
}
