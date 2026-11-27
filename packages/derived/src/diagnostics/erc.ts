import { isOptionalSupplyPin, projectCellInterface } from "@icm/model";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { variantHiddenPinNames, type SymbolResolver } from "@icm/symbols";

import type { ProjectConnectivityIndex } from "../connectivity-index.js";
import { createEndpointConnectivityClassifier } from "../endpoint-connectivity.js";
import {
  resolveDocumentLogicalNets,
  validateLogicalNetContract,
} from "../logical-net.js";
import { directObjectLocator } from "../object-locator.js";
import type { Diagnostic } from "./diagnostic.js";
import { terminalLocator } from "./erc-shared.js";
import { reportBiasCurrentOverdrive } from "./bias-current-check.js";
import { reportDeviceIntegrityChecks } from "./device-integrity-checks.js";
import { reportDraftingAndSupplyChecks } from "./drafting-and-supply-checks.js";
import {
  reportLabelsNamingAnotherPart,
  reportLookAlikeNetNames,
  reportNetLabelsNamingNothing,
  reportOverbarNameMismatches,
} from "./label-integrity-checks.js";
import { reportOpAmpPositiveFeedback } from "./opamp-positive-feedback.js";
import {
  reportDanglingWires,
  reportNetPiecesJoinedOnlyInData,
  reportPinsTouchingAnotherNet,
  reportWiresOverlappingAnotherNet,
} from "./routing-integrity-checks.js";
import { reportSwitchChecks } from "./switch-checks.js";
import {
  reportConflictingVoltageOutputs,
  reportShortedTwoPinParts,
  reportStaleHierarchyInterfaces,
  reportUnconnectedCellPins,
  reportUndrivenGateNets,
} from "./topology-checks.js";
import {
  findExternalMasterCollisions,
  libraryPartRetarget,
} from "../master-names.js";
import {
  gateCellBinding,
  gateExternalBinding,
  libraryPartBinding,
  type GateCellPinMatch,
  instanceEvidence,
  instanceParameterContract,
  namesModelOutsideSources,
  milliScaleReading,
  validateDeviceParameters,
  type QuantityForms,
} from "@icm/devices";

/**
 * Electrical checks share endpoint assessment and the Diagnostic envelope.
 * Electrical findings remain distinct from visual observations; observation
 * counts are not evidence of electrical correctness (Net connectivity rationale).
 */

/** Compatibility alias for ERC consumers; its protocol is Diagnostic. */
export type ErcDiagnostic = Diagnostic & { domain: "erc" };

/**
 * "neither a SPICE number nor an expression in braces", or the forms a
 * quantity takes instead: a comparator's high level is a number or VDD.
 */
function notAQuantity(forms: QuantityForms): string {
  const named = [
    "a SPICE number",
    ...(forms.expressions === false ? [] : ["an expression in braces"]),
    ...(forms.keywords ?? []),
  ];
  return named.length > 1
    ? `neither ${named.slice(0, -1).join(", ")} nor ${named.at(-1)}`
    : `not ${named[0]}`;
}

/**
 * A Library part whose Cell or external definition does not meet its pins by
 * name (#1450, #1928).
 */
function partPinMismatch(
  documentId: string,
  instanceId: string,
  match: GateCellPinMatch & { readonly ok: false },
  target: { childDocumentId: string } | { definitionId: string },
): ErcDiagnostic {
  return {
    id: `erc:port-name-mismatch:${documentId}:${instanceId}`,
    domain: "erc",
    code: "ERC_PORT_NAME_MISMATCH",
    severity: "error",
    confidence: "high",
    gateEligible: true,
    message: match.message,
    primary: directObjectLocator(documentId, "instance", instanceId),
    related: [],
    parameters: {
      instanceId,
      ...target,
      unmatchedPortCount: match.extra.length,
      unmatchedPinCount: match.missing.length,
    },
  };
}

