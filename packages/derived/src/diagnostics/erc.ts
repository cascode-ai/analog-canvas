import { flattenRichText, projectCellInterface, routeEnd } from "@icm/model";
import type { CircuitProject } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { ProjectConnectivityIndex } from "../connectivity-index.js";
import { createEndpointConnectivityClassifier } from "../endpoint-connectivity.js";
import {
  resolveDocumentLogicalNets,
  validateLogicalNetContract,
} from "../logical-net.js";
import { resolveMosBulkConnection } from "../mos-bulk.js";
import { resolveEndpointPoint } from "../endpoint.js";
import { resolveDocumentRoutingGeometry } from "../resolved-route-geometry.js";
import { findRouteSegmentsAtPoint } from "../route-query.js";
import { directObjectLocator, type ObjectLocator } from "../object-locator.js";
import type { Diagnostic, DiagnosticSeverity } from "./diagnostic.js";
import { findExternalMasterCollisions } from "../master-names.js";
import {
  deviceDescriptor,
  instanceParameterContract,
  validateDeviceParameters,
} from "@icm/devices";
import type { RoutedComponent } from "../connectivity.js";
import { endpointKey } from "../endpoint.js";
import { supplyMarkerForSymbol } from "../supply-marker.js";

/**
 * Electrical checks share endpoint assessment and the Diagnostic envelope.
 * Electrical findings remain distinct from visual observations; observation
 * counts are not evidence of electrical correctness (Net connectivity rationale).
 */

