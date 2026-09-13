import type { CircuitProject, SimulationSourceInput } from "@icm/model";
import { sourceCircuitContext } from "./source-circuit-context";

export function SourceCircuitContext({
  project,
  input,
  onSelectFile,
  activeDocumentId,
}: {
  project: CircuitProject;
  input: SimulationSourceInput;
  onSelectFile(path: string): void;
  activeDocumentId?: string | undefined;
}) {
  const context = sourceCircuitContext(project, input);
  return (
    <details className="simulation-source-context">
      <summary>
        {input.entry} · {context.label}
      </summary>
      <div>
        {context.paths.map((path) => (
          <button key={path} type="button" onClick={() => onSelectFile(path)}>
            {path}
          </button>
        ))}
      </div>
      {!context.uncertain &&
      activeDocumentId &&
      !context.documentIds.has(activeDocumentId) ? (
        <p>Current Canvas Cell is not referenced by this experiment.</p>
      ) : null}
      <p>
        Canvas sources are generated from the referenced Cells. Other wiring and
        sources belong to Code.
      </p>
      {context.overrides ? (
        <p>
          Code overrides circuit parameters for this experiment; Canvas values
          are unchanged.
        </p>
      ) : null}
    </details>
  );
}
