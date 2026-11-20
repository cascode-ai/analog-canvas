import type { CircuitProject, Instance } from "@icm/model";

/** The part of an Instance this reads; structural, as a Snapshot's is. */
export interface EvidenceOwner {
  readonly importProvenance?:
    | Pick<
        NonNullable<Instance["importProvenance"]>,
        "kind" | "sourceMasterName" | "status"
      >
    | undefined;
  readonly netlist?:
    | {
        readonly binding?:
          | { readonly kind?: unknown; readonly name?: unknown }
          | undefined;
      }
    | null
    | undefined;
}

/**
 * What an Instance's model is known to be, by where it came from. Export,
 * parameter checks, simulation and comparison ask this one question and
 * never decide by a model's name.
 *
 * - `canvas`: placed from the library, or its model target chosen in Canvas
 *   since it was imported.
 * - `resolved`: imported, and the sources define its model or subcircuit.
 * - `typed-only`: imported; its device type comes from the caller's
 *   evidence or the card's own letter, and no card in the sources defines
 *   its model. The type draws the part; it is not a model implementation.
 * - `external-call`: imported call of a master the sources do not define.
 */
export type InstanceEvidence =
  | "canvas"
  | "resolved"
  | "typed-only"
  | "external-call";

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
  if (target.toLowerCase() !== provenance.sourceMasterName.toLowerCase())
    return "canvas";
  if (provenance.status === "missing") return "typed-only";
  // Projects imported before the status was written said `resolved` for
  // every model: the sources the Project keeps decide.
  const texts = (project.source?.files ?? []).flatMap((file) =>
    [file.content?.text, file.originalContent?.text].filter(
      (text): text is string => text !== undefined,
    ),
  );
  return !texts.length || texts.some((text) => definesModel(text, target))
    ? "resolved"
    : "typed-only";
}

/** `.model NAME` in SPICE, `model NAME` in Spectre, a bin `NAME.1` alike. */
function definesModel(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    String.raw`^[ \t]*\.?model[ \t]+${escaped}(?:\.\d+)?(?=[\s(]|$)`,
    "imu",
  ).test(text);
}
