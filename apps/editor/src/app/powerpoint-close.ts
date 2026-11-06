export interface PowerPointDrawing {
  tabId: string;
  name: string;
  project: string;
  documentId: string;
}
interface CloseState {
  dirty: { id: string; name: string }[];
  busy: boolean;
  pendingEdits: boolean;
}
export interface SaveOutcome {
  status: string;
  message?: string;
}
export interface NativeCloseBridge {
  state(): CloseState;
  save(): Promise<SaveOutcome>;
}

/** PPT receipts own the linked drawing's close state; other tabs keep native saves. */
export function createPowerPointCloseBridge(ports: {
  drawing(): PowerPointDrawing | null;
  native(): NativeCloseBridge | undefined;
  busy(): boolean;
  saveDrawing(): Promise<SaveOutcome>;
}) {
  let acknowledged: Pick<PowerPointDrawing, "project" | "documentId"> | null =
    null;
  const needsSave = (drawing: PowerPointDrawing | null) =>
    !drawing ||
    drawing.project !== acknowledged?.project ||
    drawing.documentId !== acknowledged?.documentId;
  return {
    acknowledge(drawing: PowerPointDrawing) {
      acknowledged = {
        project: drawing.project,
        documentId: drawing.documentId,
      };
    },
    state(): CloseState | null {
      const native = ports.native()?.state();
      if (!native) return null;
      const drawing = ports.drawing();
      const dirty = native.dirty.filter((tab) => tab.id !== drawing?.tabId);
      if (needsSave(drawing))
        dirty.push({
          id: drawing?.tabId ?? "ppt",
          name: drawing?.name ?? "PowerPoint drawing (reopen its project tab)",
        });
      return { ...native, dirty, busy: native.busy || ports.busy() };
    },
    async save(): Promise<SaveOutcome> {
      const native = ports.native();
      if (
        !native ||
        ports.busy() ||
        native.state().busy ||
        native.state().pendingEdits
      )
        return {
          status: "failed",
          message: "Finish the current edit or save before closing.",
        };
      if (needsSave(ports.drawing())) {
        const result = await ports.saveDrawing();
        if (result.status !== "saved") return result;
      }
      return native.save();
    },
  };
}
