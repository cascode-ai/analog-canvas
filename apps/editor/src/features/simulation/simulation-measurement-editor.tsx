import type {
  SimulationMeasurementMethod,
  SimulationMeasurementSpec,
} from "@icm/model";

type AnalysisKind = SimulationMeasurementSpec["analysis"];

export interface SimulationMeasurementOutputOption {
  readonly id: string;
  readonly label: string;
}

const METHOD_LABELS = {
  value: "Value",
  "sample-at": "Value at…",
  minimum: "Minimum",
  maximum: "Maximum",
  "peak-to-peak": "Peak to peak",
  mean: "Mean",
  rms: "RMS",
} as const;

function methodsFor(analysis: AnalysisKind) {
  if (analysis === "op") return ["value"] as const;
  if (analysis === "tran")
    return [
      "sample-at",
      "minimum",
      "maximum",
      "peak-to-peak",
      "mean",
      "rms",
    ] as const;
  return ["sample-at", "minimum", "maximum", "peak-to-peak"] as const;
}

function defaultMethod(analysis: AnalysisKind): SimulationMeasurementMethod {
  return analysis === "op" ? { kind: "value" } : { kind: "maximum" };
}

function coordinateLabel(analysis: AnalysisKind): string {
  if (analysis === "ac" || analysis === "noise") return "Frequency / Hz";
  if (analysis === "tran") return "Time / s";
  return "Sweep value / SI";
}

function needsRequiredWindow(method: SimulationMeasurementMethod): boolean {
  return method.kind === "mean" || method.kind === "rms";
}

function methodWindow(method: SimulationMeasurementMethod) {
  return "window" in method ? method.window : undefined;
}

export function SimulationMeasurementEditor({
  analyses,
  outputs,
  measurements,
  onChange,
}: {
  analyses: readonly AnalysisKind[];
  outputs: readonly SimulationMeasurementOutputOption[];
  measurements: readonly SimulationMeasurementSpec[];
  onChange(next: SimulationMeasurementSpec[]): void;
}) {
  const update = (
    id: string,
    transform: (
      current: SimulationMeasurementSpec,
    ) => SimulationMeasurementSpec,
  ) =>
    onChange(
      measurements.map((measurement) =>
        measurement.id === id ? transform(measurement) : measurement,
      ),
    );
  const canAdd = analyses.length > 0 && outputs.length > 0;

  return (
    <div className="simulation-measurement-editor">
      {!outputs.length ? (
        <small>Add an Output signal before defining a measurement.</small>
      ) : null}
      {measurements.map((measurement) => {
        const method = measurement.method;
        const window = methodWindow(method);
        const supportsOptionalWindow =
          method.kind === "minimum" ||
          method.kind === "maximum" ||
          method.kind === "peak-to-peak";
        const showWindow = needsRequiredWindow(method) || !!window;
        return (
          <fieldset
            key={measurement.id}
            className="simulation-measurement-rule"
          >
            <legend>{measurement.label || "Measurement"}</legend>
            <label>
              Name
              <input
                value={measurement.label}
                onChange={(event) =>
                  update(measurement.id, (current) => ({
                    ...current,
                    label: event.currentTarget.value,
                  }))
                }
              />
            </label>
            <div className="simulation-inline-fields columns-2">
              <label>
                Analysis
                <select
                  value={measurement.analysis}
                  onChange={(event) => {
                    const analysis = event.currentTarget.value as AnalysisKind;
                    update(measurement.id, (current) => ({
                      ...current,
                      analysis,
                      method: defaultMethod(analysis),
                    }));
                  }}
                >
                  {analyses.map((analysis) => (
                    <option key={analysis} value={analysis}>
                      {analysis.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Output
                <select
                  value={measurement.outputId}
                  onChange={(event) =>
                    update(measurement.id, (current) => ({
                      ...current,
                      outputId: event.currentTarget.value,
                    }))
                  }
                >
                  {outputs.map((output) => (
                    <option key={output.id} value={output.id}>
                      {output.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Measure
              <select
                value={method.kind}
                onChange={(event) => {
                  const kind = event.currentTarget
                    .value as keyof typeof METHOD_LABELS;
                  const nextMethod: SimulationMeasurementMethod =
                    kind === "sample-at"
                      ? { kind, coordinate: 0 }
                      : kind === "mean" || kind === "rms"
                        ? { kind, window: { start: 0, stop: 1 } }
                        : kind === "value"
                          ? { kind }
                          : { kind };
                  update(measurement.id, (current) => ({
                    ...current,
                    method: nextMethod,
                  }));
                }}
              >
                {methodsFor(measurement.analysis).map((kind) => (
                  <option key={kind} value={kind}>
                    {METHOD_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            {method.kind === "sample-at" ? (
              <label>
                {coordinateLabel(measurement.analysis)}
                <input
                  type="number"
                  step="any"
                  value={method.coordinate}
                  onChange={(event) =>
                    update(measurement.id, (current) => ({
                      ...current,
                      method: {
                        kind: "sample-at",
                        coordinate: Number(event.currentTarget.value),
                      },
                    }))
                  }
                />
              </label>
            ) : null}
            {supportsOptionalWindow ? (
              <label>
                Range
                <select
                  value={showWindow ? "window" : "all"}
                  onChange={(event) => {
                    const useWindow = event.currentTarget.value === "window";
                    update(measurement.id, (current) => ({
                      ...current,
                      method: {
                        kind: method.kind,
                        ...(useWindow ? { window: { start: 0, stop: 1 } } : {}),
                      },
                    }));
                  }}
                >
                  <option value="all">Entire analysis</option>
                  <option value="window">Window</option>
                </select>
              </label>
            ) : null}
            {showWindow ? (
              <div className="simulation-inline-fields columns-2">
                <label>
                  Window start / SI
                  <input
                    type="number"
                    step="any"
                    value={window?.start ?? 0}
                    onChange={(event) =>
                      update(measurement.id, (current) => ({
                        ...current,
                        method: {
                          ...current.method,
                          window: {
                            start: Number(event.currentTarget.value),
                            stop: methodWindow(current.method)?.stop ?? 1,
                          },
                        } as SimulationMeasurementMethod,
                      }))
                    }
                  />
                </label>
                <label>
                  Window stop / SI
                  <input
                    type="number"
                    step="any"
                    value={window?.stop ?? 1}
                    onChange={(event) =>
                      update(measurement.id, (current) => ({
                        ...current,
                        method: {
                          ...current.method,
                          window: {
                            start: methodWindow(current.method)?.start ?? 0,
                            stop: Number(event.currentTarget.value),
                          },
                        } as SimulationMeasurementMethod,
                      }))
                    }
                  />
                </label>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() =>
                onChange(
                  measurements.filter(
                    (candidate) => candidate.id !== measurement.id,
                  ),
                )
              }
            >
              Remove measurement
            </button>
          </fieldset>
        );
      })}
      <button
        type="button"
        disabled={!canAdd}
        onClick={() => {
          const analysis = analyses[0]!;
          const output = outputs[0]!;
          const ordinal = measurements.length + 1;
          onChange([
            ...measurements,
            {
              id: `measurement-${crypto.randomUUID()}`,
              label: `Measurement ${ordinal}`,
              analysis,
              outputId: output.id,
              method: defaultMethod(analysis),
            },
          ]);
        }}
      >
        Add measurement
      </button>
    </div>
  );
}
