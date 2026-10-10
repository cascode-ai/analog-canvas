import type {
  ComponentDefinition,
  ExternalSubcircuitDefinition,
} from "@icm/model";
import { circuitComponentIssues } from "@icm/model";
import { CircuitPinEditor } from "./circuit-pin-editor";

/** Formal metadata and exceptional correspondence belong beside the circuit source. */
export function CircuitInterfaceEditor({
  owner,
  component,
  automatic,
  readOnly,
  onDirection,
  onChange,
  onCustomize,
}: {
  owner: ExternalSubcircuitDefinition;
  component: ComponentDefinition | null;
  automatic: boolean;
  readOnly: boolean;
  onDirection(
    id: string,
    direction: ExternalSubcircuitDefinition["terminals"][number]["direction"],
  ): void;
  onChange(component: ComponentDefinition): void;
  onCustomize(): void;
}) {
  const invalid =
    component && circuitComponentIssues(component, owner).length > 0;
  return (
    <section
      className="component-circuit-interface"
      aria-label="Circuit interface"
    >
      <div className="external-model-directions">
        {owner.terminals.map((terminal) => (
          <label key={terminal.id}>
            <strong>{terminal.name}</strong>
            <select
              aria-label={`Model ${terminal.name} direction`}
              value={terminal.direction}
              disabled={readOnly}
              onChange={(event) =>
                onDirection(
                  terminal.id,
                  event.currentTarget.value as typeof terminal.direction,
                )
              }
            >
              {(["passive", "input", "output", "inout"] as const).map(
                (direction) => (
                  <option key={direction} value={direction}>
                    {direction === "inout"
                      ? "In/Out"
                      : direction[0]!.toUpperCase() + direction.slice(1)}
                  </option>
                ),
              )}
            </select>
          </label>
        ))}
      </div>
      {!component ? (
        <p role="status">Fix Symbol JSON to edit pin mapping.</p>
      ) : (
        <details open={invalid || undefined}>
          <summary>Pin mapping{invalid ? " · needs repair" : ""}</summary>
          {automatic ? (
            <>
              <p>Pins follow the native interface.</p>
              <button type="button" disabled={readOnly} onClick={onCustomize}>
                Customize symbol
              </button>
            </>
          ) : (
            <CircuitPinEditor
              owner={owner}
              component={component}
              readOnly={readOnly}
              onChange={onChange}
            />
          )}
        </details>
      )}
    </section>
  );
}
