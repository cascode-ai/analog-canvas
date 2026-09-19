import { useEffect, useRef, useState } from "react";
import { parameterReferences } from "@icm/devices";
import type { SchematicDocument } from "@icm/model";

export function CellParameterDialog({
  cell,
  field,
  value,
  onApply,
  onCancel,
}: {
  cell: SchematicDocument;
  field: string;
  value: string;
  onApply(
    name: string,
    defaultValue?: string,
  ): { ok: boolean; message?: string };
  onCancel(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const parameters = cell.netlist?.formalParameters ?? [];
  const references = parameterReferences(value);
  const current =
    references.length === 1
      ? parameters.find(
          (parameter) =>
            parameter.name.toLowerCase() === references[0]!.name.toLowerCase(),
        )
      : undefined;
  const [name, setName] = useState(current?.name ?? "");
  const [defaultValue, setDefaultValue] = useState(value);
  const [error, setError] = useState("");
  const existing = parameters.find(
    (parameter) => parameter.name.toLowerCase() === name.trim().toLowerCase(),
  );
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="editor-action-dialog"
      aria-labelledby="cell-parameter-title"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const result = onApply(
            name.trim(),
            existing ? undefined : defaultValue,
          );
          if (!result.ok)
            setError(result.message ?? "Could not use Cell parameter");
        }}
      >
        <h2 id="cell-parameter-title">Cell parameter · {field}</h2>
        <label>
          Name
          <input
            autoFocus
            aria-label="Cell parameter name"
            list="cell-parameter-options"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <datalist id="cell-parameter-options">
          {parameters.map((parameter) => (
            <option key={parameter.name} value={parameter.name} />
          ))}
        </datalist>
        {existing ? (
          <p>Default: {existing.defaultValue ?? "No default"}</p>
        ) : (
          <label>
            Default
            <input
              aria-label="Cell parameter default"
              value={defaultValue}
              onChange={(event) => setDefaultValue(event.currentTarget.value)}
            />
          </label>
        )}
        {error ? <p role="alert">{error}</p> : null}
        <footer className="editor-action-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">
            {existing ? "Use parameter" : "Create and use"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
