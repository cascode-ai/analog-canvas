import { createReferenceIndex, referenceIssuesForInstance } from "@icm/devices";
import type { SchematicDocument } from "@icm/model";

import type { SchematicEdit } from "./edit-schema.js";

export type SetInstanceReferencePlan =
  | { ok: true; reference: string; edits: readonly SchematicEdit[] }
  | { ok: false; message: string };

function messageForReferenceIssue(
  issue: ReturnType<typeof createReferenceIndex>["issues"][number],
): string {
  switch (issue.code) {
    case "MISSING_REFERENCE":
      return "This component requires an Instance Reference";
    case "WRONG_REFERENCE_PREFIX":
      return `Reference ${issue.reference} does not match this component prefix`;
    case "DUPLICATE_REFERENCE":
      return `Reference ${issue.reference} is already used by ${issue.otherInstanceId}`;
  }
}

/**
 * Plans one user-authored reference rename against the Cell-wide policy and
 * case-folded index. The edit engine repeats this check at commit time so the
 * planner is ergonomic rather than a bypassable authority.
 */
export function planSetInstanceReference(
  document: SchematicDocument,
  request: { instanceId: string; reference: string },
): SetInstanceReferencePlan {
  const instance = document.instances.find(
    (candidate) => candidate.id === request.instanceId,
  );
  if (!instance) {
    return { ok: false, message: "This component does not exist" };
  }
  const reference = request.reference.trim();
  if (!reference) {
    return { ok: false, message: "Reference cannot be empty" };
  }
  if (reference === instance.reference) {
    return { ok: true, reference, edits: [] };
  }
  const proposed = structuredClone(document);
  const proposedInstance = proposed.instances.find(
    (candidate) => candidate.id === request.instanceId,
  );
  if (!proposedInstance) {
    return { ok: false, message: "This component does not exist" };
  }
  proposedInstance.reference = reference;
  const issue = referenceIssuesForInstance(
    createReferenceIndex(proposed),
    request.instanceId,
  )[0];
  if (issue) return { ok: false, message: messageForReferenceIssue(issue) };
  return {
    ok: true,
    reference,
    edits: [
      {
        kind: "set_instance_reference",
        instanceId: request.instanceId,
        reference,
      },
    ],
  };
}
