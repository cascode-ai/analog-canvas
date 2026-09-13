import { useState } from "react";
import type { CircuitProject } from "@icm/model";
import {
  simulationExamples,
  createSimulationExample,
} from "../../examples/simulation-examples";
import { useWorkspaceInteractions } from "./workspace-interactions";

export function SimulationExampleCards({
  onOpen,
}: {
  onOpen(project: CircuitProject): void | Promise<void>;
}) {
  const interaction = useWorkspaceInteractions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = async (id: string, name: string) => {
    if (busy) return;
    setBusy(true);
    try {
      if (
        !(await interaction.confirm({
          title: `Open ${name}?`,
          message:
            "This switches the entire Project, not just the current Cell. Unsaved changes will be checked before switching. Save any work you want to keep.",
          acceptLabel: "Open example",
        }))
      )
        return;
      await onOpen(createSimulationExample(id));
    } catch {
      setError("Could not open this example.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="simulation-example-start">
      <p>
        Simulate the current circuit, or define a circuit and sources in Code.
      </p>
      <div
        className="simulation-example-cards"
        aria-label="Simulation examples"
        role="group"
      >
        {simulationExamples.map((example) => (
          <button
            key={example.id}
            type="button"
            disabled={busy}
            onClick={() => void open(example.id, example.name)}
          >
            <strong>{example.name}</strong>
            <span>{example.description}</span>
          </button>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
