// One Cell as the netlist sees it: its pins and ground pin, references,
// instances and the model cards it carries.
import {
  deriveStableId,
  foldNetName,
  projectCellInterface,
  spellGreekLetters,
} from "@icm/model";
import {
  portableCellIdentifier,
  resolveDocumentLogicalNets,
  type PlacedMosBodies,
  type ProjectedNetName,
} from "@icm/derived";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import {
  createReferenceIndex,
  instanceBuiltInSubcircuit,
  nextReference,
} from "@icm/devices";
import type {
  DesignNetlistCell,
  DesignNetlistDeviceClass,
  DesignNetlistInstance,
  DesignNetlistModel,
  NetlistDiagnostic,
} from "./ir.js";
import { bodySupplies } from "./implicit-mos-supplies.js";
import { builtInBlockCallTarget } from "./ideal-analog-block-models.js";
import { IDEAL_SWITCH_MODEL } from "./ideal-switch-model.js";
import {
  type ResolvedDesignNetlistAnalysisOptions,
  compareText,
  diagnostic,
} from "./extract-common.js";
import { encodeCandidate, buildNetContext } from "./extract-nets.js";
import {
  GROUND_PORT_NAME,
  cellReachesGround,
  groundPinName,
  groundPortIndex,
} from "./extract-ground-pin.js";
import { undrivenPhaseNodes } from "./extract-switch.js";
import {
  builtInZenerModelName,
  zenerParameter,
  extractDeviceInstance,
} from "./extract-device.js";
import {
  extractHierarchyInstance,
  extractExternalSubcircuitInstance,
} from "./extract-subcircuit.js";
import { extractBuiltInSubcircuitInstance } from "./extract-block.js";
import {
  reportSubstratesAboveNegativeSupply,
  reportDefaultBodySupplies,
  reportBodiesOffSourceSupply,
} from "./extract-findings.js";
import {
  GENERIC_DIODE_MODEL,
  GENERIC_NPN_MODEL,
  GENERIC_PNP_MODEL,
  definesGenericModel,
  reportGenericDiodes,
  reportUndefinedGenericModels,
  reportGenericBjts,
} from "./extract-generic-models.js";

const MAX_INSTANCES_PER_CELL = 100_000;

