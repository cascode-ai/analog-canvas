import {
  defaultInstanceLabelPlacement,
  displayableInstanceValue,
  type SchematicStyleProfile,
} from "@icm/derived";
import { plainNameDocument } from "@icm/model";
import type { Annotation, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  defaultInstanceLabel,
  defaultInstanceValue,
} from "../wiring/route-interaction-geometry";

type Instance = SchematicDocument["instances"][number];

export interface DefaultInstanceDisplayOptions {
  /** Show the visual annotation (initially a live Netlist Reference projection). */
  readonly showDesignator?: boolean;
  readonly showValue?: boolean;
  readonly masterName?: string;
  readonly formalTerminalId?: string;
}

/** Find the visual annotation, without mistaking older hidden defaults for it. */
export function instanceLabelAnnotationFor(
  document: SchematicDocument,
  instanceId: string,
): Annotation | undefined {
  const candidates = document.annotations.filter(
    (annotation) =>
      (annotation.kind === "instance-label" ||
        annotation.kind === "net-label") &&
      ((!annotation.binding && annotation.kind === "instance-label") ||
        annotation.binding?.kind === "instance-reference" ||
        annotation.binding?.kind === "cell-terminal-name" ||
        annotation.binding?.kind === "net-name") &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === instanceId,
  );
  // Existing files may contain an additional authored label. Preserve it; do
  // not silently delete user content to migrate the former optional-Label UI.
  return (
    candidates.find((annotation) => annotation.visible !== false) ??
    candidates[0]
  );
}

/**
 * One editor policy for default labels. Electrical facts remain in the typed
 * Instance/Cell model; this factory only creates their visual projections.
 */
export function defaultInstanceDisplayAnnotations(
  document: SchematicDocument,
  instance: Instance,
  resolver: SymbolResolver,
  styleProfile: SchematicStyleProfile,
  options: DefaultInstanceDisplayOptions = {},
): readonly Annotation[] {
  const annotations: Annotation[] = [];
  if (options.formalTerminalId) {
    const terminalName = defaultInstanceLabel(
      document,
      instance,
      resolver,
      styleProfile,
    );
    if (terminalName) {
      annotations.push({
        ...terminalName,
        binding: {
          kind: "cell-terminal-name",
          terminalId: options.formalTerminalId,
        },
      });
    }
    return annotations;
  }
  const label = defaultInstanceLabel(
    document,
    instance,
    resolver,
    styleProfile,
  );
  if (options.showDesignator !== false && label) {
    annotations.push({
      ...label,
      binding: { kind: "instance-reference", instanceId: instance.id },
    });
  }
  if (options.masterName) {
    const master = defaultMasterNameAnnotation(
      document,
      instance,
      resolver,
      styleProfile,
      options.masterName,
    );
    if (master) annotations.push(master);
  } else if (
    options.showValue &&
    displayableInstanceValue(instance).kind === "displayable"
  ) {
    const value = defaultInstanceValue(
      document,
      instance,
      resolver,
      styleProfile,
    );
    if (value) annotations.push(value);
  }
  return annotations;
}

/**
 * Materialize only the default visual labels a retained Instance lacks when it
 * enters the canvas. Imported SPICE starts in the Placement Tray, so this
 * keeps its already-imported Reference visible without replacing a label the
 * user has already positioned, hidden, or edited.
 */
export function missingDefaultInstanceDisplayAnnotations(
  document: SchematicDocument,
  instance: Instance,
  resolver: SymbolResolver,
  styleProfile: SchematicStyleProfile,
): readonly Annotation[] {
  if (!instance.placement) return [];
  const formalTerminalId = document.netlist?.terminals.find((terminal) =>
    terminal.interfaceInstanceIds.includes(instance.id),
  )?.id;
  const candidates = defaultInstanceDisplayAnnotations(
    document,
    instance,
    resolver,
    styleProfile,
    formalTerminalId ? { formalTerminalId } : {},
  );
  return candidates.filter(
    (candidate) =>
      !document.annotations.some((existing) =>
        isSameDefaultProjection(existing, candidate),
      ),
  );
}

function isSameDefaultProjection(
  existing: Annotation,
  candidate: Annotation,
): boolean {
  if (existing.id === candidate.id) return true;
  if (
    existing.kind === "instance-label" &&
    existing.content &&
    candidate.binding?.kind === "instance-reference" &&
    existing.anchor.kind === "object" &&
    existing.anchor.objectId === candidate.binding.instanceId
  )
    return true;
  const existingBinding = existing.binding;
  const candidateBinding = candidate.binding;
  if (!existingBinding || !candidateBinding) return false;
  if (
    existingBinding.kind === "instance-reference" &&
    candidateBinding.kind === "instance-reference"
  ) {
    return existingBinding.instanceId === candidateBinding.instanceId;
  }
  if (
    existingBinding.kind === "net-name" &&
    candidateBinding.kind === "net-name"
  ) {
    return existingBinding.netId === candidateBinding.netId;
  }
  if (
    existingBinding.kind === "cell-terminal-name" &&
    candidateBinding.kind === "cell-terminal-name"
  ) {
    return existingBinding.terminalId === candidateBinding.terminalId;
  }
  return false;
}

function defaultMasterNameAnnotation(
  document: SchematicDocument,
  instance: Instance,
  resolver: SymbolResolver,
  styleProfile: SchematicStyleProfile,
  masterName: string,
): Annotation | null {
  if (!instance.placement || masterName.trim() === "") return null;
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) return null;
  const placement = defaultInstanceLabelPlacement(
    instance,
    resolved,
    styleProfile,
    document.presentation.grid,
    "value",
  );
  if (!placement) return null;
  const position = placement.position;
  return {
    id: `instance-master-${instance.id}`,
    kind: "instance-value",
    content: plainNameDocument(masterName),
    anchor: {
      kind: "object",
      objectId: instance.id,
      localOffset: {
        x: position.x - instance.placement.position.x,
        y: position.y - instance.placement.position.y,
      },
      fallbackPosition: position,
    },
    alignment: placement.alignment,
    rotation: 0,
    locked: false,
  };
}
