// Adapted from LXY-freshman/schematic-draft close-guard.ts @ 5231840f.
// AGPL-3.0-only. See ../SOURCES.md. All-tab state and failure policy are adapted.
export interface WorkspaceCloseState {
  dirty: { id: string; name: string }[];
  busy: boolean;
  pendingEdits: boolean;
}
export interface CloseGuardPorts {
  readState(): Promise<WorkspaceCloseState | null>;
  ask(
    state: WorkspaceCloseState | null,
  ): Promise<"save" | "discard" | "cancel">;
  save(): Promise<{ status: string; message?: string }>;
  reportFailure(message: string): Promise<void>;
}
export function workspaceCloseState(raw: unknown): WorkspaceCloseState | null {
  const value = raw as Partial<WorkspaceCloseState> | null;
  if (
    !value ||
    typeof value.busy !== "boolean" ||
    typeof value.pendingEdits !== "boolean" ||
    !Array.isArray(value.dirty) ||
    value.dirty.some(
      (entry) =>
        !entry ||
        typeof entry.id !== "string" ||
        typeof entry.name !== "string",
    )
  )
    return null;
  return value as WorkspaceCloseState;
}
export async function decideClose(
  ports: CloseGuardPorts,
): Promise<"close" | "stay"> {
  const state = await ports.readState().catch(() => null);
  if (state?.busy || state?.pendingEdits) {
    await ports.reportFailure(
      "Finish or cancel the current edit or file operation before closing.",
    );
    return "stay";
  }
  if (state && !state.dirty.length) return "close";
  // A missing renderer answer must never silently discard unsaved work.
  const answer = await ports.ask(state).catch(() => "cancel" as const);
  if (answer === "discard") return "close";
  if (answer !== "save") return "stay";
  const attempt = await ports.save().catch((error: unknown) => ({
    status: "failed",
    message: error instanceof Error ? error.message : "Save failed",
  }));
  if (attempt.status === "saved") {
    const after = await ports.readState().catch(() => null);
    if (after && !after.busy && !after.pendingEdits && !after.dirty.length)
      return "close";
    await ports.reportFailure(
      "New or unfinished edits remain unsaved. The window stayed open.",
    );
  } else if (attempt.status !== "cancelled")
    await ports.reportFailure(attempt.message ?? "Save failed");
  return "stay";
}
