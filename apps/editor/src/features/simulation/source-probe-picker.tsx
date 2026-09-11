import { useState } from "react";
import type { SimulationSourceExpression } from "@icm/model";
import type { SourceProbeChoice } from "./source-probe-choices";

export function SourceProbePicker({
  choices,
  kind,
  onAdd,
  onClose,
}: {
  choices: readonly SourceProbeChoice[];
  kind: "voltage" | "current";
  onAdd(label: string, expression: SimulationSourceExpression): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const filtered = choices.filter(
    (c) =>
      c.kind === (kind === "current" ? "current" : "voltage") &&
      c.label.toLowerCase().includes(query.toLowerCase()),
  );
  const add = (choice: SourceProbeChoice) => {
    onAdd(choice.label, choice.expression);
    onClose();
  };
  return (
    <div
      className="simulation-probe-picker"
      role="dialog"
      aria-label="Save signal"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <strong>Save {kind}</strong>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        aria-label="Search signal"
        placeholder="Search signal or enter an exact native vector…"
      />
      <div className="simulation-helper-options">
        {filtered.map((choice, index) => (
          <button key={index} onClick={() => add(choice)}>
            {choice.label}
          </button>
        ))}
      </div>
      {query.trim() && (
        <button
          onClick={() =>
            add({
              label: query.trim(),
              kind: kind === "current" ? "current" : "voltage",
              expression: { kind: "vector", vector: query.trim() },
            })
          }
        >
          Use native vector: {query.trim()}
        </button>
      )}
      <small>
        Inserts a native save statement. Terminal currents may require generated
        measurement wiring.
      </small>
      <button onClick={onClose}>Cancel</button>
    </div>
  );
}
