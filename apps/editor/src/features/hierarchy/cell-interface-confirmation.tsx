import { useEffect, useRef } from "react";
import type { CellInterfaceConfirmation } from "./project-structure-commands";

/** Native modal containment prevents clicks and keyboard edits behind the form. */
export function CellInterfaceConfirmationDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: CellInterfaceConfirmation;
  onCancel(): void;
  onConfirm(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="editor-action-dialog"
      aria-labelledby="cell-interface-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2 id="cell-interface-confirm-title">{request.title}</h2>
      <p>{request.message}</p>
      <footer className="editor-action-dialog-actions">
        <button type="button" autoFocus onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm}>
          {request.confirmLabel}
        </button>
      </footer>
    </dialog>
  );
}
