import { semanticTextDocument } from "../semantic-text.js";
import type { RichTextDocument } from "../schema.js";

/**
 * The Document shape this reader needs. It is stated structurally rather than
 * as the parsed `SchematicDocument` so the compatibility layer can call it on
 * a Project that has not been through the schema yet — which is exactly when
 * a stale format override has to be repaired.
 */
interface BoundAnnotationSource {
  instances?: readonly { id: string; reference?: string | undefined }[];
  netlist?: { terminals: readonly { id: string; name: string }[] } | undefined;
  connectivityEvidence?: readonly {
    kind: string;
    netId?: string | undefined;
    name?: string | undefined;
    // Not every evidence kind carries an owner; only name claims do.
    owner?:
      | {
          kind: string;
          annotationId?: string | undefined;
          objectId?: string | undefined;
        }
      | undefined;
  }[];
}

interface BoundAnnotationLike {
  id: string;
  kind: string;
  anchor: { kind: string; objectId?: string | undefined };
  binding?:
    | {
        kind: string;
        instanceId?: string | undefined;
        terminalId?: string | undefined;
        netId?: string | undefined;
      }
    | undefined;
}

/**
 * The text a bound Annotation is obliged to read as: its Instance's Reference,
 * its Cell terminal's name, or the Net name it claims, compiled to the house
 * style.
 *
 * This is the single authority for that question. The schema uses it to refuse
 * a format override that no longer says the name it presents, and the
 * compatibility layer uses it to repair one — and those two must never drift,
 * because a repair computed differently from the check either fails to fix the
 * file or reports success on a file that still cannot load.
 *
 * Returns null when the Annotation binds to nothing, which has no obligation.
 */
export function boundAnnotationSemanticText(
  document: BoundAnnotationSource,
  annotation: BoundAnnotationLike,
): RichTextDocument | null {
  const binding = annotation.binding;
  if (!binding) return null;

  if (binding.kind === "instance-reference") {
    return semanticTextDocument(
      (document.instances ?? []).find(
        (instance) => instance.id === binding.instanceId,
      )?.reference ?? "",
      "instance-label",
    );
  }
  if (binding.kind === "cell-terminal-name") {
    return semanticTextDocument(
      document.netlist?.terminals.find(
        (terminal) => terminal.id === binding.terminalId,
      )?.name ?? "",
      "formal-port",
    );
  }
  if (binding.kind !== "net-name") return null;

  // Pre-parse callers reach this before schema defaults are applied, so the
  // arrays this reads may legitimately be absent rather than empty.
  const nameClaim = (document.connectivityEvidence ?? []).find(
    (evidence) =>
      evidence.kind === "name-claim" &&
      evidence.netId === binding.netId &&
      ((evidence.owner?.kind === "net-label" &&
        evidence.owner.annotationId === annotation.id) ||
        // A power-marker claim is owned by the marker instance for supply
        // ports, but a drawn power rail's claim is owned by the label
        // annotation itself — both spellings name this annotation's net.
        (evidence.owner?.kind === "power-marker" &&
          ((annotation.anchor.kind === "object" &&
            evidence.owner.objectId === annotation.anchor.objectId) ||
            evidence.owner.objectId === annotation.id))),
  );
  return semanticTextDocument(
    nameClaim?.name ?? "",
    annotation.kind === "power-label" ? "power-label" : "net-label",
  );
}
