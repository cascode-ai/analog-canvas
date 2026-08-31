import { projectCellInterface } from "@icm/model";
import type { CircuitProject } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { ProjectConnectivityIndex } from "../connectivity-index.js";
import { createEndpointConnectivityClassifier } from "../endpoint-connectivity.js";
import {
  resolveDocumentLogicalNets,
  validateLogicalNetContract,
} from "../logical-net.js";
import { resolveMosBulkConnection } from "../mos-bulk.js";
import { directObjectLocator, type ObjectLocator } from "../object-locator.js";
import type { Diagnostic, DiagnosticSeverity } from "./diagnostic.js";

/**
 * ERC engine (roadmap §8 R8). Emits the unified ADR 0015 `Diagnostic` envelope
 * with `domain: "erc"`, driven by the `ProjectConnectivityIndex` (WP-R2) and the
 * persisted `NoConnect` records (WP-R7). Electrical rules are kept strictly
 * separate from visual/routing observations (ADR 0015): a visual observation
 * count is never proof of electrical correctness.
 *
 * This first batch covers the name-conflict, NoConnect-conflict, and unconnected-
 * pin rules. Role-specific (floating gate/bulk), model-binding, and hierarchy
 * rules extend the same framework in follow-on targets.
 */

/** Compatibility aliases for ERC consumers; their protocol is Diagnostic. */
export type ErcSeverity = DiagnosticSeverity;
export type ErcDiagnostic = Diagnostic & { domain: "erc" };

function noConnectKey(endpoint: {
  kind: "terminal";
  instanceId: string;
  pinName: string;
}): string {
  return `terminal:${endpoint.instanceId}:${endpoint.pinName}`;
}

function terminalLocator(
  documentId: string,
  instanceId: string,
  pinName: string,
): ObjectLocator {
  return {
    ...directObjectLocator(documentId, "terminal", `${instanceId}:${pinName}`),
    endpoint: { kind: "terminal", instanceId, pinName },
  };
}

