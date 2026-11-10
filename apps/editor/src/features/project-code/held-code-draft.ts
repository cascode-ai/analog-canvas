import { useState, useSyncExternalStore } from "react";
import { AuthoringDocument } from "../user-components/component-authoring-workspace";

/** Unapplied source text, and the live source it was written over. */
export interface CodeDraft {
  text: string;
  base: string;
}

export type CodeDraftDocument = AuthoringDocument<CodeDraft | null>;

/**
 * A code panel's draft, held by the editor rather than the panel: closing or
 * switching the panel keeps it for its Project session, and another session
 * starts without it (#2193, #2201). Only Apply or Reload clears it.
 */
export function useHeldCodeDraft(sessionId: string) {
  const [state, setState] = useState(() => heldDraft(sessionId));
  let held = state;
  if (held.sessionId !== sessionId) {
    held = heldDraft(sessionId);
    setState(held);
  }
  const { value } = useSyncExternalStore(
    held.document.subscribe,
    held.document.snapshot,
    held.document.snapshot,
  );
  return { document: held.document, dirty: value !== null };
}

function heldDraft(sessionId: string) {
  return {
    sessionId,
    document: new AuthoringDocument<CodeDraft | null>(null),
  };
}
