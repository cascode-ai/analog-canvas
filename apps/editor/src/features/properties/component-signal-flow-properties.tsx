import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { SchematicDocument } from "@icm/model";
import type { FormulaPresentation } from "@icm/render-svg";

type Instance = SchematicDocument["instances"][number];
type SignalFlowParameters = NonNullable<Instance["signalFlowParameters"]>;

function normalizedDimension(
  value: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric / 10) * 10));
}

function normalizedParameters(
  formula: string,
  coefficient: string,
  bodyWidth: string,
  bodyHeight: string,
  supportsCoefficient: boolean,
  defaultFormula: string,
): SignalFlowParameters | null {
  const next: SignalFlowParameters = {};
  const formulaValue = formula.trim();
  const coefficientValue = coefficient.trim();
  // The field shows the Symbol's own formula so it can be edited in place;
  // matching that default (or clearing the field) means "no override", not
  // a stored copy of the default.
  if (formulaValue && formulaValue !== defaultFormula)
    next.formula = formulaValue;
  if (supportsCoefficient && coefficientValue)
    next.coefficient = coefficientValue;
  const width = normalizedDimension(bodyWidth, 20, 1000);
  const height = normalizedDimension(bodyHeight, 20, 500);
  if (width !== undefined) next.bodyWidth = width;
  if (height !== undefined) next.bodyHeight = height;
  return Object.keys(next).length === 0 ? null : next;
}

function sameParameters(
  left: SignalFlowParameters | undefined,
  right: SignalFlowParameters | null,
): boolean {
  const normalizedLeft = left ?? null;
  return (
    normalizedLeft?.formula === right?.formula &&
    normalizedLeft?.coefficient === right?.coefficient &&
    normalizedLeft?.bodyWidth === right?.bodyWidth &&
    normalizedLeft?.bodyHeight === right?.bodyHeight
  );
}

/**
 * Presentation-only controls for Symbols that declare formulaPresentation.
 * Formula content and optional minimum frame dimensions share one transaction.
 */
export function ComponentSignalFlowProperties({
  instance,
  presentation,
  revision,
  onChange,
}: {
  instance: Instance;
  presentation: FormulaPresentation;
  revision: number;
  onChange: (parameters: SignalFlowParameters | null) => boolean;
}) {
  const [formula, setFormula] = useState(
    instance.signalFlowParameters?.formula ?? presentation.defaultFormula,
  );
  const [coefficient, setCoefficient] = useState(
    instance.signalFlowParameters?.coefficient ?? "",
  );
  const [bodyWidth, setBodyWidth] = useState(
    instance.signalFlowParameters?.bodyWidth?.toString() ?? "",
  );
  const [bodyHeight, setBodyHeight] = useState(
    instance.signalFlowParameters?.bodyHeight?.toString() ?? "",
  );
  const committedParameters = useRef<SignalFlowParameters | undefined>(
    instance.signalFlowParameters,
  );

  // A transaction, undo/redo, or another selection can replace the instance.
  useEffect(() => {
    setFormula(
      instance.signalFlowParameters?.formula ?? presentation.defaultFormula,
    );
    setCoefficient(instance.signalFlowParameters?.coefficient ?? "");
    setBodyWidth(instance.signalFlowParameters?.bodyWidth?.toString() ?? "");
    setBodyHeight(instance.signalFlowParameters?.bodyHeight?.toString() ?? "");
    committedParameters.current = instance.signalFlowParameters;
  }, [
    instance.id,
    instance.signalFlowParameters,
    presentation.defaultFormula,
    revision,
  ]);

  const commit = () => {
    const next = normalizedParameters(
      formula,
      coefficient,
      bodyWidth,
      bodyHeight,
      presentation.supportsCoefficient,
      presentation.defaultFormula,
    );
    if (sameParameters(committedParameters.current, next)) return;
    if (onChange(next)) {
      committedParameters.current = next ?? undefined;
      // Show what the block actually renders: clearing the field falls back
      // to the Symbol's own formula rather than leaving an empty box.
      setFormula(next?.formula ?? presentation.defaultFormula);
      setBodyWidth(next?.bodyWidth?.toString() ?? "");
      setBodyHeight(next?.bodyHeight?.toString() ?? "");
    }
  };
  const resetDefaults = () => {
    if (committedParameters.current !== undefined && onChange(null)) {
      committedParameters.current = undefined;
      setFormula(presentation.defaultFormula);
      setCoefficient("");
      setBodyWidth("");
      setBodyHeight("");
    }
  };
  const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit();
    event.currentTarget.blur();
  };

  return (
    <section
      className="property-card component-signal-flow-card"
      aria-label="Signal flow transfer function"
    >
      <div className="property-section-heading">Transfer function</div>
      <label>
        Formula
        <input
          aria-label="Signal flow formula"
          value={formula}
          placeholder={presentation.defaultFormula}
          onChange={(event) => setFormula(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={commitOnEnter}
        />
      </label>
      {presentation.supportsCoefficient ? (
        <label>
          Coefficient
          <input
            aria-label="Signal flow coefficient"
            value={coefficient}
            placeholder="Optional"
            onChange={(event) => setCoefficient(event.currentTarget.value)}
            onBlur={commit}
            onKeyDown={commitOnEnter}
          />
        </label>
      ) : null}
      {presentation.adaptiveFrame ? (
        <div className="signal-flow-size-grid">
          <label>
            Min width
            <input
              aria-label="Signal flow minimum width"
              type="number"
              min={20}
              max={1000}
              step={10}
              value={bodyWidth}
              placeholder="Auto"
              onChange={(event) => setBodyWidth(event.currentTarget.value)}
              onBlur={commit}
              onKeyDown={commitOnEnter}
            />
          </label>
          <label>
            Min height
            <input
              aria-label="Signal flow minimum height"
              type="number"
              min={20}
              max={500}
              step={10}
              value={bodyHeight}
              placeholder="Auto"
              onChange={(event) => setBodyHeight(event.currentTarget.value)}
              onBlur={commit}
              onKeyDown={commitOnEnter}
            />
          </label>
        </div>
      ) : null}
      <div className="signal-flow-actions">
        <button type="button" onClick={resetDefaults}>
          Reset defaults
        </button>
      </div>
      <small>
        Formula text and frame size adapt visually. This does not change SPICE,
        netlist identity, or electrical connectivity.
      </small>
    </section>
  );
}
