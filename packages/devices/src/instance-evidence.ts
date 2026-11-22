import type { CircuitProject, Instance } from "@icm/model";

/** The part of an Instance this reads; structural, as a Snapshot's is. */
export interface EvidenceOwner {
  readonly symbolId?: string | undefined;
  readonly importProvenance?:
    | Pick<
        NonNullable<Instance["importProvenance"]>,
        "kind" | "sourceMasterName" | "status" | "modelType"
      >
    | undefined;
  readonly netlist?:
    | {
        readonly binding?:
          | {
              readonly kind?: unknown;
              readonly name?: unknown;
              readonly origin?: unknown;
            }
          | undefined;
      }
    | null
    | undefined;
}

/** The stand-ins each Library symbol can use without changing device type. */
export const GENERIC_MODEL_TARGETS = {
  nmos: "NMOS",
  pmos: "PMOS",
  "depletion-nmos": "NMOS_DEP",
  "depletion-pmos": "PMOS_DEP",
  npn: "NPN",
  pnp: "PNP",
  njfet: "NJF",
  pjfet: "PJF",
  diode: "DIODE",
  "schottky-diode": "DSCH",
} as const;

/** Symbols drawn otherwise that take a family's stand-in (#2441). */
const GENERIC_MODEL_FAMILY_OF: Readonly<
  Record<string, keyof typeof GENERIC_MODEL_TARGETS>
> = {
  photodiode: "diode",
  "varactor-diode": "diode",
  phototransistor: "npn",
  mesfet: "njfet",
};

export function matchingGenericModelName(
  instance: EvidenceOwner,
): string | undefined {
  const binding = instance.netlist?.binding;
  const symbol = instance.symbolId;
  const family =
    symbol && Object.hasOwn(GENERIC_MODEL_FAMILY_OF, symbol)
      ? GENERIC_MODEL_FAMILY_OF[symbol]
      : symbol;
  if (
    binding?.kind !== "model" ||
    typeof binding.name !== "string" ||
    !family ||
    !Object.hasOwn(GENERIC_MODEL_TARGETS, family)
  )
    return undefined;
  const name =
    GENERIC_MODEL_TARGETS[family as keyof typeof GENERIC_MODEL_TARGETS];
  return binding.name.toUpperCase() === name ? name : undefined;
}

export function hasCanvasGenericModel(instance: EvidenceOwner): boolean {
  return (
    instance.netlist?.binding?.origin === "canvas" &&
    matchingGenericModelName(instance) !== undefined
  );
}

/**
 * What an Instance's model is known to be, by where it came from. Export,
 * parameter checks, ERC and simulation ask this one question and never
 * decide by a model's name.
 *
 * - `canvas`: placed from the library, explicitly selected in Canvas, or its
 *   target name changed since import.
 * - `resolved`: imported, and the sources define its model or subcircuit.
 * - `typed-only`: imported; its device type comes from the caller's
 *   evidence or the card's own letter, and no card in the sources defines
 *   its model. The type draws the part; it is not a model implementation.
 * - `untyped`: imported; no card defines its model and nothing gives its
 *   type: a box of its card's family.
 * - `external-call`: imported call of a master the sources do not define.
 */
export type InstanceEvidence =
  "canvas" | "resolved" | "typed-only" | "untyped" | "external-call";

/** An imported part naming a model its sources do not define. */
export function namesModelOutsideSources(evidence: InstanceEvidence): boolean {
  return evidence === "typed-only" || evidence === "untyped";
}

export function instanceEvidence(
  project: Partial<Pick<CircuitProject, "source">>,
  instance: EvidenceOwner,
): InstanceEvidence {
  const provenance = instance.importProvenance;
  if (!provenance) return "canvas";
  if (provenance.kind === "opaque") return "external-call";
  if (provenance.kind !== "model") return "resolved";
  const binding = instance.netlist?.binding;
  // A reviewed PDK wrapper an M card named binds as the wrapper it is.
  if (binding?.kind !== "model" || typeof binding.name !== "string")
    return "resolved";
  const target = binding.name;
  if (
    hasCanvasGenericModel(instance) ||
    target.toLowerCase() !== provenance.sourceMasterName.toLowerCase()
  )
    return "canvas";
  const outside = provenance.modelType === undefined ? "untyped" : "typed-only";
  if (provenance.status === "missing") return outside;
  // Projects imported before the status was written said `resolved` for
  // every model: the sources the Project keeps decide. One that keeps none
  // (a Gallery copy, which leaves its sources out) can tell neither way, so
  // its status stands and its netlist does not change.
  const texts = (project.source?.files ?? []).flatMap((file) =>
    [file.content?.text, file.originalContent?.text].filter(
      (text): text is string => text !== undefined,
    ),
  );
  return !texts.length || sourcesDefineModel(texts, target)
    ? "resolved"
    : outside;
}

/** `.model NAME` in SPICE, `model NAME` in Spectre, a bin `NAME.1` alike. */
export function sourcesDefineModel(
  texts: readonly string[],
  name: string,
): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const definition = new RegExp(
    String.raw`^[ \t]*\.?model[ \t]+${escaped}(?:\.\d+)?(?=[\s(]|$)`,
    "imu",
  );
  return texts.some((text) => definition.test(text));
}
