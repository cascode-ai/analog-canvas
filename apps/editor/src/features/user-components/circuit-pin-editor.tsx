import {
  ComponentDefinitionSchema,
  circuitComponentIssues,
  type ComponentDefinition,
  type ExternalSubcircuitDefinition,
} from "@icm/model";

/** The structured editor writes the same binding as advanced symbol JSON. */
export function CircuitPinEditor({
  component,
  owner,
  readOnly = false,
  onChange,
}: {
  component: ComponentDefinition;
  owner: ExternalSubcircuitDefinition;
  readOnly?: boolean;
  onChange(component: ComponentDefinition): void;
}) {
  const binding = component.circuitBinding;
  const issues = circuitComponentIssues(component, owner);
  function map(terminalId: string, value: string) {
    const terminals = (binding?.terminals ?? []).filter(
      (t) => t.terminalId !== terminalId,
    );
    if (value.startsWith("pin:"))
      terminals.push({ terminalId, pinName: value.slice(4) });
    if (value === "supply:VDD" || value === "supply:VSS")
      terminals.push({ terminalId, supply: value.slice(7) as "VDD" | "VSS" });
    terminals.sort(
      (a, b) =>
        owner.terminals.findIndex((t) => t.id === a.terminalId) -
        owner.terminals.findIndex((t) => t.id === b.terminalId),
    );
    onChange(
      ComponentDefinitionSchema.parse({
        ...component,
        circuitBinding: { definitionId: owner.id, terminals },
      }),
    );
  }
  function addPin(terminal: ExternalSubcircuitDefinition["terminals"][number]) {
    const symbol = structuredClone(component.symbol);
    let name = terminal.name;
    let index = 1;
    while (symbol.pins.some((pin) => pin.name === name))
      name = terminal.name + "_" + index++;
    const x = symbol.viewBox.x;
    let y = Math.ceil(symbol.viewBox.y / 10) * 10 + 10;
    while (symbol.pins.some((pin) => pin.at.x === x && pin.at.y === y)) y += 10;
    symbol.viewBox.height = Math.max(
      symbol.viewBox.height,
      y - symbol.viewBox.y + 10,
    );
    symbol.pins.push({
      name,
      role: terminal.direction,
      at: { x, y },
      direction: "west",
      presentation: {
        visibility: "visible",
        showName: true,
        textSizeScale: 0.5,
      },
    });
    onChange(
      ComponentDefinitionSchema.parse({
        ...component,
        symbol,
        circuitBinding: {
          definitionId: owner.id,
          terminals: [
            ...(binding?.terminals ?? []).filter(
              (t) => t.terminalId !== terminal.id,
            ),
            { terminalId: terminal.id, pinName: name },
          ],
        },
      }),
    );
  }
  function removePin(name: string) {
    const symbol = structuredClone(component.symbol);
    symbol.pins = symbol.pins.filter((pin) => pin.name !== name);
    symbol.variants = symbol.variants.map((variant) => ({
      ...variant,
      hiddenPinNames: variant.hiddenPinNames.filter((pin) => pin !== name),
      ...(variant.auxiliaryPins
        ? {
            auxiliaryPins: variant.auxiliaryPins.filter(
              (pin) => pin.name !== name,
            ),
          }
        : {}),
    }));
    if (!symbol.pins.length) symbol.hierarchicalBlock = true;
    onChange(
      ComponentDefinitionSchema.parse({
        ...component,
        symbol,
        circuitBinding: {
          definitionId: owner.id,
          terminals: (binding?.terminals ?? []).filter(
            (t) => !("pinName" in t) || t.pinName !== name,
          ),
        },
      }),
    );
  }
  return (
    <section className="circuit-pin-editor" aria-label="Native pin mapping">
      <table>
        <thead>
          <tr>
            <th scope="col">Terminal</th>
            <th scope="col">Graphical pin / supply</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {owner.terminals.map((terminal) => {
            const mappings =
              binding?.terminals.filter((t) => t.terminalId === terminal.id) ??
              [];
            const mapping = mappings[0];
            const duplicatePin =
              mapping &&
              "pinName" in mapping &&
              binding?.terminals.some(
                (other) =>
                  other.terminalId !== terminal.id &&
                  "pinName" in other &&
                  other.pinName === mapping.pinName,
              );
            const value = mapping
              ? "pinName" in mapping
                ? "pin:" + mapping.pinName
                : "supply:" + mapping.supply
              : "";
            return (
              <tr key={terminal.id}>
                <th scope="row">{terminal.name}</th>
                <td>
                  <select
                    aria-label={"Map native " + terminal.name}
                    value={value}
                    disabled={readOnly}
                    onChange={(event) =>
                      map(terminal.id, event.currentTarget.value)
                    }
                  >
                    <option value="">Unmapped</option>
                    {component.symbol.pins.map((pin) => (
                      <option key={pin.name} value={"pin:" + pin.name}>
                        {pin.name}
                      </option>
                    ))}
                    <option value="supply:VDD">Explicit VDD supply</option>
                    <option value="supply:VSS">Explicit VSS supply</option>
                  </select>
                </td>
                <td>
                  {mappings.length > 1 || duplicatePin
                    ? "Duplicate"
                    : mappings.length === 1
                      ? "Mapped"
                      : "Unmapped"}
                  {!mapping ? (
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-label={"Add pin for " + terminal.name}
                      onClick={() => addPin(terminal)}
                    >
                      Add pin
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(binding?.terminals ?? [])
        .filter(
          (mapping) =>
            !owner.terminals.some(
              (terminal) => terminal.id === mapping.terminalId,
            ),
        )
        .map((mapping) => (
          <p key={mapping.terminalId} role="status">
            Mapping {mapping.terminalId} has no native terminal.{" "}
            <button
              type="button"
              disabled={readOnly}
              onClick={() =>
                onChange({
                  ...component,
                  circuitBinding: {
                    definitionId: owner.id,
                    terminals: binding!.terminals.filter(
                      (terminal) => terminal.terminalId !== mapping.terminalId,
                    ),
                  },
                })
              }
            >
              Remove stale mapping
            </button>
          </p>
        ))}
      {component.symbol.pins
        .filter(
          (pin) =>
            !binding?.terminals.some(
              (t) =>
                owner.terminals.some(
                  (terminal) => terminal.id === t.terminalId,
                ) &&
                "pinName" in t &&
                t.pinName === pin.name,
            ),
        )
        .map((pin) => (
          <p key={pin.name} role="status">
            Graphical pin {pin.name} is unmapped.{" "}
            <button
              type="button"
              disabled={readOnly}
              onClick={() => removePin(pin.name)}
            >
              Remove pin {pin.name}
            </button>
          </p>
        ))}
      {issues[0] ? <p role="status">{issues[0].message}</p> : null}
    </section>
  );
}