export function runErcChecks(
  project: CircuitProject,
  index: Pick<ProjectConnectivityIndex, "documents">,
  resolver: SymbolResolver,
  target?: SchematicDocument,
): readonly ErcDiagnostic[] {
  const diagnostics: ErcDiagnostic[] = [];
  const documents = [...project.documents].sort((a, b) =>
    a.id.localeCompare(b.id, "en"),
  );
  const checkedDocuments = target ? [target] : documents;
  // Parameters of imported PDK models no schema describes, by Cell: one
  // finding each, not one error per name (#2294).
  const unverifiedByDocument = new Map<
    string,
    { instanceId: string; text: string }[]
  >();

  for (const collision of findExternalMasterCollisions(
    project,
    documents,
    checkedDocuments,
  )) {
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

  for (const document of checkedDocuments) {
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
      // A model a library outside the sources holds, typed by the caller or
      // a box of its family, is the supported case of a foundry design:
      // export and runs report it, not ERC (#2294). A model target changed
      // in Canvas since is Canvas's, which the import's status no longer
      // describes.
      const evidence = instanceEvidence(project, instance);
      if (
        instance.importProvenance?.status === "missing" &&
        evidence !== "canvas" &&
        !namesModelOutsideSources(evidence)
      ) {
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
        if (contract?.unverified && instance.netlist?.parameters) {
          const known = new Set(
            contract.definitions.map((parameter) =>
              parameter.name.toLowerCase(),
            ),
          );
          const names = Object.keys(instance.netlist.parameters).filter(
            (name) => !known.has(name.toLowerCase()),
          );
          const binding = instance.netlist.binding;
          if (names.length)
            unverifiedByDocument.set(document.id, [
              ...(unverifiedByDocument.get(document.id) ?? []),
              {
                instanceId: instance.id,
                text: `${instance.reference ?? instance.id} (${binding?.kind === "model" ? binding.name : "?"}): ${names.join(", ")}`,
              },
            ]);
        }
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
                ? `Instance ${instance.reference ?? instance.id} sets unknown parameter ${issue.name}${issue.suggestion ? ` (did you mean ${issue.suggestion}?)` : ""}; allowed parameters: ${allowedText}`
                : issue.kind === "duplicate"
                  ? `Instance ${instance.reference ?? instance.id} repeats parameter ${issue.name} as ${issue.previousName} under case folding`
                  : issue.kind === "select"
                    ? `Instance ${instance.reference ?? instance.id} parameter ${issue.name} must be one of: ${issue.allowed.join(", ")}`
                    : issue.kind === "number"
                      ? `Instance ${instance.reference ?? instance.id} parameter ${issue.name} is "${issue.value}", which ${milliScaleReading(issue.value) ?? `is ${notAQuantity(issue)}`}`
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

      // A Library part bound to an external definition meets its ports by
      // name, as one bound to a Cell does below (#1928).
      const external = gateExternalBinding(project, instance);
      if (external && !external.match.ok)
        diagnostics.push(
          partPinMismatch(document.id, instance.id, external.match, {
            definitionId: external.definition.id,
          }),
        );
      // A part naming another master the Project defines is bound to it, as
      // export binds it (#1928).
      const retarget = libraryPartRetarget(project, instance);
      const retargeted =
        retarget &&
        libraryPartBinding(project, {
          ...instance,
          netlist: {
            parameters: {},
            ...instance.netlist,
            binding: retarget.binding,
          },
        });
      if (retarget && retargeted && !retargeted.match.ok)
        diagnostics.push(
          partPinMismatch(
            document.id,
            instance.id,
            retargeted.match,
            retarget.binding.kind === "subcircuit"
              ? { childDocumentId: retarget.binding.childDocumentId }
              : { definitionId: retarget.binding.definitionId },
          ),
        );
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
      // A Library gate bound to the Cell keeps its own pins, and meets the
      // Cell's Pins by name (#1450).
      const gate = gateCellBinding(project, instance);
      if (gate) {
        if (!gate.match.ok)
          diagnostics.push(
            partPinMismatch(document.id, instance.id, gate.match, {
              childDocumentId: child.id,
            }),
          );
        continue;
      }
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
      const hidden = variantHiddenPinNames(resolved.variant);
      for (const pin of resolved.definition.pins) {
        const members =
          document.netlist?.terminals.find(
            (terminal) =>
              pin.name === "P" &&
              terminal.interfaceInstanceIds.includes(instance.id),
          )?.signal?.members ?? pin.signalMembers;
        if (members && members.length > 1) {
          if (hidden.has(pin.name)) continue;
          for (const member of members) {
            const endpoint = {
              kind: "terminal" as const,
              instanceId: instance.id,
              pinName: pin.name,
              memberId: member.id,
            };
            const assessment = endpointConnectivity.assess(endpoint);
            if (assessment.electricallySatisfied) continue;
            diagnostics.push({
              id: `erc:unconnected-pin:${document.id}:${instance.id}:${pin.name}:${member.id}`,
              domain: "erc",
              code: "ERC_UNCONNECTED_PIN",
              severity: "warning",
              confidence: "high",
              gateEligible: false,
              message: `Member ${instance.reference ?? instance.id}.${member.name} is not connected and has no No Connect`,
              primary: {
                ...terminalLocator(document.id, instance.id, pin.name),
                endpoint,
              },
              related: assessment.baseNetId
                ? [
                    directObjectLocator(
                      document.id,
                      "net",
                      assessment.baseNetId,
                    ),
                  ]
                : [],
              parameters: {
                instanceId: instance.id,
                pinName: pin.name,
                memberId: member.id,
                memberName: member.name,
              },
            });
          }
          continue;
        }
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
          if (
            netId &&
            !endpointConnectivity.assessMosBulk(instance.id)
              .electricallySatisfied
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
        // A supply pin drawn on request, as a block's, left unwired takes
        // its Net in Properties or Auto, as it does hidden (#1833);
        // MISSING_BLOCK_SUPPLY reports one with no Cell supply.
        if (isOptionalSupplyPin(resolved.definition, pin)) continue;
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
    reportUndrivenGateNets(
      document,
      docIndex,
      logicalNets,
      resolver,
      diagnostics,
    );
    reportUnconnectedCellPins(document, docIndex, logicalNets, diagnostics);
    reportLookAlikeNetNames(document, logicalNets, diagnostics);
    reportConflictingVoltageOutputs(
      project,
      document,
      logicalNets,
      diagnostics,
    );
    reportOpAmpPositiveFeedback(project, document, logicalNets, diagnostics);
    reportSwitchChecks(project, document, logicalNets, resolver, diagnostics);
    reportDeviceIntegrityChecks(
      project,
      document,
      logicalNets,
      resolver,
      diagnostics,
    );
    reportDraftingAndSupplyChecks(
      project,
      document,
      docIndex,
      logicalNets,
      resolver,
      diagnostics,
    );
    reportBiasCurrentOverdrive(document, logicalNets, diagnostics);
    reportDanglingWires(document, docIndex, logicalNets, resolver, diagnostics);
    reportNetLabelsNamingNothing(document, diagnostics);
    reportOverbarNameMismatches(document, diagnostics);
    reportLabelsNamingAnotherPart(document, diagnostics);
    reportShortedTwoPinParts(document, logicalNets, resolver, diagnostics);
    reportNetPiecesJoinedOnlyInData(
      document,
      docIndex,
      logicalNets,
      diagnostics,
    );
    reportWiresOverlappingAnotherNet(
      document,
      docIndex,
      logicalNets,
      resolver,
      diagnostics,
    );
  }

  reportStaleHierarchyInterfaces(
    project,
    documents,
    resolver,
    target,
    diagnostics,
  );

  for (const [documentId, parts] of unverifiedByDocument)
    diagnostics.push({
      id: `erc:unverified-device-parameters:${documentId}`,
      domain: "erc",
      code: "ERC_UNVERIFIED_DEVICE_PARAMETERS",
      severity: "info",
      confidence: "high",
      gateEligible: false,
      message: `Parameters kept as written, which no model schema describes, so none is checked: ${parts.map(({ text }) => text).join("; ")}`,
      primary: directObjectLocator(
        documentId,
        "instance",
        parts[0]!.instanceId,
      ),
      related: parts
        .slice(1)
        .map(({ instanceId }) =>
          directObjectLocator(documentId, "instance", instanceId),
        ),
      parameters: { count: parts.length },
    });

  return diagnostics.sort(
    (a, b) =>
      a.primary.documentId.localeCompare(b.primary.documentId, "en") ||
      a.code.localeCompare(b.code, "en") ||
      a.primary.objectId.localeCompare(b.primary.objectId, "en"),
  );
}
