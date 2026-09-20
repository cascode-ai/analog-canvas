import type { CircuitProject, SchematicDocument } from "@icm/model";
import { projectCellInterface } from "@icm/model";
import { CellParametersEditor } from "./cell-parameters-editor";
import type {
  CellParameterChange,
  ExternalDefinitionResult,
} from "./project-structure-commands";

/** Compact definition editor embedded in Cell Manager. */
export function CellInterfaceEditor({
  cell,
  project,
  callerCount,
  onSetPortDirection,
  onMovePort,
  onEditParameter,
}: {
  cell: SchematicDocument;
  project: CircuitProject;
  callerCount: number;
  onSetPortDirection(
    portId: string,
    direction: "input" | "output" | "inout" | "passive",
  ): void;
  onMovePort(portId: string, delta: -1 | 1): void;
  onEditParameter(
    name: string,
    change: CellParameterChange,
  ): ExternalDefinitionResult;
}) {
  if (!cell.netlist) return null;
  const projection = projectCellInterface(cell.netlist);
  const ports = projection.ports;
  const issueByPortKey = new Map(
    projection.issues.map((issue) => [issue.portKey, issue]),
  );

  return (
    <div className="cell-interface-editor" aria-label="Cell interface">
      <div className="cell-interface-grid">
        <section className="cell-interface-section" aria-label="Formal Ports">
          <header>
            <div>
              <h3>Ports</h3>
              <p>
                Symbol interface shared by {callerCount} caller
                {callerCount === 1 ? "" : "s"}. Equal names are one Port.
              </p>
            </div>
            <span className="cell-count-badge">{ports.length}</span>
          </header>
          {ports.length === 0 ? (
            <p className="cell-interface-empty">
              Place a Port in this Cell to define its interface.
            </p>
          ) : (
            <div
              className="cell-interface-table"
              role="table"
              aria-label="Formal port order"
            >
              {ports.map((port, index) => {
                const issue = issueByPortKey.get(port.key);
                return (
                  <div key={port.id} className="cell-interface-row" role="row">
                    <span
                      className="cell-interface-order"
                      aria-label={`Port order ${index + 1}`}
                    >
                      {index + 1}
                    </span>
                    <span className="cell-interface-port-name">
                      <strong>{port.name}</strong>
                      {port.interfaceInstanceIds.length > 1 ? (
                        <small>
                          {port.interfaceInstanceIds.length} markers
                        </small>
                      ) : null}
                      {issue ? (
                        <small role="status">Direction conflict</small>
                      ) : null}
                    </span>
                    <select
                      aria-label={`Formal port ${port.name} direction`}
                      value={issue ? "" : port.direction}
                      onChange={(event) =>
                        onSetPortDirection(
                          port.id,
                          event.currentTarget.value as typeof port.direction,
                        )
                      }
                    >
                      {issue ? (
                        <option value="" disabled>
                          Mixed
                        </option>
                      ) : null}
                      <option value="input">Input</option>
                      <option value="output">Output</option>
                      <option value="inout">Inout</option>
                      <option value="passive">Passive</option>
                    </select>
                    <div className="cell-interface-order-actions">
                      <button
                        type="button"
                        aria-label={`Move ${port.name} up`}
                        disabled={index === 0}
                        onClick={() => onMovePort(port.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${port.name} down`}
                        disabled={index === ports.length - 1}
                        onClick={() => onMovePort(port.id, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <CellParametersEditor
          cell={cell}
          project={project}
          onEdit={onEditParameter}
        />
      </div>
    </div>
  );
}