/** Compatibility aliases for ERC consumers; their protocol is Diagnostic. */
export type ErcSeverity = DiagnosticSeverity;
export type ErcDiagnostic = Diagnostic & { domain: "erc" };

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

  for (const collision of findExternalMasterCollisions(project, documents)) {
    diagnostics.push({
      id: `erc:master-name-collision:${collision.documentId}:${collision.instanceId}`,
      domain: "erc",
      code: "ERC_MASTER_NAME_COLLISION",
      severity: "error",
      confidence: "high",
      gateEligible: true,
      message: `External master ${collision.masterName} conflicts with local Cell ${collision.localName}; choose distinct exported master names`,
      primary: directObjectLocator(
        collision.documentId,
        "instance",
        collision.instanceId,
      ),
      related: [
        directObjectLocator(
          collision.localDocumentId,
          "document",
          collision.localDocumentId,
        ),
      ],
      parameters: { masterName: collision.masterName },
    });
  }

  for (const document of documents) {
    for (const issue of projectCellInterface(document.netlist).issues) {
      const locations = issue.terminalIds.map((terminalId) => {
        const terminal = document.netlist!.terminals.find(
          (item) => item.id === terminalId,
        )!;
        return terminal.interfaceInstanceIds.length
          ? directObjectLocator(
              document.id,
              "instance",
              terminal.interfaceInstanceIds[0]!,
            )
          : terminal.interfaceAnnotationId
            ? directObjectLocator(
                document.id,
                "annotation",
                terminal.interfaceAnnotationId,
              )
            : directObjectLocator(document.id, "net", terminal.netId);
      });
      diagnostics.push({
        id: `erc:cell-port-direction-conflict:${document.id}:${issue.portKey}`,
        domain: "erc",
        code: `ERC_${issue.code}`,
        severity: "error",
        confidence: "high",
        gateEligible: true,
        message: `Port ${issue.portName} has conflicting directions: ${issue.directions.join(", ")}`,
        primary: locations[0]!,
        related: locations.slice(1),
        parameters: { portName: issue.portName },
      });
    }
    const docIndex = index.documents.get(document.id);
    const endpointConnectivity = createEndpointConnectivityClassifier(
      document,
      docIndex,
      resolver,
    );
    const logicalNets =
      docIndex?.logicalNetResolution ?? resolveDocumentLogicalNets(document);
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

    // An Instance the Cell holds but the sheet does not draw is still a device:
    // it keeps its reference, its Net terminals and its cards in the netlist,
    // and a reader looking at the drawing cannot see any of that. The
    // Placement Tray lists them; this says they are there at all.
    const undrawn = document.instances.filter(
      (instance) => instance.placement === null,
    );
    if (undrawn.length > 0) {
      diagnostics.push({
        id: `erc:instance-not-drawn:${document.id}`,
        domain: "erc",
        code: "ERC_INSTANCE_NOT_DRAWN",
        severity: "warning",
        confidence: "high",
        gateEligible: false,
        message: `${undrawn.length} ${
          undrawn.length === 1 ? "Instance is" : "Instances are"
        } in this Cell but not drawn on the sheet (${undrawn
          .slice(0, 5)
          .map((instance) => instance.reference ?? instance.id)
          .join(
            ", ",
          )}${undrawn.length > 5 ? ", …" : ""}); the Placement Tray holds them`,
        primary: directObjectLocator(document.id, "instance", undrawn[0]!.id),
        related: undrawn
          .slice(1)
          .map((instance) =>
            directObjectLocator(document.id, "instance", instance.id),
          ),
        parameters: { count: undrawn.length },
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
        // The parameters the Instance's model owns, as export reads them: a
        // reviewed SKY130 binding owns its w/l/mult, not the built-in value.
        const contract = instanceParameterContract(project, instance);
        if (contract && instance.netlist?.parameters) {
          const allowed = contract.definitions.map(
            (parameter) => parameter.name,
          );
          for (const issue of validateDeviceParameters(
            { parameters: contract.definitions },
            instance.netlist.parameters,
            { open: contract.open },
          )) {
            const allowedText = allowed.length ? allowed.join(", ") : "(none)";
            const message =
              issue.kind === "unknown"
                ? `Instance ${instance.reference ?? instance.id} sets unknown parameter ${issue.name}; allowed parameters: ${allowedText}`
                : issue.kind === "duplicate"
                  ? `Instance ${instance.reference ?? instance.id} repeats parameter ${issue.name} as ${issue.previousName} under case folding`
                  : issue.kind === "select"
                    ? `Instance ${instance.reference ?? instance.id} parameter ${issue.name} must be one of: ${issue.allowed.join(", ")}`
                    : `Instance ${instance.reference ?? instance.id} parameter ${issue.name} must be a finite decimal number`;
            diagnostics.push({
              id: `erc:device-parameter:${document.id}:${instance.id}:${issue.kind}:${issue.name}`,
              domain: "erc",
              code:
                issue.kind === "unknown"
                  ? "ERC_UNKNOWN_DEVICE_PARAMETER"
                  : issue.kind === "duplicate"
                    ? "ERC_DUPLICATE_DEVICE_PARAMETER"
                    : "ERC_INVALID_DEVICE_PARAMETER",
              severity: "error",
              confidence: "high",
              gateEligible: true,
              message,
              primary: directObjectLocator(
                document.id,
                "instance",
                instance.id,
              ),
              related: [],
              parameters: {
                instanceId: instance.id,
                parameter: issue.name,
                ...(issue.kind === "select"
                  ? { allowed: issue.allowed.join(",") }
                  : {}),
              },
            });
          }
        }
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
      } else if (issue.code === "FORMAL_PORT_GLOBAL_NET_CONFLICT") {
        diagnostics.push({
          id: `erc:formal-global-net-conflict:${document.id}:${primaryId}`,
          domain: "erc",
          code: "ERC_FORMAL_PORT_GLOBAL_NET_CONFLICT",
          severity: "error",
          confidence: "high",
          gateEligible: true,
          message:
            "One Logical Net cannot be both a formal Cell Pin and a Global Net",
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
          if (
            netId &&
            !bulkAssessment.electricallySatisfied &&
            !configuredDefault
          ) {
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

    reportPinsTouchingAnotherNet(
      document,
      docIndex,
      logicalNets,
      resolver,
      diagnostics,
    );
    reportDanglingWires(document, diagnostics);
    reportLabelsNamingAnotherPart(document, diagnostics);
    reportShortedTwoPinParts(document, logicalNets, resolver, diagnostics);
    reportNetPiecesJoinedOnlyInData(
      document,
      docIndex,
      logicalNets,
      diagnostics,
    );
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

/**
 * A part whose name label reads another part's name, while that other part
 * shows something else: the drawing then names the wrong devices, and the
 * netlist, which goes by References, disagrees with it. Swapped labels are
 * the usual case.
 *
 * A display alias that reads a name no part has, or the name of a part that
 * shows that same name (several parts drawn as one), is deliberate and stays
 * silent.
 */
function reportLabelsNamingAnotherPart(
  document: CircuitProject["documents"][number],
  diagnostics: ErcDiagnostic[],
): void {
  const fold = (text: string) => text.trim().toLowerCase();
  const byReference = new Map<string, string>();
  for (const instance of document.instances)
    if (instance.reference)
      byReference.set(fold(instance.reference), instance.id);
  // What each part's visible name label reads: its Reference when bound,
  // the literal text otherwise.
  const shown = new Map<string, string>();
  const literal: { annotationId: string; instanceId: string; text: string }[] =
    [];
  for (const annotation of document.annotations) {
    if (annotation.kind !== "instance-label" || annotation.visible === false)
      continue;
    const binding = annotation.binding;
    if (binding?.kind === "instance-reference") {
      const instance = document.instances.find(
        (item) => item.id === binding.instanceId,
      );
      if (instance?.reference && !shown.has(instance.id))
        shown.set(instance.id, instance.reference);
      continue;
    }
    if (binding || annotation.anchor.kind !== "object" || !annotation.content)
      continue;
    const owner = annotation.anchor.objectId;
    const text = flattenRichText(annotation.content).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(text)) continue;
    if (!shown.has(owner)) shown.set(owner, text);
    literal.push({ annotationId: annotation.id, instanceId: owner, text });
  }
  for (const label of literal) {
    const owner = document.instances.find(
      (item) => item.id === label.instanceId,
    );
    if (!owner?.reference || fold(owner.reference) === fold(label.text))
      continue;
    const namedId = byReference.get(fold(label.text));
    if (!namedId || namedId === owner.id) continue;
    const named = document.instances.find((item) => item.id === namedId)!;
    const namedShows = shown.get(namedId);
    if (namedShows && fold(namedShows) === fold(label.text)) continue;
    diagnostics.push({
      id: `erc:label-reference-mismatch:${document.id}:${label.annotationId}`,
      domain: "erc",
      code: "ERC_LABEL_REFERENCE_MISMATCH",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `${owner.reference}'s name label reads ${label.text}, another part's name${
        namedShows ? `, while ${named.reference} reads ${namedShows}` : ""
      }. The netlist calls this part ${owner.reference}; untick Display alias on the label to show its own name.`,
      primary: directObjectLocator(
        document.id,
        "annotation",
        label.annotationId,
      ),
      related: [
        directObjectLocator(document.id, "instance", owner.id),
        directObjectLocator(document.id, "instance", namedId),
      ],
      parameters: {
        instanceId: owner.id,
        reference: owner.reference,
        labelText: label.text,
        namedInstanceId: namedId,
      },
    });
  }
}

/**
 * A wire that ends in the open: at a Junction only that one wire reaches, with
 * no pin, other wire or label there. It is usually what is left of a deleted
 * part or a cut, and it connects nothing. A Power Rail's ends and a wire whose
 * end or run carries a label are drawn that way on purpose and stay silent.
 */
/**
 * A two-pin part whose pins share one Logical Net does nothing: it is
 * shorted. The drawing can still show it in series, as a part dropped onto a
 * wire over the wire's own end once did, with the wire hidden under its body.
 * Parts with more pins are not judged: a dummy transistor ties every pin to
 * one supply on purpose.
 */
function reportShortedTwoPinParts(
  document: CircuitProject["documents"][number],
  logicalNets: ReturnType<typeof resolveDocumentLogicalNets>,
  resolver: SymbolResolver,
  diagnostics: ErcDiagnostic[],
): void {
  const netOfTerminal = new Map<string, string>();
  for (const net of document.nets)
    for (const terminal of net.terminals)
      netOfTerminal.set(
        `${terminal.instanceId}\u0000${terminal.pinName}`,
        net.id,
      );
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) continue;
    const hidden = new Set(resolved.variant?.hiddenPinNames ?? []);
    const pins = resolved.definition.pins.filter(
      (pin) => !hidden.has(pin.name),
    );
    if (pins.length !== 2) continue;
    const [first, second] = pins.map((pin) => {
      const netId = netOfTerminal.get(`${instance.id}\u0000${pin.name}`);
      return netId ? (logicalNets.byBaseNetId.get(netId)?.id ?? netId) : null;
    });
    if (!first || first !== second) continue;
    const name = logicalNets.byId.get(first)?.name;
    const label = instance.reference ?? instance.id;
    diagnostics.push({
      id: `erc:shorted-part:${document.id}:${instance.id}`,
      domain: "erc",
      code: "ERC_SHORTED_DEVICE",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `${label}'s two pins are on one Net${name ? ` (${name})` : ""}, so the part is shorted`,
      primary: directObjectLocator(document.id, "instance", instance.id),
      related: pins.map((pin) =>
        terminalLocator(document.id, instance.id, pin.name),
      ),
      parameters: { instanceId: instance.id, netId: first },
    });
  }
}

/**
 * A drawn piece of a Net that nothing on the sheet joins to the rest: no wire
 * reaches the other pieces, and the piece carries no name of its own (a label,
 * a supply marker, a Cell Pin or a net marker) that would join it by name.
 * Only the stored membership holds it in the Net, so the drawing and the
 * netlist disagree: a bundled example once exported its two drawn tail nodes
 * as ground this way (#1275). Pieces that touch on the sheet (a wire end or
 * pin lying on another piece's wire) look joined and count as one. Pins
 * drawn on no wire at all are ERC_UNCONNECTED_PIN's, and imported topology
 * the editor already shows with routing guides is left alone.
 */
function reportNetPiecesJoinedOnlyInData(
  document: CircuitProject["documents"][number],
  docIndex: ReturnType<ProjectConnectivityIndex["documents"]["get"]>,
  logicalNets: ReturnType<typeof resolveDocumentLogicalNets>,
  diagnostics: ErcDiagnostic[],
): void {
  if (!docIndex || document.routes.length === 0) return;
  const namingInstanceIds = new Set<string>([
    ...(document.netlist?.terminals.flatMap(
      (terminal) => terminal.interfaceInstanceIds,
    ) ?? []),
    ...document.connectivityEvidence.flatMap((evidence) =>
      evidence.kind === "name-claim" && evidence.owner.kind === "power-marker"
        ? [evidence.owner.objectId]
        : [],
    ),
    ...document.instances
      .filter(
        (instance) =>
          supplyMarkerForSymbol(instance.symbolId) !== undefined ||
          deviceDescriptor(instance.symbolId)?.deviceClass === "net-marker",
      )
      .map((instance) => instance.id),
  ]);
  const railRouteIds = new Set(
    document.routes
      .filter((route) => route.presentation === "power-rail")
      .map((route) => route.id),
  );
  const references = new Map(
    document.instances.map((instance) => [
      instance.id,
      instance.reference ?? instance.id,
    ]),
  );
  for (const record of docIndex.logicalNets.values()) {
    if (record.routingGuidance.length > 0) continue;
    const pieces = record.routedComponents;
    if (pieces.length < 2) continue;
    // Where the Net's labels sit: the Route or endpoint each one names.
    const labelled = new Set<string>();
    for (const baseNetId of record.baseNetIds)
      for (const binding of docIndex.netLabelBindingsByNetId.get(baseNetId) ??
        []) {
        if (binding.routeId) labelled.add(`route:${binding.routeId}`);
        labelled.add(endpointKey(binding.endpoint));
      }
    const named = (piece: RoutedComponent): boolean =>
      piece.routes.some(
        (routeId) =>
          railRouteIds.has(routeId) || labelled.has(`route:${routeId}`),
      ) ||
      piece.nodes.some(
        (node) =>
          labelled.has(node.key) ||
          (node.endpoint.kind === "terminal" &&
            namingInstanceIds.has(node.endpoint.instanceId)),
      );
    // Pieces that touch on the sheet are drawn together.
    const group = pieces.map((_, index) => index);
    const root = (index: number): number => {
      while (group[index] !== index) index = group[index]!;
      return index;
    };
    const pieceOfRoute = new Map<string, number>();
    const pieceOfNode = new Map<string, number>();
    pieces.forEach((piece, index) => {
      for (const routeId of piece.routes) pieceOfRoute.set(routeId, index);
      for (const node of piece.nodes) pieceOfNode.set(node.key, index);
    });
    for (const baseNetId of record.baseNetIds)
      for (const contact of docIndex.contactsByNetId.get(baseNetId) ?? []) {
        const touched = [
          ...contact.endpoints.map((endpoint) =>
            pieceOfNode.get(endpointKey(endpoint)),
          ),
          ...contact.incidents.map((incident) =>
            incident.kind === "route"
              ? pieceOfRoute.get(incident.objectId)
              : undefined,
          ),
        ].filter((index): index is number => index !== undefined);
        for (const index of touched.slice(1)) {
          const [left, right] = [root(touched[0]!), root(index)];
          if (left !== right)
            group[Math.max(left, right)] = Math.min(left, right);
        }
      }
    const groups = new Map<number, RoutedComponent[]>();
    pieces.forEach((piece, index) =>
      groups.set(root(index), [...(groups.get(root(index)) ?? []), piece]),
    );
    if (groups.size < 2) continue;
    const name = logicalNets.byId.get(record.netId)?.name;
    for (const drawn of groups.values()) {
      if (drawn.some(named)) continue;
      const piece = drawn.find((candidate) => candidate.routes.length > 0);
      if (!piece) continue;
      const pins = drawn.flatMap((member) =>
        member.nodes.flatMap((node) =>
          node.endpoint.kind === "terminal" ? [node.endpoint] : [],
        ),
      );
      const pinText = pins
        .map(
          (pin) =>
            `${references.get(pin.instanceId) ?? pin.instanceId}.${pin.pinName}`,
        )
        .join(", ");
      diagnostics.push({
        id: `erc:net-joined-only-in-data:${document.id}:${piece.id}`,
        domain: "erc",
        code: "ERC_NET_JOINED_ONLY_IN_DATA",
        severity: "warning",
        confidence: "high",
        gateEligible: false,
        message: `A drawn part of Net ${name ?? record.netId}${pinText ? ` (${pinText})` : ""} is joined to the rest of it only in the data: no wire or name on the sheet joins them. Draw the connection, name that part, or give it its own Net`,
        primary: directObjectLocator(document.id, "route", piece.routes[0]!),
        related: pins.map((pin) =>
          terminalLocator(document.id, pin.instanceId, pin.pinName),
        ),
        parameters: { netId: record.netId, pieceId: piece.id },
      });
    }
  }
}

function reportDanglingWires(
  document: CircuitProject["documents"][number],
  diagnostics: ErcDiagnostic[],
): void {
  const routesByJunction = new Map<
    string,
    CircuitProject["documents"][number]["routes"]
  >();
  for (const route of document.routes)
    for (const endpoint of [route.start, routeEnd(route)])
      if (endpoint.kind === "junction")
        routesByJunction.set(endpoint.junctionId, [
          ...(routesByJunction.get(endpoint.junctionId) ?? []),
          route,
        ]);
  const labelledObjects = new Set(
    document.annotations.flatMap((annotation) =>
      annotation.anchor.kind === "object"
        ? [annotation.anchor.objectId]
        : annotation.anchor.kind === "route"
          ? [annotation.anchor.routeId]
          : [],
    ),
  );
  for (const evidence of document.connectivityEvidence)
    if (
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "power-marker"
    )
      labelledObjects.add(evidence.owner.objectId);
  for (const junction of [...document.junctions].sort((a, b) =>
    a.id.localeCompare(b.id, "en"),
  )) {
    const routes = routesByJunction.get(junction.id) ?? [];
    if (routes.length !== 1) continue;
    const route = routes[0]!;
    if (
      route.presentation === "power-rail" ||
      labelledObjects.has(junction.id) ||
      labelledObjects.has(route.id)
    )
      continue;
    diagnostics.push({
      id: `erc:dangling-wire:${document.id}:${junction.id}`,
      domain: "erc",
      code: "ERC_DANGLING_WIRE",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `Wire ${route.id} ends in the open at Junction ${junction.id}: no pin, other wire or label is there`,
      primary: directObjectLocator(document.id, "junction", junction.id),
      related: [directObjectLocator(document.id, "route", route.id)],
      parameters: { routeId: route.id, junctionId: junction.id },
    });
  }
}

/**
 * A pin the picture shows as wired while the model says it is not: its contact
 * point sits exactly on another Net's wire or Junction dot, or on another
 * part's pin that is not on its Net.
 *
 * Drawing geometry never creates a connection, and a Crossing is not a
 * Junction — so nothing repairs this and nothing else reports it. To the
 * author the wire or pin visibly reaches the pin; to the netlist the pin is on
 * nothing, or on a different Net entirely, and a copy of the drawing, which
 * joins the pins it lands together, reads differently. Only terminals are
 * judged: two Routes crossing is the ordinary, deliberate case the model
 * already names.
 */
function reportPinsTouchingAnotherNet(
  document: CircuitProject["documents"][number],
  docIndex: ReturnType<ProjectConnectivityIndex["documents"]["get"]>,
  logicalNets: ReturnType<typeof resolveDocumentLogicalNets>,
  resolver: SymbolResolver,
  diagnostics: ErcDiagnostic[],
): void {
  if (document.instances.length === 0) return;
  const geometry =
    document.routes.length === 0
      ? undefined
      : (docIndex?.routingGeometry ??
        resolveDocumentRoutingGeometry(document, resolver));
  const routeById = new Map(document.routes.map((route) => [route.id, route]));
  const logicalIdOf = (baseNetId: string | undefined): string | undefined =>
    baseNetId ? logicalNets.byBaseNetId.get(baseNetId)?.id : undefined;
  const netIdByTerminalKey = new Map<string, string>();
  for (const net of document.nets)
    for (const terminal of net.terminals)
      netIdByTerminalKey.set(
        `${terminal.instanceId}\u0000${terminal.pinName}`,
        net.id,
      );
  const declaredOpen = new Set(
    document.noConnects.flatMap((item) =>
      item.endpoint.kind === "terminal"
        ? [`${item.endpoint.instanceId}\u0000${item.endpoint.pinName}`]
        : [],
    ),
  );
  const pinsAtPoint = new Map<
    string,
    {
      instanceId: string;
      pinName: string;
      netId: string | undefined;
      logicalId: string | undefined;
    }[]
  >();

  for (const instance of [...document.instances].sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  )) {
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) continue;
    const hidden = new Set(resolved.variant?.hiddenPinNames ?? []);
    for (const pin of resolved.definition.pins) {
      if (hidden.has(pin.name)) continue;
      const key = `${instance.id}\u0000${pin.name}`;
      // An author who marked the pin open has already answered for it.
      if (declaredOpen.has(key)) continue;
      const point = resolveEndpointPoint(document, resolver, {
        kind: "terminal",
        instanceId: instance.id,
        pinName: pin.name,
      });
      if (!point) continue;
      const pinNetId = netIdByTerminalKey.get(key);
      const pinLogicalId = logicalIdOf(pinNetId);
      const at = `${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}`;
      const here = pinsAtPoint.get(at) ?? [];
      here.push({
        instanceId: instance.id,
        pinName: pin.name,
        netId: pinNetId,
        logicalId: pinLogicalId,
      });
      pinsAtPoint.set(at, here);
      if (!geometry) continue;
      const foreign = findRouteSegmentsAtPoint(geometry, point).flatMap(
        (address) => {
          const route = routeById.get(address.routeId);
          if (!route) return [];
          const routeLogicalId = logicalIdOf(route.netId);
          return routeLogicalId && routeLogicalId !== pinLogicalId
            ? [{ route, netId: route.netId }]
            : [];
        },
      );
      const first = foreign[0];
      if (!first) continue;
      diagnostics.push({
        id: `erc:touching-not-connected:${document.id}:${instance.id}:${pin.name}`,
        domain: "erc",
        code: "ERC_TOUCHING_NOT_CONNECTED",
        severity: "warning",
        confidence: "high",
        gateEligible: false,
        message: pinLogicalId
          ? `Pin ${instance.id}.${pin.name} sits on a wire of Net ${first.netId} but belongs to a different Net`
          : `Pin ${instance.id}.${pin.name} sits on a wire of Net ${first.netId} without being connected to it`,
        primary: terminalLocator(document.id, instance.id, pin.name),
        related: [
          directObjectLocator(document.id, "route", first.route.id),
          directObjectLocator(document.id, "net", first.netId),
        ],
        parameters: {
          instanceId: instance.id,
          pinName: pin.name,
          routeId: first.route.id,
          netId: first.netId,
        },
      });
    }
  }

  // Two parts' pins on one point read as joined. Unless they share a Logical
  // Net, the netlist keeps them apart (often leaving one a dangling node), so
  // each such pair is reported once. Pins on one Net, such as two Ground
  // markers, are the ordinary case.
  for (const pins of pinsAtPoint.values()) {
    for (let index = 0; index < pins.length; index += 1) {
      for (let other = index + 1; other < pins.length; other += 1) {
        const first = pins[index]!;
        const second = pins[other]!;
        if (first.instanceId === second.instanceId) continue;
        if (
          first.logicalId !== undefined &&
          first.logicalId === second.logicalId
        )
          continue;
        const firstName = `${first.instanceId}.${first.pinName}`;
        const secondName = `${second.instanceId}.${second.pinName}`;
        diagnostics.push({
          id: `erc:touching-pin-not-connected:${document.id}:${first.instanceId}:${first.pinName}:${second.instanceId}:${second.pinName}`,
          domain: "erc",
          code: "ERC_TOUCHING_NOT_CONNECTED",
          severity: "warning",
          confidence: "high",
          gateEligible: false,
          message:
            first.logicalId && second.logicalId
              ? `Pins ${firstName} and ${secondName} sit on one point but belong to different Nets`
              : `Pins ${firstName} and ${secondName} sit on one point without being connected`,
          primary: terminalLocator(
            document.id,
            first.instanceId,
            first.pinName,
          ),
          related: [
            terminalLocator(document.id, second.instanceId, second.pinName),
            ...[first.netId, second.netId].flatMap((netId) =>
              netId ? [directObjectLocator(document.id, "net", netId)] : [],
            ),
          ],
          parameters: {
            instanceId: first.instanceId,
            pinName: first.pinName,
            otherInstanceId: second.instanceId,
            otherPinName: second.pinName,
          },
        });
      }
    }
  }
}