export function runErcChecks(
  project: CircuitProject,
  index: ProjectConnectivityIndex,
  resolver: SymbolResolver,
): readonly ErcDiagnostic[] {
  const diagnostics: ErcDiagnostic[] = [];
  const documents = [...project.documents].sort((a, b) =>
    a.id.localeCompare(b.id, "en"),
  );

  for (const document of documents) {
    const docIndex = index.documents.get(document.id);
    const endpointConnectivity = createEndpointConnectivityClassifier(
      document,
      docIndex,
      resolver,
    );
    const logicalNets = resolveDocumentLogicalNets(document);
    for (const net of logicalNets.groups) {
      if (net.powerDomain !== "conflict") continue;
      diagnostics.push({
        id: `erc:power-domain-conflict:${document.id}:${net.id}`,
        domain: "erc",
        code: "ERC_POWER_DOMAIN_CONFLICT",
        severity: "error",
        confidence: "high",
        gateEligible: true,
        message: `Logical Net ${net.name ?? net.id} contains incompatible power markers`,
        primary: directObjectLocator(document.id, "net", net.id),
        related: [],
        parameters: { netId: net.id },
      });
    }

    // ERC_UNRESOLVED_SYMBOL and hierarchy interface checks. These run before
    // pin connectivity checks so unknown symbols never get silently skipped.
    for (const instance of document.instances) {
      const missingExternalMaster =
        instance.netlist?.binding?.kind === "external-subcircuit" ||
        instance.netlist?.binding?.kind === "unresolved-subcircuit";
      if (instance.importProvenance?.status === "missing") {
        const code = missingExternalMaster
          ? "ERC_MISSING_EXTERNAL_MASTER"
          : "ERC_MISSING_MODEL";
        diagnostics.push({
          id: `erc:${missingExternalMaster ? "missing-external-master" : "missing-model"}:${document.id}:${instance.id}`,
          domain: "erc",
          code,
          severity: "error",
          confidence: "high",
          gateEligible: true,
          message: missingExternalMaster
            ? `Instance ${instance.id} external master ${instance.importProvenance.sourceMasterName} is missing`
            : `Instance ${instance.id} binding ${instance.importProvenance.kind}:${instance.importProvenance.sourceMasterName} is missing`,
          primary: directObjectLocator(document.id, "instance", instance.id),
          related: [],
          parameters: {
            instanceId: instance.id,
            bindingKind: instance.importProvenance.kind,
            bindingName: instance.importProvenance.sourceMasterName,
          },
        });
      } else if (instance.importProvenance?.status === "unsupported") {
        diagnostics.push({
          id: `erc:unsupported-model:${document.id}:${instance.id}`,
          domain: "erc",
          code: "ERC_UNSUPPORTED_MODEL",
          severity: "warning",
          confidence: "high",
          gateEligible: false,
          message: `Instance ${instance.id} binding ${instance.importProvenance.kind}:${instance.importProvenance.sourceMasterName} is unsupported by the reviewed symbol catalog`,
          primary: directObjectLocator(document.id, "instance", instance.id),
          related: [],
          parameters: {
            instanceId: instance.id,
            bindingKind: instance.importProvenance.kind,
            bindingName: instance.importProvenance.sourceMasterName,
          },
        });
      }
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      if (!resolved) {
        diagnostics.push({
          id: `erc:unresolved-symbol:${document.id}:${instance.id}`,
          domain: "erc",
          code: "ERC_UNRESOLVED_SYMBOL",
          severity: "error",
          confidence: "high",
          gateEligible: true,
          message: `Instance ${instance.id} references unresolved symbol ${instance.symbolId}`,
          primary: directObjectLocator(document.id, "instance", instance.id),
          related: [],
          parameters: { instanceId: instance.id, symbolId: instance.symbolId },
        });
      } else {
        const symbolPinNames = new Set(
          resolved.definition.pins.map((pin) => pin.name),
        );
        const seenImportedPins = new Set<string>();
        const importedPinFacts =
          instance.importProvenance?.terminalMapping ?? [];
        for (const fact of importedPinFacts) {
          const pinName = fact.pinName;
          const invalid =
            !pinName ||
            !symbolPinNames.has(pinName) ||
            seenImportedPins.has(pinName);
          if (!invalid) {
            seenImportedPins.add(pinName);
            continue;
          }
          diagnostics.push({
            id: `erc:illegal-pin-name:${document.id}:${instance.id}:${fact.sourcePosition}`,
            domain: "erc",
            code: "ERC_ILLEGAL_PIN_NAME",
            severity: "error",
            confidence: "high",
            gateEligible: true,
            message: `Imported source terminal ${fact.sourcePosition + 1}=${pinName} does not map uniquely to symbol ${instance.symbolId}`,
            primary: directObjectLocator(document.id, "instance", instance.id),
            related: [],
            parameters: {
              instanceId: instance.id,
              symbolId: instance.symbolId,
              position: fact.sourcePosition,
              ...(pinName ? { pinName } : {}),
            },
          });
        }
      }

      const childBinding = instance.netlist?.binding;
      if (childBinding?.kind !== "subcircuit") continue;
      const childDocumentId = childBinding.childDocumentId;
      const child = project.documents.find(
        (candidate) => candidate.id === childDocumentId,
      );
      if (!child) {
        diagnostics.push({
          id: `erc:hierarchy-target-missing:${document.id}:${instance.id}`,
          domain: "erc",
          code: "ERC_HIERARCHY_TARGET_MISSING",
          severity: "error",
          confidence: "high",
          gateEligible: true,
          message: `Instance ${instance.id} references missing child document ${childDocumentId}`,
          primary: directObjectLocator(document.id, "instance", instance.id),
          related: [],
          parameters: { instanceId: instance.id, childDocumentId },
        });
        continue;
      }
      if (!resolved) continue;
      const pinNames = new Set(resolved.definition.pins.map((pin) => pin.name));
      const childTerminalNames = new Set(
        projectCellInterface(child.netlist).ports.map((port) => port.name),
      );
      if (pinNames.size !== childTerminalNames.size) {
        diagnostics.push({
          id: `erc:port-count-mismatch:${document.id}:${instance.id}`,
          domain: "erc",
          code: "ERC_PORT_COUNT_MISMATCH",
          severity: "error",
          confidence: "high",
          gateEligible: true,
          message: `Instance ${instance.id} has ${pinNames.size} symbol pins but child document ${child.id} has ${childTerminalNames.size} interface terminals`,
          primary: directObjectLocator(document.id, "instance", instance.id),
          related: [],
          parameters: {
            instanceId: instance.id,
            pinCount: pinNames.size,
            portCount: childTerminalNames.size,
          },
        });
      }
      const mismatchedTerminals = projectCellInterface(
        child.netlist,
      ).ports.filter((terminal) => !pinNames.has(terminal.name));
      const unmatchedPins = resolved.definition.pins.filter(
        (pin) => !childTerminalNames.has(pin.name),
      );
      if (mismatchedTerminals.length > 0 || unmatchedPins.length > 0) {
        diagnostics.push({
          id: `erc:port-name-mismatch:${document.id}:${instance.id}`,
          domain: "erc",
          code: "ERC_PORT_NAME_MISMATCH",
          severity: "error",
          confidence: "high",
          gateEligible: true,
          message: `Instance ${instance.id} symbol pins do not match child document ${child.id} interface terminal names`,
          primary: directObjectLocator(document.id, "instance", instance.id),
          related: [],
          parameters: {
            instanceId: instance.id,
            childDocumentId: child.id,
            unmatchedPortCount: mismatchedTerminals.length,
            unmatchedPinCount: unmatchedPins.length,
          },
        });
      }
    }

    // ERC_DUPLICATE_INSTANCE_REFERENCE
    const instancesByReference = new Map<string, string[]>();
    for (const instance of document.instances) {
      const reference = (
        typeof instance.reference === "string" && instance.reference.length > 0
          ? instance.reference
          : instance.id
      ).toLowerCase();
      const group = instancesByReference.get(reference) ?? [];
      group.push(instance.id);
      instancesByReference.set(reference, group);
    }
    for (const [reference, ids] of instancesByReference) {
      if (ids.length < 2) continue;
      const [primaryId, ...restIds] = [...ids].sort((a, b) =>
        a.localeCompare(b, "en"),
      );
      diagnostics.push({
        id: `erc:dup-instance-reference:${document.id}:${reference}`,
        domain: "erc",
        code: "ERC_DUPLICATE_INSTANCE_REFERENCE",
        severity: "error",
        confidence: "high",
        gateEligible: true,
        message: `Instance Reference "${reference}" is used by ${ids.length} instances in document ${document.id}`,
        primary: directObjectLocator(document.id, "instance", primaryId!),
        related: restIds.map((objectId) =>
          directObjectLocator(document.id, "instance", objectId),
        ),
        parameters: { reference, count: ids.length },
      });
    }

    for (const issue of validateLogicalNetContract(document)) {
      const [primaryId, ...relatedIds] = issue.netIds;
      if (issue.code === "CONFLICTING_LOGICAL_NET_NAME") {
        diagnostics.push({
          id: `erc:net-name-conflict:${document.id}:${primaryId}`,
          domain: "erc",
          code: "ERC_NET_NAME_CONFLICT",
          severity: "error",
          confidence: "high",
          gateEligible: true,
          message: `One Logical Net has conflicting name markers`,
          primary: directObjectLocator(document.id, "net", primaryId!),
          related: relatedIds.map((netId) =>
            directObjectLocator(document.id, "net", netId),
          ),
          parameters: { count: issue.netIds.length },
        });
      } else if (issue.code === "CONFLICTING_LOGICAL_NET_SCOPE") {
        diagnostics.push({
          id: `erc:net-scope-conflict:${document.id}:${primaryId}`,
          domain: "erc",
          code: "ERC_NET_SCOPE_CONFLICT",
          severity: "error",
          confidence: "high",
          gateEligible: true,
          message: "One Logical Net has conflicting local/global markers",
          primary: directObjectLocator(document.id, "net", primaryId!),
          related: relatedIds.map((netId) =>
            directObjectLocator(document.id, "net", netId),
          ),
          parameters: { count: issue.netIds.length },
        });
      }
      // Power-domain conflicts are emitted above with the established
      // ERC_POWER_DOMAIN_CONFLICT code so existing diagnostic navigation and
      // filters keep their public behavior.
    }

    // ERC_NO_CONNECT_CONFLICT
    for (const noConnect of document.noConnects) {
      const assessment = endpointConnectivity.assess(noConnect.endpoint);
      const conflictsWithConnection =
        assessment.membership === "peer-connected" ||
        assessment.intent.formalBoundary ||
        assessment.intent.globalSupply;
      if (!conflictsWithConnection) continue;
      const owner = assessment.baseNetId;
      diagnostics.push({
        id: `erc:no-connect-conflict:${document.id}:${noConnect.id}`,
        domain: "erc",
        code: "ERC_NO_CONNECT_CONFLICT",
        severity: "error",
        confidence: "high",
        gateEligible: true,
        message: `NoConnect ${noConnect.id} is also electrically connected${owner ? ` to net ${owner}` : ""}`,
        primary: {
          ...directObjectLocator(document.id, "no-connect", noConnect.id),
          endpoint: noConnect.endpoint,
        },
        related: owner ? [directObjectLocator(document.id, "net", owner)] : [],
        parameters: {
          ...(owner ? { netId: owner } : {}),
          noConnectId: noConnect.id,
        },
      });
    }

    // Role-sensitive checks run before generic visibility policy: a gate or
    // bulk has a distinct electrical explanation and must not produce a second
    // generic ERC_UNCONNECTED_PIN alongside it.
    for (const instance of document.instances) {
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      if (!resolved) continue;
      const hidden = new Set(resolved.variant?.hiddenPinNames ?? []);
      for (const pin of resolved.definition.pins) {
        const endpoint = {
          kind: "terminal" as const,
          instanceId: instance.id,
          pinName: pin.name,
        };
        const assessment = endpointConnectivity.assess(endpoint);
        const netId = assessment.baseNetId ?? undefined;
        const role = pin.role.toLowerCase();

        if (role === "gate") {
          if (!assessment.electricallySatisfied) {
            diagnostics.push({
              id: `erc:floating-gate:${document.id}:${instance.id}:${pin.name}`,
              domain: "erc",
              code: "ERC_FLOATING_GATE",
              severity: "warning",
              confidence: "high",
              gateEligible: false,
              message: netId
                ? `Gate ${instance.id}.${pin.name} is the only endpoint on net ${netId}`
                : `Gate ${instance.id}.${pin.name} is not connected and has no NoConnect`,
              primary: terminalLocator(document.id, instance.id, pin.name),
              related: netId
                ? [directObjectLocator(document.id, "net", netId)]
                : [],
              parameters: {
                instanceId: instance.id,
                pinName: pin.name,
                ...(netId ? { netId } : {}),
              },
            });
          }
          continue;
        }

        if (role === "bulk") {
          const resolution = resolveMosBulkConnection(document, instance);
          const bulkAssessment = endpointConnectivity.assessMosBulk(
            instance.id,
          );
          const configuredDefault =
            resolution?.status === "cell-default" ||
            resolution?.status === "instance-override" ||
            resolution?.status === "supply-default";
          if (!bulkAssessment.electricallySatisfied && !configuredDefault) {
            diagnostics.push({
              id: `erc:bulk-unresolved:${document.id}:${instance.id}:${pin.name}`,
              domain: "erc",
              code: "ERC_BULK_UNRESOLVED",
              severity: "warning",
              confidence: "high",
              gateEligible: false,
              message: netId
                ? `Bulk ${instance.id}.${pin.name} is the only endpoint on net ${netId}`
                : `Bulk ${instance.id}.${pin.name} has no explicit or configured cell-default connection`,
              primary: terminalLocator(document.id, instance.id, pin.name),
              related: [],
              parameters: {
                instanceId: instance.id,
                pinName: pin.name,
                hidden: hidden.has(pin.name),
                ...(netId ? { netId } : {}),
              },
            });
          }
          continue;
        }

        // ERC_UNCONNECTED_PIN (v1-conservative required-pin policy: every
        // visible non-role-specialized pin must have a Net or a NoConnect;
        // passive-pin tolerance is deferred).
        if (hidden.has(pin.name)) continue;
        if (assessment.electricallySatisfied) continue;
        diagnostics.push({
          id: `erc:unconnected-pin:${document.id}:${instance.id}:${pin.name}`,
          domain: "erc",
          code: "ERC_UNCONNECTED_PIN",
          severity: "warning",
          confidence: "high",
          gateEligible: false,
          message: netId
            ? `Pin ${instance.id}.${pin.name} is the only endpoint on net ${netId}`
            : `Pin ${instance.id}.${pin.name} is not connected and has no NoConnect`,
          primary: terminalLocator(document.id, instance.id, pin.name),
          related: netId
            ? [directObjectLocator(document.id, "net", netId)]
            : [],
          parameters: {
            instanceId: instance.id,
            pinName: pin.name,
            ...(netId ? { netId } : {}),
          },
        });
      }
    }
  }

  // A child interface can be shared by several parent instances. Preserve the
  // per-instance mismatch rules above for compatibility, then provide one
  // repair-oriented diagnostic rooted at the child interface with every stale
  // caller as a related location.
  const staleCallersByChild = new Map<
    string,
    {
      child: CircuitProject["documents"][number];
      callers: Array<{
        parentDocumentId: string;
        instanceId: string;
        pinNames: ReadonlySet<string>;
      }>;
    }
  >();
  for (const parent of documents) {
    for (const instance of [...parent.instances].sort((left, right) =>
      left.id.localeCompare(right.id, "en"),
    )) {
      const childBinding = instance.netlist?.binding;
      if (childBinding?.kind !== "subcircuit") continue;
      const childDocumentId = childBinding.childDocumentId;
      const child = project.documents.find(
        (candidate) => candidate.id === childDocumentId,
      );
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      if (!child || !resolved) continue;
      const pinNames = new Set(resolved.definition.pins.map((pin) => pin.name));
      const childPortNames = new Set(
        projectCellInterface(child.netlist).ports.map((port) => port.name),
      );
      const compatible =
        pinNames.size === childPortNames.size &&
        [...pinNames].every((pinName) => childPortNames.has(pinName));
      if (compatible) continue;
      const group = staleCallersByChild.get(child.id) ?? {
        child,
        callers: [],
      };
      group.callers.push({
        parentDocumentId: parent.id,
        instanceId: instance.id,
        pinNames,
      });
      staleCallersByChild.set(child.id, group);
    }
  }
  for (const [childDocumentId, group] of [
    ...staleCallersByChild.entries(),
  ].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const expectedNames = new Set(
      group.callers.flatMap((caller) => [...caller.pinNames]),
    );
    const mismatchedTerminal = [
      ...projectCellInterface(group.child.netlist).ports,
    ]
      .filter((terminal) => !expectedNames.has(terminal.name))
      .sort((left, right) => left.name.localeCompare(right.name, "en"))[0];
    const primary = directObjectLocator(
      group.child.id,
      "document",
      group.child.id,
    );
    diagnostics.push({
      id: `erc:hierarchy-interface-stale:${childDocumentId}`,
      domain: "erc",
      code: "ERC_HIERARCHY_INTERFACE_STALE",
      severity: "error",
      confidence: "high",
      gateEligible: true,
      message: `Child document ${childDocumentId} interface does not match ${group.callers.length} caller instance${group.callers.length === 1 ? "" : "s"}`,
      primary,
      related: group.callers.map((caller) =>
        directObjectLocator(
          caller.parentDocumentId,
          "instance",
          caller.instanceId,
        ),
      ),
      parameters: {
        childDocumentId,
        callerCount: group.callers.length,
        ...(mismatchedTerminal
          ? { childTerminalName: mismatchedTerminal.name }
          : {}),
      },
    });
  }

  return diagnostics.sort(
    (a, b) =>
      a.primary.documentId.localeCompare(b.primary.documentId, "en") ||
      a.code.localeCompare(b.code, "en") ||
      a.primary.objectId.localeCompare(b.primary.objectId, "en"),
  );
}
