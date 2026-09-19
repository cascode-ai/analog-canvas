import { useLayoutEffect, useRef, useState } from "react";
import { parameterReferences } from "@icm/devices";
import type { SchematicDocument } from "@icm/model";

export function CellParameterDialog({
  cell,
  anchor,
  field,
  value,
  onApply,
  onCancel,
}: {
  cell: SchematicDocument;
  anchor: HTMLElement;
  field: string;
  value: string;
  onApply(
    name: string,
    defaultValue?: string,
  ): { ok: boolean; message?: string };
  onCancel(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
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
  useLayoutEffect(() => {
    const panel = ref.current!;
    const position = () => {
      if (!anchor.isConnected) {
        cancelRef.current();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const x =
        rect.right + 8 + width <= window.innerWidth - 8
          ? rect.right + 8
          : rect.left - width - 8;
      panel.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))}px`;
    };
    const dismiss = (event: PointerEvent) => {
      if (
        !panel.contains(event.target as Node) &&
        !anchor.contains(event.target as Node)
      )
        cancelRef.current();
    };
    panel.showPopover();
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.addEventListener("pointerdown", dismiss, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("pointerdown", dismiss, true);
      if (panel.matches(":popover-open")) panel.hidePopover();
    };
  }, [anchor]);
  return (
    <div
      ref={ref}
      popover="manual"
      role="dialog"
      className="cell-parameter-popover"
      aria-labelledby="cell-parameter-title"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
          anchor.focus();
        }
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
        <header>
          <strong id="cell-parameter-title">Hierarchical para</strong>
          <small>{field}</small>
          <button
            type="button"
            aria-label="Close hierarchical parameter"
            onClick={onCancel}
          >
            ×
          </button>
        </header>
        <label>
          Name
          <input
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
        <footer>
          <button type="submit">Apply</button>
        </footer>
      </form>
    </div>
  );
}
