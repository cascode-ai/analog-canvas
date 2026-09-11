import {
  SimulationCircuitBindingSchema,
  type SimulationCircuitBinding,
} from "@icm/model";

export interface SourceDraft {
  base: string;
  text: string;
  committed: number;
  binding?: SimulationCircuitBinding;
}
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const draftKey = (workingCopyId: string, projectId: string) =>
  `icm.code-drafts:${JSON.stringify([workingCopyId, projectId])}`;

/** An explicit recovery fork also carries this tab's buffers; importing a Project does not. */
export function recoverSourceDrafts(
  from: string,
  to: string,
  projectId: string,
): string | undefined {
  if (from === to) return;
  try {
    const storage = window.sessionStorage;
    const original = storage.getItem(draftKey(from, projectId));
    // Copy even unreadable bytes so the code pane can diagnose them without erasing the original.
    if (original !== null) storage.setItem(draftKey(to, projectId), original);
  } catch {
    return "Code drafts could not be copied; the original working copy was retained.";
  }
}

/** Tab-local recovery of uncommitted buffers, never a runnable folder or cloud authority. */
export function sourceDraftCache(
  storage: Storage | undefined,
  workingCopyId: string,
  projectId: string,
) {
  const key = draftKey(workingCopyId, projectId);
  let unreadable = false;
  return {
    read(): Map<string, SourceDraft> {
      try {
        const text = storage?.getItem(key);
        if (!text) return new Map();
        const entries: unknown = JSON.parse(text);
        if (!Array.isArray(entries)) throw Error("Invalid draft cache");
        const drafts = new Map<string, SourceDraft>();
        for (const entry of entries) {
          if (
            !Array.isArray(entry) ||
            entry.length !== 2 ||
            typeof entry[0] !== "string"
          )
            throw Error("Invalid draft entry");
          const draft: unknown = entry[1];
          if (
            !draft ||
            typeof draft !== "object" ||
            !("base" in draft) ||
            typeof draft.base !== "string" ||
            !("text" in draft) ||
            typeof draft.text !== "string" ||
            !("committed" in draft) ||
            typeof draft.committed !== "number" ||
            !Number.isInteger(draft.committed) ||
            draft.committed < 0
          )
            throw Error("Invalid draft");
          drafts.set(entry[0], {
            base: draft.base,
            text: draft.text,
            committed: draft.committed,
            ...("binding" in draft
              ? { binding: SimulationCircuitBindingSchema.parse(draft.binding) }
              : {}),
          });
        }
        return drafts;
      } catch {
        unreadable = true;
        return new Map();
      }
    },
    write(drafts: ReadonlyMap<string, SourceDraft>): boolean {
      // Preserve an unreadable original for recovery instead of replacing it with an empty cache.
      if (unreadable) return false;
      const dirty = [...drafts].filter(
        ([, draft]) => draft.text !== draft.base,
      );
      try {
        if (!storage) return dirty.length === 0;
        if (dirty.length) storage.setItem(key, JSON.stringify(dirty));
        else storage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}
