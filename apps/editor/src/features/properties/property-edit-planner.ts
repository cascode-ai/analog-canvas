import type { ResolvedRouteGeometry } from "@icm/derived";
import { resolveNetLabelBinding } from "@icm/derived";
import { resolveReviewedExternalBinding } from "@icm/devices";
import { planEnsureNamedNet, type SchematicEdit } from "@icm/edit-engine";
import {
  deriveStableId,
  snapGridPoint,
  type Annotation,
  type CircuitProject,
  type ConnectivityEvidence,
  type RichTextDocument,
  type RouteBranch,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { snapCoordinate } from "../../snap/engine";
import {
  componentParameters,
  reviewedExternalComponentParameters,
} from "../component-insert/component-parameters";
import { initialInstanceNetlist } from "../netlist-export/netlist-authoring";

export interface PropertyEditPlannerDependencies {
  project: CircuitProject;
  document: SchematicDocument;
  resolver: SymbolResolver;
  routeGeometryRecords: readonly {
    route: RouteBranch;
    geometry: ResolvedRouteGeometry;
  }[];
  setStatus: (status: string) => void;
}

export interface InstancePropertyDraft {
  instanceId: string | null;
  parameters: Record<string, string>;
  x: string;
  y: string;
  rotation: "0" | "90" | "180" | "270";
}

/** Pure edit planning plus user-facing planner diagnostics for Properties. */
export function createPropertyEditPlanner({
  project,
  document,
  resolver,
  routeGeometryRecords,
  setStatus,
}: PropertyEditPlannerDependencies) {
  const netLabelForRoute = (
    route: SchematicDocument["routes"][number],
  ): Annotation | undefined => {
    const candidates = document.annotations.filter(
      (annotation) =>
        annotation.kind === "net-label" && annotation.netId === route.netId,
    );
    return (
      candidates.find(
        (annotation) => annotation.id === `net-label-${route.id}`,
      ) ??
      candidates.find(
        (annotation) =>
          resolveNetLabelBinding(document, resolver, annotation)?.routeId ===
          route.id,
      )
    );
  };

  const netLabelEditsForRoute = (
    route: SchematicDocument["routes"][number],
    rawName: string,
    presentation?: {
      alignment: "start" | "middle" | "end";
      sizeScale: number;
      formatOverride?: RichTextDocument;
    },
  ): SchematicEdit[] | null => {
    const net = document.nets.find((candidate) => candidate.id === route.netId);
    if (!net) {
      setStatus(`Wire references missing Net ${route.netId}`);
      return null;
    }
    const existingLabel = netLabelForRoute(route);
    const name = rawName.trim();
    if (!name) {
      return existingLabel
        ? [
            {
              kind: "remove_schematic_annotation",
              annotationId: existingLabel.id,
            },
          ]
        : null;
    }
    const labelId = existingLabel?.id ?? `net-label-${route.id}`;
    const namedNetPlan = planEnsureNamedNet(document, {
      candidateNetId: net.id,
      name,
      evidenceId:
        document.connectivityEvidence.find(
          (evidence) =>
            evidence.kind === "name-claim" &&
            evidence.owner.kind === "net-label" &&
            evidence.owner.annotationId === labelId,
        )?.id ??
        deriveStableId(
          "connectivity-evidence",
          document.id,
          "net-label",
          net.id,
          labelId,
        ),
      owner: { kind: "net-label", annotationId: labelId },
    });
    // A rejected plan (name collision, power-domain conflict) must reach the
    // status bar: this planner also backs the text editor's Apply, where a
    // silent null leaves the edit box open with no visible reaction.
    if (!namedNetPlan.ok) {
      setStatus(namedNetPlan.message);
      return null;
    }
    const targetNetId = namedNetPlan.netId;
    const geometry = routeGeometryRecords.find(
      ({ route: candidate }) => candidate.id === route.id,
    )?.geometry;
    if (!geometry) {
      setStatus("Net Label position could not be resolved for this wire");
      return null;
    }
    const segment = Math.max(
      0,
      Math.floor((geometry.centerline.length - 1) / 2),
    );
    const from = geometry.centerline[segment]!;
    const to = geometry.centerline[segment + 1] ?? from;
    const position = snapGridPoint(
      (existingLabel
        ? existingLabel.anchor.kind === "free"
          ? existingLabel.anchor.position
          : existingLabel.anchor.fallbackPosition
        : undefined) ?? {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2 - 8,
      },
      document.presentation.grid,
    );
    const previousAnchor =
      existingLabel?.anchor.kind === "route" &&
      existingLabel.anchor.routeId === route.id
        ? existingLabel.anchor
        : null;
    const edits: SchematicEdit[] = [...namedNetPlan.edits];
    edits.push({
      kind: "upsert_schematic_annotation",
      annotation: {
        id: labelId,
        kind: "net-label",
        binding: { kind: "net-name", netId: targetNetId },
        netId: targetNetId,
        anchor: previousAnchor
          ? { ...previousAnchor, fallbackPosition: position }
          : {
              kind: "route",
              routeId: route.id,
              legId: route.legs[segment]!.id,
              t: 0.5,
              normalOffset: -8,
              direction: "forward",
              orientation: "follow",
              fallbackPosition: position,
            },
        alignment:
          presentation?.alignment ?? existingLabel?.alignment ?? "middle",
        rotation: 0,
        locked: false,
        ...(presentation?.sizeScale !== undefined
          ? { sizeScale: presentation.sizeScale }
          : existingLabel?.sizeScale !== undefined
            ? { sizeScale: existingLabel.sizeScale }
            : {}),
        ...(presentation?.formatOverride
          ? { formatOverride: presentation.formatOverride }
          : {}),
      },
    });
    return edits;
  };

  const netNameEditsForAnnotation = (
    annotation: Annotation,
    rawName: string,
    presentationAnnotation?: Annotation,
  ): SchematicEdit[] | null | undefined => {
    const binding = annotation.binding;
    if (binding?.kind !== "net-name" || annotation.anchor.kind !== "object") {
      return undefined;
    }
    const ownerObjectId = annotation.anchor.objectId;
    const powerClaim = document.connectivityEvidence.find(
      (
        evidence,
      ): evidence is Extract<ConnectivityEvidence, { kind: "name-claim" }> =>
        evidence.kind === "name-claim" &&
        evidence.owner.kind === "power-marker" &&
        (evidence.owner.objectId === ownerObjectId ||
          evidence.owner.objectId === annotation.id),
    );
    if (annotation.kind !== "power-label") return undefined;
    const net = document.nets.find(
      (candidate) => candidate.id === binding.netId,
    );
    if (!net) {
      setStatus(`Net Label references missing Net ${binding.netId}`);
      return null;
    }
    const name = rawName.trim();
    const namedNetPlan = planEnsureNamedNet(document, {
      candidateNetId: net.id,
      name,
      evidenceId:
        powerClaim?.id ??
        deriveStableId(
          "connectivity-evidence",
          document.id,
          "power-marker",
          net.id,
          annotation.id,
        ),
      owner: {
        kind: "power-marker",
        objectId:
          powerClaim?.owner.kind === "power-marker"
            ? powerClaim.owner.objectId
            : annotation.id,
      },
      ...(powerClaim
        ? {
            scope: powerClaim.scope,
            ...(powerClaim.powerDomain
              ? { powerDomain: powerClaim.powerDomain }
              : {}),
          }
        : {}),
    });
    if (!namedNetPlan.ok) {
      setStatus(namedNetPlan.message);
      return null;
    }
    return [
      ...namedNetPlan.edits,
      ...(presentationAnnotation
        ? [
            {
              kind: "upsert_schematic_annotation" as const,
              annotation: presentationAnnotation,
            },
          ]
        : []),
    ];
  };

  const netLabelScopeEdit = (
    annotation: Annotation,
    scope: "local" | "global",
  ): SchematicEdit[] | null => {
    if (annotation.kind !== "net-label") {
      setStatus("Power markers keep their required global scope");
      return null;
    }
    const claim = document.connectivityEvidence.find(
      (
        evidence,
      ): evidence is Extract<ConnectivityEvidence, { kind: "name-claim" }> =>
        evidence.kind === "name-claim" &&
        evidence.owner.kind === "net-label" &&
        evidence.owner.annotationId === annotation.id,
    );
    if (!claim) {
      setStatus("This Net Label has no editable scope claim");
      return null;
    }
    if (claim.scope === scope) return [];
    return [
      {
        kind: "upsert_connectivity_evidence",
        evidence: { ...claim, scope },
      },
    ];
  };

  const propertyParametersForInstance = (
    instance: SchematicDocument["instances"][number],
  ) => {
    const binding = instance.netlist?.binding;
    if (binding?.kind === "external-subcircuit") {
      const definition = project.externalSubcircuitDefinitions.find(
        (candidate) => candidate.id === binding.definitionId,
      );
      const reviewed = definition
        ? resolveReviewedExternalBinding(
            definition.name,
            definition.terminals.map((terminal) => terminal.name),
          )
        : undefined;
      if (reviewed) {
        return reviewedExternalComponentParameters(reviewed);
      }
    }
    return componentParameters(instance.symbolId);
  };

  const instancePropertyEdits = (
    draft: InstancePropertyDraft,
  ): { edits: SchematicEdit[]; invalidPosition: boolean } => {
    if (!draft.instanceId) return { edits: [], invalidPosition: false };
    const instance = document.instances.find(
      (item) => item.id === draft.instanceId,
    );
    if (!instance) return { edits: [], invalidPosition: false };
    const edits: SchematicEdit[] = [];
    const baseNetlist =
      instance.netlist ?? initialInstanceNetlist(instance.symbolId, {});
    if (baseNetlist) {
      const netlistParameters = { ...baseNetlist.parameters };
      const set: Record<string, string> = {};
      const unset: string[] = [];
      for (const parameter of propertyParametersForInstance(instance)) {
        const value = (draft.parameters[parameter.key] ?? "").trim();
        const current = netlistParameters[parameter.key];
        if (value === "") {
          delete netlistParameters[parameter.key];
          if (current !== undefined) unset.push(parameter.key);
        } else {
          netlistParameters[parameter.key] = value;
          if (current !== value) set[parameter.key] = value;
        }
      }

      const nextNetlist = { ...baseNetlist, parameters: netlistParameters };
      if (!instance.netlist) {
        edits.push({
          kind: "set_instance_netlist",
          instanceId: instance.id,
          netlist: nextNetlist,
        });
      } else if (Object.keys(set).length > 0 || unset.length > 0) {
        edits.push({
          kind: "patch_instance_netlist_parameters",
          instanceId: instance.id,
          ...(Object.keys(set).length > 0 ? { set } : {}),
          ...(unset.length > 0 ? { unset } : {}),
        });
      }
    }

    let invalidPosition = false;
    if (instance.placement) {
      const x = Number(draft.x);
      const y = Number(draft.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        invalidPosition = true;
      } else {
        const position = {
          x: snapCoordinate(x, document.presentation.grid),
          y: snapCoordinate(y, document.presentation.grid),
        };
        if (
          position.x !== instance.placement.position.x ||
          position.y !== instance.placement.position.y
        ) {
          edits.push({
            kind: "move_instance",
            instanceId: instance.id,
            position,
          });
        }
      }
      const rotation = Number(draft.rotation) as 0 | 90 | 180 | 270;
      if (rotation !== instance.placement.rotation) {
        edits.push({
          kind: "rotate_instance",
          instanceId: instance.id,
          rotation,
        });
      }
    }
    return { edits, invalidPosition };
  };

  return {
    netLabelForRoute,
    netLabelEditsForRoute,
    netLabelScopeEdit,
    netNameEditsForAnnotation,
    propertyParametersForInstance,
    instancePropertyEdits,
  };
}
