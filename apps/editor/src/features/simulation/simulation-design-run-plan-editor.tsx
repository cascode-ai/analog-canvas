import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  CircuitProject,
  SimulationDesignVariable,
  SimulationRunPlan,
  SimulationRunPlanAxis,
} from "@icm/model";
import type { Capabilities } from "@icm/simulation-service/contract";

interface ParameterChoice {
  readonly id: string;
  readonly documentId: string;
  readonly instanceId: string;
  readonly parameter: string;
  readonly label: string;
}

function parameterKey(target: {
  readonly documentId: string;
  readonly instanceId: string;
  readonly parameter: string;
}): string {
  return `${target.documentId}\u0000${target.instanceId}\u0000${target.parameter}`;
}

export function deriveSimulationParameterChoices(
  project: CircuitProject,
): readonly ParameterChoice[] {
  return project.documents.flatMap((document) =>
    document.instances.flatMap((instance) =>
      Object.keys(instance.netlist?.parameters ?? {}).map((parameter) => ({
        id: parameterKey({
          documentId: document.id,
          instanceId: instance.id,
          parameter,
        }),
        documentId: document.id,
        instanceId: instance.id,
        parameter,
        label: `${document.name} · ${instance.reference ?? instance.id} · ${parameter}`,
      })),
    ),
  );
}

export function simulationRunPlanPointCount(plan: SimulationRunPlan): number {
  return plan.mode === "nominal"
    ? 1
    : plan.axes.reduce((count, axis) => count * axis.values.length, 1);
}

type DraftValuesResult<T extends string | number> =
  | { readonly ok: true; readonly values: readonly T[] }
  | { readonly ok: false; readonly message: string };

function parseTextValues(value: string): DraftValuesResult<string> {
  const values = value.split(",").map((part) => part.trim());
  if (!value.trim() || values.some((part) => !part))
    return {
      ok: false,
      message: "Enter one or more comma-separated values.",
    };
  return { ok: true, values };
}

function parseTemperatureValues(value: string): DraftValuesResult<number> {
  const parsed = parseTextValues(value);
  if (!parsed.ok)
    return {
      ok: false,
      message: "Enter one or more comma-separated temperatures.",
    };
  const values = parsed.values.map(Number);
  if (values.some((candidate) => !Number.isFinite(candidate)))
    return {
      ok: false,
      message: "Every temperature must be a finite number in °C.",
    };
  return { ok: true, values };
}

function DraftValuesInput<T extends string | number>({
  label,
  values,
  parse,
  onCommit,
}: {
  readonly label: string;
  readonly values: readonly T[];
  readonly parse: (value: string) => DraftValuesResult<T>;
  readonly onCommit: (values: readonly T[]) => void;
}) {
  const canonical = values.join(", ");
  const [draft, setDraft] = useState(canonical);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const problemId = useId();

  useEffect(() => {
    setDraft(canonical);
    setProblem(null);
    input.current?.setCustomValidity("");
  }, [canonical]);

  const commit = () => {
    const result = parse(draft);
    if (!result.ok) {
      setProblem(result.message);
      input.current?.setCustomValidity(result.message);
      return;
    }
    setProblem(null);
    input.current?.setCustomValidity("");
    setDraft(result.values.join(", "));
    onCommit(result.values);
  };

  return (
    <span className="simulation-run-plan-draft-values">
      <input
        ref={input}
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
        value={draft}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setProblem(null);
          event.currentTarget.setCustomValidity("");
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(canonical);
            setProblem(null);
            event.currentTarget.setCustomValidity("");
            event.currentTarget.blur();
          }
        }}
      />
      {problem ? (
        <small id={problemId} role="alert">
          {problem}
        </small>
      ) : null}
    </span>
  );
}

function nextVariableName(variables: readonly SimulationDesignVariable[]) {
  let index = variables.length + 1;
  while (variables.some(({ name }) => name === `VAR${index}`)) index += 1;
  return `VAR${index}`;
}

