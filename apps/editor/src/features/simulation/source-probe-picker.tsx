import { useEffect, useRef, useState } from "react";
import type { SimulationSourceExpression } from "@icm/model";
import type { SourceProbeChoice } from "./source-probe-choices";

export function SourceProbePicker({
  choices,
  kind,
  onAdd,
  onClose,
}: {
  choices: readonly SourceProbeChoice[];
  kind: "voltage" | "current" | "device-op";
  onAdd(label: string, expression: SimulationSourceExpression): boolean;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const finish = () => {
    const trigger = root.current
      ?.closest(".simulation-code-document")
      ?.querySelector<HTMLButtonElement>("[data-simulation-helper-trigger]");
    onClose();
    trigger?.focus();
  };
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !(event.target as Element).closest?.("[data-simulation-helper-trigger]")
      )
        onClose();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [onClose]);
  const filtered = choices.filter(
    (c) =>
      c.kind === kind && c.label.toLowerCase().includes(query.toLowerCase()),
  );
  const add = (choice: SourceProbeChoice) => {
    const key = JSON.stringify(choice.expression);
    if (added.includes(key)) return;
    if (onAdd(choice.label, choice.expression))
      setAdded((current) => [...current, key]);
  };
  return (
    <div
      ref={root}
      className="simulation-helper-list simulation-probe-picker"
      role="dialog"
      aria-label="Save signal"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          finish();
        }
      }}
    >
      <header className="simulation-probe-picker-header">
        <strong>Save {kind}</strong>
        <button onClick={finish}>Done</button>
      </header>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        aria-label="Search signal"
        placeholder="Search signal or enter an exact native vector…"
      />
      <div className="simulation-helper-options">
        {filtered.map((choice, index) => (
          <button
            key={index}
            aria-disabled={added.includes(JSON.stringify(choice.expression))}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => add(choice)}
          >
            {choice.label}
            {added.includes(JSON.stringify(choice.expression)) && (
              <small>Added</small>
            )}
          </button>
        ))}
      </div>
      {query.trim() && (
        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            add({
              label: query.trim(),
              kind,
              expression: { kind: "vector", vector: query.trim() },
            })
          }
        >
          Use native vector: {query.trim()}
        </button>
      )}
    </div>
  );
}
