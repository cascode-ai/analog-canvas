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
  kind: "voltage" | "current" | "difference";
  onAdd(label: string, expression: SimulationSourceExpression): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [positive, setPositive] = useState<SourceProbeChoice>();
  const filtered = choices.filter(
    (c) =>
      c.kind === (kind === "current" ? "current" : "voltage") &&
      c.label.toLowerCase().includes(query.toLowerCase()),
  );
  const add = (choice: SourceProbeChoice) => {
    if (kind === "difference" && !positive) {
      setPositive(choice);
      setQuery("");
      return;
    }
    onAdd(
      positive ? `${positive.label} − ${choice.label}` : choice.label,
      positive
        ? {
            kind: "subtract",
            left: positive.expression,
            right: choice.expression,
          }
        : choice.expression,
    );
    onClose();
  };
  return (
    <div
      className="simulation-probe-picker"
      role="dialog"
      aria-label="Observe signal"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <strong>
        {kind === "difference"
          ? positive
            ? `Negative node (positive: ${positive.label})`
            : "Choose positive node"
          : `Observe ${kind}`}
      </strong>
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
        New outputs are collected on the next Run. Existing results stay
        unchanged.
      </small>
      <button onClick={onClose}>Cancel</button>
    </div>
  );
}
