import { useLayoutEffect, useRef } from "react";

/** Keep the canvas inert while the cold authoring chunk loads. */
export function ComponentEditorLoading({ onCancel }: { onCancel(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="component-definition-dialog component-editor-loading"
      aria-label="Loading component editor"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <header>
        <strong>Component editor</strong>
        <button
          type="button"
          aria-label="Cancel"
          title="Cancel"
          autoFocus
          onClick={onCancel}
        >
          ×
        </button>
      </header>
      <p role="status">Loading editor…</p>
    </dialog>
  );
}
