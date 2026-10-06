import {
  createLabelClearanceContext,
  defaultInstanceLabelPlacement,
  displayableInstanceValue,
  objectStyleProfile,
  portLabelCandidates,
  resolveDocumentStyleProfile,
  type SchematicStyleProfile,
} from "@icm/derived";
import { referenceDeviceLetter } from "@icm/devices";
import {
  LINEAR_CONTROLLED_SOURCE_KINDS,
  controlledSourceExpressionDocument,
  defaultControlledSourceExpression,
  plainNameDocument,
  roleLabelFormat,
} from "@icm/model";
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
  /** The Cell terminal's name, which picks the Pin label's standard look. */
  readonly formalName?: string;
}

/** Find the visual annotation, without mistaking older hidden defaults for it. */
export function instanceLabelAnnotationFor(
  document: SchematicDocument,
  instanceId: string,
): Annotation | undefined {
  const candidates = document.annotations.filter(
    (annotation) =>
      (annotation.kind === "instance-label" ||
        annotation.kind === "net-label" ||
        annotation.kind === "power-label") &&
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
      // A V-led Pin name, typed, connected or generated, is placed in its
      // voltage-node look (V_in, V_BP); any other name is shown as written.
      const format = options.formalName
        ? roleLabelFormat("voltage-node", options.formalName)
        : undefined;
      annotations.push(
        clearPinName(
          document,
          instance,
          resolver,
          styleProfile,
          {
            ...terminalName,
            binding: {
              kind: "cell-terminal-name",
              terminalId: options.formalTerminalId,
            },
            ...(format ? { formatOverride: format } : {}),
          },
          options.formalName,
        ),
      );
    }
    return annotations;
  }
  const alone = defaultInstanceLabel(
    document,
    instance,
    resolver,
    styleProfile,
  );
  const showsDesignator = options.showDesignator !== false && Boolean(alone);
  // The value, or the Cell's name, shown with the part: under its name, or
  // in the name's slot when no name shows.
  const under = options.masterName
    ? defaultMasterNameAnnotation(
        document,
        instance,
        resolver,
        styleProfile,
        options.masterName,
        showsDesignator ? "value" : "reference",
      )
    : options.showValue &&
        displayableInstanceValue(instance).kind === "displayable"
      ? defaultInstanceValue(
          document,
          instance,
          resolver,
          styleProfile,
          // Only an explicitly value-only new projection occupies the first
          // slot. Existing annotations and ordinary visibility toggles keep
          // their layout.
          options.showDesignator === false &&
            !instanceLabelAnnotationFor(document, instance.id)
            ? "reference"
            : "value",
        )
      : null;
  // A name stands over the value shown under it: above the part, a row
  // further out (#1384).
  const label =
    showsDesignator && under
      ? defaultInstanceLabel(
          document,
          instance,
          resolver,
          styleProfile,
          "reference-over-value",
        )
      : alone;
  if (showsDesignator && label) {
    if (LINEAR_CONTROLLED_SOURCE_KINDS.has(instance.symbolId)) {
      annotations.push({
        ...label,
        binding: undefined,
        content: controlledSourceExpressionDocument(
          defaultControlledSourceExpression(
            instance.symbolId as "vcvs" | "vccs" | "cccs" | "ccvs",
            instance.reference?.match(/\d+$/u)?.[0] ?? "1",
          ),
        ),
      });
    } else {
      // A Reference such as M1 or RL1 is placed in its standard look (M₁,
      // R_L1), stored on the label; the Reference keeps its exact spelling.
      const deviceLetter = referenceDeviceLetter(instance.symbolId);
      const format = instance.reference
        ? roleLabelFormat(
            "device-reference",
            instance.reference,
            deviceLetter ? { deviceLetter } : {},
          )
        : undefined;
      annotations.push({
        ...label,
        binding: { kind: "instance-reference", instanceId: instance.id },
        ...(format ? { formatOverride: format } : {}),
      });
    }
  }
  if (under) annotations.push(under);
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
  const formalTerminal = document.netlist?.terminals.find((terminal) =>
    terminal.interfaceInstanceIds.includes(instance.id),
  );
  const candidates = defaultInstanceDisplayAnnotations(
    document,
    instance,
    resolver,
    styleProfile,
    formalTerminal
      ? { formalTerminalId: formalTerminal.id, formalName: formalTerminal.name }
      : {},
  );
  return candidates.filter(
    (candidate) =>
      !document.annotations.some((existing) =>
        isSameDefaultProjection(existing, candidate),
      ),
  );
}

/**
 * Write the default projections a freshly drawn Instance is missing straight
 * into the Document. Only the named Instances are considered, so a label the
 * user has positioned, hidden, or removed on an existing drawing is never
 * resurrected. Returns how many annotations were added.
 */
export function materializeDefaultInstanceDisplays(
  document: SchematicDocument,
  instances: readonly Instance[],
  resolver: SymbolResolver,
): number {
  const styleProfile = resolveDocumentStyleProfile(document.presentation);
  let added = 0;
  for (const instance of instances) {
    const annotations = missingDefaultInstanceDisplayAnnotations(
      document,
      instance,
      resolver,
      styleProfile,
    );
    document.annotations.push(...annotations);
    added += annotations.length;
  }
  return added;
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
  slot: "reference" | "value",
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
    objectStyleProfile(styleProfile, instance),
    document.presentation.grid,
    slot,
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
    ...(instance.documentStyle
      ? { documentStyle: structuredClone(instance.documentStyle) }
      : {}),
  };
}

/**
 * A Cell Pin's name on the first side where it collides with nothing drawn,
 * or the least crowded one: two Pins facing each other otherwise print their
 * names into one another (#1105). The side toward the wire is never tried.
 */
function clearPinName(
  document: SchematicDocument,
  instance: Instance,
  resolver: SymbolResolver,
  styleProfile: SchematicStyleProfile,
  name: Annotation,
  formalName: string | undefined,
): Annotation {
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (
    !resolved ||
    !instance.placement ||
    name.anchor.kind !== "object" ||
    !document.annotations.some((annotation) => annotation.visible !== false)
  )
    return name;
  const candidates = portLabelCandidates(
    instance,
    resolved,
    objectStyleProfile(styleProfile, instance),
    document.presentation.grid,
  );
  if (candidates.length < 2) return name;
  // Measured with the text it will show: the terminal may not exist yet.
  const context = createLabelClearanceContext(
    document.instances.some((item) => item.id === instance.id)
      ? document
      : { ...document, instances: [...document.instances, instance] },
    resolver,
  );
  const origin = instance.placement.position;
  const at = (candidate: (typeof candidates)[number]): Annotation => ({
    ...name,
    alignment: candidate.alignment,
    anchor: {
      ...name.anchor,
      localOffset: {
        x: candidate.position.x - origin.x,
        y: candidate.position.y - origin.y,
      },
      fallbackPosition: candidate.position,
    } as typeof name.anchor,
  });
  let best = name;
  let fewest = Infinity;
  for (const candidate of candidates) {
    const placed = at(candidate);
    const { binding: _binding, ...unbound } = placed;
    const conflicts = context.conflicts({
      ...unbound,
      content: placed.formatOverride ?? plainNameDocument(formalName ?? ""),
    }).length;
    if (conflicts < fewest) {
      best = placed;
      fewest = conflicts;
    }
    if (!conflicts) break;
  }
  return best;
}
