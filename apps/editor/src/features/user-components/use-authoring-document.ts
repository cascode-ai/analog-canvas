import { useState, useSyncExternalStore } from "react";
import { AuthoringDocument } from "./component-authoring-workspace";

/** Cell Manager owns a local document; User Components supplies its shared document. */
export function useAuthoringDocument<T>(
  initial: () => T,
  shared?: AuthoringDocument<T>,
) {
  const [document] = useState(() => shared ?? new AuthoringDocument(initial()));
  const state = useSyncExternalStore(document.subscribe, document.snapshot);
  return { document, ...state };
}