export function DesignVariablesEditor({
  project,
  variables,
  onChange,
}: {
  project: CircuitProject;
  variables: readonly SimulationDesignVariable[];
  onChange(variables: SimulationDesignVariable[]): void;
}) {
  const choices = useMemo(
    () => deriveSimulationParameterChoices(project),
    [project],
  );
  const [bindingChoices, setBindingChoices] = useState<
    Readonly<Record<string, string>>
  >({});
  const alreadyBound = new Set(
    variables.flatMap((variable) => variable.bindings.map(parameterKey)),
  );
  return (
    <div className="simulation-design-variables">
      {variables.map((variable) => {
        const selectedChoice = choices.find(
          ({ id }) => id === bindingChoices[variable.id],
        );
        return (
          <div className="simulation-variable-card" key={variable.id}>
            <div className="simulation-inline-fields simulation-variable-row">
              <label>
                Name
                <input
                  aria-label={`Design Variable name ${variable.name}`}
                  value={variable.name}
                  onChange={(event) =>
                    onChange(
                      variables.map((candidate) =>
                        candidate.id === variable.id
                          ? { ...candidate, name: event.currentTarget.value }
                          : candidate,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Nominal value
                <input
                  aria-label={`Design Variable value ${variable.name}`}
                  value={variable.value}
                  onChange={(event) =>
                    onChange(
                      variables.map((candidate) =>
                        candidate.id === variable.id
                          ? { ...candidate, value: event.currentTarget.value }
                          : candidate,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                aria-label={`Remove Design Variable ${variable.name}`}
                onClick={() =>
                  onChange(
                    variables.filter(
                      (candidate) => candidate.id !== variable.id,
                    ),
                  )
                }
              >
                Remove
              </button>
            </div>
            <div className="simulation-variable-binding-row">
              <select
                aria-label={`Parameter binding for ${variable.name}`}
                value={bindingChoices[variable.id] ?? ""}
                onChange={(event) =>
                  setBindingChoices((current) => ({
                    ...current,
                    [variable.id]: event.currentTarget.value,
                  }))
                }
              >
                <option value="">Bind an Instance parameter…</option>
                {choices.map((choice) => (
                  <option
                    key={choice.id}
                    value={choice.id}
                    disabled={alreadyBound.has(choice.id)}
                  >
                    {choice.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedChoice}
                onClick={() => {
                  if (!selectedChoice) return;
                  onChange(
                    variables.map((candidate) =>
                      candidate.id === variable.id
                        ? {
                            ...candidate,
                            bindings: [
                              ...candidate.bindings,
                              {
                                documentId: selectedChoice.documentId,
                                instanceId: selectedChoice.instanceId,
                                parameter: selectedChoice.parameter,
                              },
                            ],
                          }
                        : candidate,
                    ),
                  );
                  setBindingChoices((current) => ({
                    ...current,
                    [variable.id]: "",
                  }));
                }}
              >
                Add binding
              </button>
            </div>
            {variable.bindings.length ? (
              <ul className="simulation-variable-bindings">
                {variable.bindings.map((binding) => {
                  const key = parameterKey(binding);
                  const label =
                    choices.find(({ id }) => id === key)?.label ??
                    `${binding.instanceId} · ${binding.parameter} (unavailable)`;
                  return (
                    <li key={key}>
                      <span>{label}</span>
                      <button
                        type="button"
                        aria-label={`Remove binding ${label}`}
                        onClick={() =>
                          onChange(
                            variables.map((candidate) =>
                              candidate.id === variable.id
                                ? {
                                    ...candidate,
                                    bindings: candidate.bindings.filter(
                                      (item) => parameterKey(item) !== key,
                                    ),
                                  }
                                : candidate,
                            ),
                          )
                        }
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <small>No parameters bound.</small>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...variables,
            {
              id: `simulation-variable-${crypto.randomUUID()}`,
              name: nextVariableName(variables),
              value: "1",
              bindings: [],
            },
          ])
        }
      >
        Add variable
      </button>
    </div>
  );
}

export function RunPlanEditor({
  project,
  variables,
  plan,
  capabilities,
  profileId,
  onChange,
}: {
  project: CircuitProject;
  variables: readonly SimulationDesignVariable[];
  plan: SimulationRunPlan;
  capabilities: Capabilities | undefined;
  profileId: string;
  onChange(plan: SimulationRunPlan): void;
}) {
  const [showPoints, setShowPoints] = useState(false);
  const choices = useMemo(
    () => deriveSimulationParameterChoices(project),
    [project],
  );
  const profile = capabilities?.profiles.find(({ id }) => id === profileId);
  const maxItems = capabilities?.batch?.maxItems ?? 16;
  const axes = plan.mode === "sweep" ? plan.axes : [];
  const pointCount = simulationRunPlanPointCount(plan);
  const replaceAxis = (index: number, axis: SimulationRunPlanAxis) =>
    onChange({
      mode: "sweep",
      axes: axes.map((candidate, candidateIndex) =>
        candidateIndex === index ? axis : candidate,
      ),
    });
  const addAxis = (axis: SimulationRunPlanAxis) =>
    onChange({ mode: "sweep", axes: [...axes, axis] });
  const axisKinds = new Set(axes.map(({ kind }) => kind));
  return (
    <div className="simulation-run-plan-editor">
      <div className="simulation-run-plan-mode" role="radiogroup">
        <label>
          <input
            type="radio"
            name="runPlanMode"
            checked={plan.mode === "nominal"}
            onChange={() => onChange({ mode: "nominal" })}
          />
          Nominal
        </label>
        <label>
          <input
            type="radio"
            name="runPlanMode"
            checked={plan.mode === "sweep"}
            onChange={() =>
              onChange({
                mode: "sweep",
                axes: [
                  {
                    kind: "corner",
                    values: profile?.corners.slice(0, 1) ?? ["tt"],
                  },
                ],
              })
            }
          />
          Sweep
        </label>
      </div>
      {plan.mode === "sweep" ? (
        <>
          {axes.map((axis, index) => (
            <div
              className="simulation-run-plan-axis"
              key={`${axis.kind}:${index}`}
            >
              <strong>
                {axis.kind === "corner"
                  ? "Corner"
                  : axis.kind === "temperature"
                    ? "Temperature / °C"
                    : axis.kind === "variable"
                      ? "Design Variable"
                      : "Instance parameter"}
              </strong>
              {axis.kind === "corner" ? (
                <span className="simulation-run-plan-corners">
                  {(profile?.corners ?? axis.values).map((corner) => (
                    <label key={corner}>
                      <input
                        type="checkbox"
                        aria-label={`Run Plan corner ${corner}`}
                        checked={axis.values.includes(corner)}
                        onChange={(event) => {
                          const values = event.currentTarget.checked
                            ? [...axis.values, corner]
                            : axis.values.filter((value) => value !== corner);
                          if (values.length)
                            replaceAxis(index, { ...axis, values });
                        }}
                      />
                      {corner.toUpperCase()}
                    </label>
                  ))}
                </span>
              ) : axis.kind === "temperature" ? (
                <DraftValuesInput
                  label="Run Plan temperatures"
                  values={axis.values}
                  parse={parseTemperatureValues}
                  onCommit={(values) =>
                    replaceAxis(index, { ...axis, values: [...values] })
                  }
                />
              ) : axis.kind === "variable" ? (
                <span className="simulation-run-plan-target-values">
                  <select
                    aria-label="Run Plan Design Variable"
                    value={axis.variableId}
                    onChange={(event) =>
                      replaceAxis(index, {
                        ...axis,
                        variableId: event.currentTarget.value,
                      })
                    }
                  >
                    {variables.map((variable) => (
                      <option key={variable.id} value={variable.id}>
                        {variable.name}
                      </option>
                    ))}
                  </select>
                  <DraftValuesInput
                    label="Run Plan Design Variable values"
                    values={axis.values}
                    parse={parseTextValues}
                    onCommit={(values) =>
                      replaceAxis(index, { ...axis, values: [...values] })
                    }
                  />
                </span>
              ) : (
                <span className="simulation-run-plan-target-values">
                  <select
                    aria-label="Run Plan Instance parameter"
                    value={parameterKey(axis)}
                    onChange={(event) => {
                      const choice = choices.find(
                        ({ id }) => id === event.currentTarget.value,
                      );
                      if (choice)
                        replaceAxis(index, {
                          ...axis,
                          documentId: choice.documentId,
                          instanceId: choice.instanceId,
                          parameter: choice.parameter,
                        });
                    }}
                  >
                    {choices.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  <DraftValuesInput
                    label="Run Plan Instance parameter values"
                    values={axis.values}
                    parse={parseTextValues}
                    onCommit={(values) =>
                      replaceAxis(index, { ...axis, values: [...values] })
                    }
                  />
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${axis.kind} axis`}
                onClick={() => {
                  const next = axes.filter(
                    (_, candidate) => candidate !== index,
                  );
                  onChange(
                    next.length
                      ? { mode: "sweep", axes: next }
                      : { mode: "nominal" },
                  );
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="simulation-run-plan-add">
            <span>Add axis</span>
            <button
              type="button"
              disabled={axes.length >= 4 || axisKinds.has("corner")}
              onClick={() =>
                addAxis({
                  kind: "corner",
                  values: profile?.corners.slice(0, 1) ?? ["tt"],
                })
              }
            >
              Corner
            </button>
            <button
              type="button"
              disabled={axes.length >= 4 || axisKinds.has("temperature")}
              onClick={() =>
                addAxis({ kind: "temperature", values: [-40, 27, 125] })
              }
            >
              Temperature
            </button>
            <button
              type="button"
              disabled={axes.length >= 4 || variables.length === 0}
              onClick={() => {
                const variable = variables.find(
                  ({ id }) =>
                    !axes.some(
                      (axis) =>
                        axis.kind === "variable" && axis.variableId === id,
                    ),
                );
                if (variable)
                  addAxis({
                    kind: "variable",
                    variableId: variable.id,
                    values: [variable.value],
                  });
              }}
            >
              Variable
            </button>
            <details>
              <summary>Advanced</summary>
              <button
                type="button"
                disabled={axes.length >= 4 || choices.length === 0}
                onClick={() => {
                  const choice = choices[0];
                  if (choice)
                    addAxis({
                      kind: "parameter",
                      documentId: choice.documentId,
                      instanceId: choice.instanceId,
                      parameter: choice.parameter,
                      values: ["1"],
                    });
                }}
              >
                Instance parameter
              </button>
            </details>
          </div>
          <div className="simulation-run-plan-summary">
            <strong>{pointCount} points</strong>
            {pointCount > maxItems ? (
              <span role="alert">Maximum for this executor is {maxItems}.</span>
            ) : (
              <span>Sequential batch</span>
            )}
            <button
              type="button"
              onClick={() => setShowPoints((value) => !value)}
            >
              {showPoints ? "Hide points" : "View points"}
            </button>
          </div>
          {showPoints ? (
            <ol className="simulation-run-plan-points">
              {expandPlanLabels(plan, variables).map((label, index) => (
                <li key={`${index}:${label}`}>{label}</li>
              ))}
            </ol>
          ) : null}
        </>
      ) : (
        <small>One run using the nominal Setup values.</small>
      )}
    </div>
  );
}

function expandPlanLabels(
  plan: SimulationRunPlan,
  variables: readonly SimulationDesignVariable[],
): readonly string[] {
  if (plan.mode === "nominal") return ["Nominal"];
  let points: string[][] = [[]];
  for (const axis of plan.axes) {
    points = points.flatMap((point) =>
      axis.values.map((value) => [
        ...point,
        axis.kind === "corner"
          ? `corner=${value}`
          : axis.kind === "temperature"
            ? `temp=${value} °C`
            : axis.kind === "variable"
              ? `${variables.find(({ id }) => id === axis.variableId)?.name ?? axis.variableId}=${value}`
              : `${axis.instanceId}.${axis.parameter}=${value}`,
      ]),
    );
  }
  return points.map((point) => point.join(", "));
}