export function extractCell(
  project: CircuitProject,
  document: SchematicDocument,
  documentsById: Map<string, SchematicDocument>,
  cellNameByDocumentId: ReadonlyMap<string, string>,
  /** The Project's own subcircuit names; see projectSubcircuitNames. */
  projectNames: ReadonlySet<string>,
  projectedNames: ReadonlyMap<string, ProjectedNetName>,
  placedBodies: PlacedMosBodies | undefined,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistCell | null {
  if (!document.netlist) {
    diagnostic(
      diagnostics,
      document.id,
      "MISSING_CELL_INTERFACE",
      `Document ${document.id} has no netlist interface`,
    );
    return null;
  }
  for (const formal of document.netlist.formalParameters) {
    if (formal.defaultValue !== undefined) continue;
    diagnostic(
      diagnostics,
      document.id,
      "UNREPRESENTABLE_REQUIRED_FORMAL_PARAMETER",
      `Formal parameter ${formal.name} has no portable SPICE/Spectre default`,
    );
  }
  if (document.instances.length > MAX_INSTANCES_PER_CELL) {
    diagnostic(
      diagnostics,
      document.id,
      "INSTANCE_LIMIT_EXCEEDED",
      `Cell has ${document.instances.length} instances; maximum is ${MAX_INSTANCES_PER_CELL}`,
    );
  }
  const context = buildNetContext(
    project,
    document,
    documentsById,
    new Map(
      project.externalSubcircuitDefinitions.map((definition) => [
        definition.id,
        definition,
      ]),
    ),
    projectedNames,
    options,
    diagnostics,
  );
  const interfaceProjection = projectCellInterface(document.netlist);
  for (const issue of interfaceProjection.issues) {
    diagnostic(
      diagnostics,
      document.id,
      issue.code,
      `Port ${issue.portName} has conflicting directions: ${issue.directions.join(", ")}`,
      [...issue.terminalIds],
    );
  }
  const ports: DesignNetlistCell["ports"] = interfaceProjection.ports.flatMap(
    (port) => {
      let hasMissingNet = false;
      for (const netId of port.netIds) {
        if (document.nets.some((candidate) => candidate.id === netId)) continue;
        hasMissingNet = true;
        diagnostic(
          diagnostics,
          document.id,
          "MISSING_INTERFACE_NET",
          `Netlist terminal ${port.name} references unknown Net ${netId}`,
          [netId],
        );
      }
      if (hasMissingNet) return [];
      const logicalNet = resolveDocumentLogicalNets(document).byBaseNetId.get(
        port.netIds[0]!,
      );
      const encodedPort = encodeCandidate(
        port.name,
        logicalNet?.scope ?? "local",
        options,
      );
      if (!encodedPort.ok) {
        diagnostic(
          diagnostics,
          document.id,
          encodedPort.code,
          `Port ${port.name} cannot be encoded for ${options.format}: ${encodedPort.message}`,
          [...port.netIds],
        );
        return [];
      }
      const representativeNetId = port.netIds[0]!;
      const netName = context.nameByNetId.get(representativeNetId) ?? port.name;
      return [{ id: representativeNetId, name: encodedPort.token, netName }];
    },
  );
  // Ground becomes this Cell's own pin: the node inside is named for it, and
  // the pin joins the interface beside the supplies. A Cell that only passes
  // ground to a child gets the node anyway, so the child's reference has
  // somewhere to come from.
  const printedAsSubcircuit = !(
    options.rootAsTopLevel && document.id === options.rootDocumentId
  );
  if (
    options.groundPin === "pin" &&
    printedAsSubcircuit &&
    cellReachesGround(document, documentsById)
  ) {
    const groundName = groundPinName(document);
    const encodedGround = encodeCandidate(groundName.name, "local", options);
    const groundNet = context.nets.find((net) => net.name === "0");
    const groundToken = encodedGround.ok
      ? encodedGround.token
      : groundName.name;
    // An author who already gave ground a pin of their own keeps it: the
    // policy states a reference, it does not duplicate one. The node then
    // takes that pin's name, so no Cell printed as a subcircuit is left
    // reaching for the global reference under a different name.
    const authoredPin = groundNet
      ? ports.find((port) => port.netName === groundNet.name)
      : undefined;
    if (authoredPin && groundNet) {
      for (const [netId, name] of context.nameByNetId)
        if (name === groundNet.name)
          context.nameByNetId.set(netId, authoredPin.name);
      context.nameByAuthoredName.set(foldNetName("0"), authoredPin.name);
      groundNet.name = authoredPin.name;
      groundNet.scope = "local";
      authoredPin.netName = authoredPin.name;
    } else if (groundNet) {
      for (const [netId, name] of context.nameByNetId)
        if (name === "0") context.nameByNetId.set(netId, groundToken);
      context.nameByAuthoredName.set(foldNetName("0"), groundToken);
      groundNet.name = groundToken;
      groundNet.scope = "local";
      ports.splice(groundPortIndex(document, ports), 0, {
        id: groundNet.id,
        name: groundToken,
        netName: groundToken,
      });
    } else {
      // Nothing in this Cell touches ground; it exists only to carry the
      // reference down to a child that does.
      const passThroughId = deriveStableId(
        "netlist",
        "ground-port",
        document.id,
        GROUND_PORT_NAME,
      );
      context.nets.push({
        id: passThroughId,
        name: groundToken,
        scope: "local",
      });
      context.nameByNetId.set(passThroughId, groundToken);
      context.nameByAuthoredName.set(foldNetName("0"), groundToken);
      ports.splice(groundPortIndex(document, ports), 0, {
        id: passThroughId,
        name: groundToken,
        netName: groundToken,
      });
    }
    // The author may have meant that Net as ground, or not: say which name
    // ground's pin took, and how to make the two one.
    if (!authoredPin && groundName.taken !== undefined)
      diagnostic(
        diagnostics,
        document.id,
        "GROUND_PIN_RENAMED",
        `Ground's pin is named ${groundToken}: ${groundName.taken} is another Net here${
          groundNet
            ? `. If ${groundName.taken} is this Cell's ground, connect it to the ground marker`
            : ""
        }`,
        groundNet ? [groundNet.id] : [],
        "info",
      );
  }
  // Node names are final here, ground included, so findings use them.
  reportDefaultBodySupplies(document, context, ports, diagnostics);
  reportBodiesOffSourceSupply(document, context, placedBodies, diagnostics);
  const referenceIndex = createReferenceIndex(document, project);
  const syntheticReferences = new Map<string, string>();
  const reservedReferences = new Set(referenceIndex.byReference.keys());
  for (const instance of [...document.instances].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (instance.reference) continue;
    const policy = referenceIndex.policyByInstanceId.get(instance.id);
    if (!policy) continue;
    const reference = nextReference(referenceIndex, policy, {
      reservedReferences,
    });
    if (!reference) continue;
    syntheticReferences.set(instance.id, reference);
    reservedReferences.add(reference.toLowerCase());
  }
  const reportedDuplicateReferences = new Set<string>();
  for (const issue of referenceIndex.issues) {
    if (issue.code === "MISSING_REFERENCE") continue;
    const otherInstanceIds = issue.otherInstanceId
      ? [issue.otherInstanceId, issue.instanceId]
      : [issue.instanceId];
    switch (issue.code) {
      case "WRONG_REFERENCE_PREFIX": {
        const policy = referenceIndex.policyByInstanceId.get(issue.instanceId);
        const free = policy
          ? nextReference(referenceIndex, policy, { reservedReferences })
          : undefined;
        diagnostic(
          diagnostics,
          document.id,
          "WRONG_REFERENCE_PREFIX",
          `Reference ${issue.reference} does not match ${issue.instanceId}'s component prefix ${issue.expectedPrefix}${free ? `; ${free} is free` : ""}`,
          otherInstanceIds,
        );
        break;
      }
      case "DUPLICATE_REFERENCE":
        if (
          !issue.reference ||
          reportedDuplicateReferences.has(issue.reference.toLowerCase())
        ) {
          break;
        }
        reportedDuplicateReferences.add(issue.reference.toLowerCase());
        diagnostic(
          diagnostics,
          document.id,
          "DUPLICATE_INSTANCE_REFERENCE",
          `Reference ${issue.reference} is duplicated under case folding`,
          otherInstanceIds,
        );
        break;
    }
  }
  const instances: DesignNetlistInstance[] = [];
  const cellPinInstanceIds = new Set(
    interfaceProjection.ports.flatMap((port) => port.interfaceInstanceIds),
  );
  const spelledReferences = new Map<
    string,
    { reference: string; id: string }
  >();
  for (const source of [...document.instances].sort((a, b) => {
    const left = a.reference ?? syntheticReferences.get(a.id) ?? a.id;
    const right = b.reference ?? syntheticReferences.get(b.id) ?? b.id;
    return compareText(left, right) || a.id.localeCompare(b.id);
  })) {
    // Older/Agent-authored drawings can omit references on primitive devices
    // too. Allocate only in this read-only projection, before dialect prefixes.
    // A Greek letter is written as its standard name (Mφ is Mphi).
    const authoredReference =
      source.reference ?? syntheticReferences.get(source.id);
    const reference =
      authoredReference === undefined
        ? undefined
        : spellGreekLetters(authoredReference);
    const instance =
      reference !== source.reference ? { ...source, reference } : source;
    if (reference && authoredReference) {
      const folded = reference.toLowerCase();
      const prior = spelledReferences.get(folded);
      if (!prior) {
        spelledReferences.set(folded, {
          reference: authoredReference,
          id: source.id,
        });
      } else if (
        prior.reference.toLowerCase() !== authoredReference.toLowerCase()
      ) {
        diagnostic(
          diagnostics,
          document.id,
          "DUPLICATE_INSTANCE_REFERENCE",
          `References ${prior.reference} and ${authoredReference} both export as ${reference}`,
          [prior.id, source.id],
        );
      }
    }
    if (cellPinInstanceIds.has(instance.id)) continue;
    const binding = instance.netlist?.binding;
    const builtInSubcircuit = instanceBuiltInSubcircuit(project, instance);
    const extracted = builtInSubcircuit
      ? extractBuiltInSubcircuitInstance(
          document,
          instance,
          builtInSubcircuit,
          instance.reference ?? syntheticReferences.get(instance.id)!,
          context,
          options,
          diagnostics,
          projectNames,
          bodySupplies(
            builtInBlockCallTarget(instance, builtInSubcircuit, projectNames),
            projectNames,
            options.format,
          ).length === 0,
        )
      : binding?.kind === "subcircuit"
        ? extractHierarchyInstance(
            document,
            instance,
            documentsById,
            cellNameByDocumentId,
            context,
            options,
            diagnostics,
          )
        : binding?.kind === "external-subcircuit"
          ? extractExternalSubcircuitInstance(
              document,
              instance,
              project.externalSubcircuitDefinitions.find(
                (definition) => definition.id === binding.definitionId,
              ),
              context,
              diagnostics,
            )
          : extractDeviceInstance(
              project,
              document,
              instance,
              context,
              options,
              diagnostics,
            );
    if (extracted) instances.push(extracted);
  }
  const models: DesignNetlistModel[] = [];
  if (
    instances.some(
      (instance) =>
        instance.deviceClass === "switch" &&
        instance.target === IDEAL_SWITCH_MODEL.name,
    )
  )
    models.push(structuredClone(IDEAL_SWITCH_MODEL));
  // The parts a generic card stands in for, and the Cell then carries it.
  // SPICE only (VACASK prints them from the SPICE cards). A Spectre export
  // still names DIODE, NPN and PNP for the reader's libraries to define.
  const carryGenericCard = (
    model: DesignNetlistModel,
    deviceClass: DesignNetlistDeviceClass,
  ): DesignNetlistInstance[] => {
    const parts =
      options.format === "spice"
        ? instances.filter(
            (instance) =>
              instance.deviceClass === deviceClass &&
              instance.target === model.name,
          )
        : [];
    if (
      !parts.length ||
      definesGenericModel(project, options.deckSources, model)
    )
      return [];
    models.push(structuredClone(model));
    return parts;
  };
  reportSubstratesAboveNegativeSupply(
    document,
    context,
    instances,
    diagnostics,
  );
  const genericDiodes = carryGenericCard(GENERIC_DIODE_MODEL, "diode");
  if (genericDiodes.length)
    reportGenericDiodes(document, genericDiodes, diagnostics);
  const genericBjts = [GENERIC_NPN_MODEL, GENERIC_PNP_MODEL]
    .map((model) => ({ model, parts: carryGenericCard(model, "bjt") }))
    .filter(({ parts }) => parts.length);
  if (genericBjts.length) reportGenericBjts(document, genericBjts, diagnostics);
  if (options.format === "spice")
    reportUndefinedGenericModels(
      project,
      document,
      instances,
      options.deckSources,
      diagnostics,
    );
  for (const extracted of instances) {
    const source = document.instances.find(
      (candidate) => candidate.id === extracted.id,
    );
    if (
      source?.symbolId !== "zener-diode" ||
      source.netlist?.binding !== undefined ||
      extracted.target !== builtInZenerModelName(extracted.reference)
    )
      continue;
    const bv = zenerParameter(source, "bv");
    if (!bv?.trim()) continue;
    const ibv = zenerParameter(source, "ibv");
    models.push({
      name: extracted.target,
      type: "D",
      parameters: [
        { name: "BV", rawValue: bv.trim() },
        ...(ibv?.trim() ? [{ name: "IBV", rawValue: ibv.trim() }] : []),
      ],
    });
  }
  // A clock phase nothing here drives is this Cell's pin, after the authored
  // ones and ground, for its caller or testbench to drive (#1475).
  if (printedAsSubcircuit)
    for (const token of undrivenPhaseNodes.get(context) ?? []) {
      const net = context.nets.find((candidate) => candidate.name === token)!;
      ports.push({ id: net.id, name: token, netName: token });
    }
  return {
    id: document.id,
    name:
      cellNameByDocumentId.get(document.id) ??
      portableCellIdentifier(document.netlist.name, document.id),
    ports,
    nets: context.nets,
    instances,
    ...(models.length ? { models } : {}),
    formalParameters: document.netlist.formalParameters.map((parameter) => ({
      name: parameter.name,
      ...(parameter.defaultValue === undefined
        ? {}
        : { defaultValue: parameter.defaultValue }),
    })),
  };
}
