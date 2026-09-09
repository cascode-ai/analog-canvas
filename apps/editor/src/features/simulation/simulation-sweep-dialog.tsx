import { useEffect, useMemo, useState } from "react";
import type { CircuitProject, ProjectSimulationSetup } from "@icm/model";
import type {
  Capabilities,
  SimulationOperation,
} from "@icm/simulation-service/contract";

export type SimulationSweepAxis = Extract<
  SimulationOperation,
  { operation: "prepare-sweep" }
>["axes"][number];

interface SimulationSweepDialogProps {
  open: boolean;
  project: CircuitProject;
  setup: ProjectSimulationSetup;
  capabilities: Capabilities;
  disabled?: boolean;
  onClose(): void;
  onRun(axes: readonly SimulationSweepAxis[]): void;
}

function commaValues(value: string): readonly string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function SimulationSweepDialog(props: SimulationSweepDialogProps) {
  const input = props.setup.input;
  const profile =
    input.kind === "structured"
      ? props.capabilities.profiles.find(
          (candidate) => candidate.id === input.environment.profileId,
        )
      : undefined;
  const parameterChoices = useMemo(
    () =>
      props.project.documents.flatMap((document) =>
        document.instances.flatMap((instance) =>
          Object.keys(instance.netlist?.parameters ?? {}).map((parameter) => ({
            id: `${document.id}\u0000${instance.id}\u0000${parameter}`,
            documentId: document.id,
            instanceId: instance.id,
            parameter,
            label: `${document.name} · ${instance.reference ?? instance.id} · ${parameter}`,
          })),
        ),
      ),
    [props.project],
  );
  const [cornerEnabled, setCornerEnabled] = useState(true);
  const [corners, setCorners] = useState<readonly string[]>([]);
  const [temperatureEnabled, setTemperatureEnabled] = useState(false);
  const [temperatures, setTemperatures] = useState("-40, 27, 125");
  const [parameterEnabled, setParameterEnabled] = useState(false);
  const [parameterChoiceId, setParameterChoiceId] = useState("");
  const [parameterValues, setParameterValues] = useState("");

  useEffect(() => {
    if (!props.open) return;
    const currentCorner =
      input.kind === "structured" ? input.environment.corner : undefined;
    setCorners(
      currentCorner && profile?.corners.includes(currentCorner)
        ? [currentCorner]
        : (profile?.corners.slice(0, 1) ?? []),
    );
    setParameterChoiceId(parameterChoices[0]?.id ?? "");
  }, [props.open, props.setup.id, profile, parameterChoices, input]);

  if (!props.open || input.kind !== "structured") return null;
  const temperatureValues = commaValues(temperatures).map(Number);
  const parameter = parameterChoices.find(
    (candidate) => candidate.id === parameterChoiceId,
  );
  const parsedParameterValues = commaValues(parameterValues);
  const pointCount =
    (cornerEnabled ? corners.length : 1) *
    (temperatureEnabled ? temperatureValues.length : 1) *
    (parameterEnabled ? parsedParameterValues.length : 1);
  const axisCount =
    Number(cornerEnabled) +
    Number(temperatureEnabled) +
    Number(parameterEnabled);
  const maxItems = props.capabilities.batch?.maxItems ?? 16;
  const valid =
    axisCount > 0 &&
    pointCount >= 2 &&
    pointCount <= maxItems &&
    (!cornerEnabled || corners.length > 0) &&
    (!temperatureEnabled ||
      (temperatureValues.length > 0 &&
        temperatureValues.every(Number.isFinite))) &&
    (!parameterEnabled || Boolean(parameter && parsedParameterValues.length));

  return (
    <div className="simulation-sweep-backdrop" role="presentation">
      <form
        className="simulation-sweep-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Run parameter sweep"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          const axes: SimulationSweepAxis[] = [];
          if (cornerEnabled)
            axes.push({ kind: "corner", values: [...corners] });
          if (temperatureEnabled)
            axes.push({ kind: "temperature", values: temperatureValues });
          if (parameterEnabled && parameter)
            axes.push({
              kind: "parameter",
              documentId: parameter.documentId,
              instanceId: parameter.instanceId,
              parameter: parameter.parameter,
              values: [...parsedParameterValues],
            });
          props.onRun(axes);
        }}
      >
        <header>
          <div>
            <strong>Sweep · {props.setup.name}</strong>
            <span>Run-only variants; the saved Setup is unchanged.</span>
          </div>
          <button
            type="button"
            aria-label="Close sweep"
            onClick={props.onClose}
          >
            ×
          </button>
        </header>

        <div className="simulation-sweep-axis">
          <input
            type="checkbox"
            aria-label="Enable corner sweep"
            checked={cornerEnabled}
            onChange={(event) => setCornerEnabled(event.currentTarget.checked)}
          />
          <span>Corner</span>
          <span className="simulation-sweep-corners">
            {(profile?.corners ?? []).map((corner) => (
              <label key={corner}>
                <input
                  type="checkbox"
                  aria-label={`Sweep corner ${corner}`}
                  checked={corners.includes(corner)}
                  disabled={!cornerEnabled}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setCorners((current) =>
                      checked
                        ? [...current, corner]
                        : current.filter((value) => value !== corner),
                    );
                  }}
                />
                {corner}
              </label>
            ))}
          </span>
        </div>

        <div className="simulation-sweep-axis">
          <input
            type="checkbox"
            aria-label="Enable temperature sweep"
            checked={temperatureEnabled}
            onChange={(event) =>
              setTemperatureEnabled(event.currentTarget.checked)
            }
          />
          <span>Temperature / °C</span>
          <input
            aria-label="Sweep temperatures"
            value={temperatures}
            disabled={!temperatureEnabled}
            onChange={(event) => setTemperatures(event.currentTarget.value)}
            placeholder="-40, 27, 125"
          />
        </div>

        <div className="simulation-sweep-axis">
          <input
            type="checkbox"
            aria-label="Enable instance parameter sweep"
            checked={parameterEnabled}
            onChange={(event) =>
              setParameterEnabled(event.currentTarget.checked)
            }
          />
          <span>Instance parameter</span>
          <span className="simulation-sweep-parameter">
            <select
              aria-label="Sweep instance parameter"
              value={parameterChoiceId}
              disabled={!parameterEnabled}
              onChange={(event) =>
                setParameterChoiceId(event.currentTarget.value)
              }
            >
              {parameterChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Sweep parameter values"
              value={parameterValues}
              disabled={!parameterEnabled}
              onChange={(event) =>
                setParameterValues(event.currentTarget.value)
              }
              placeholder="1u, 2u, 5u"
            />
          </span>
        </div>

        <footer>
          <span>
            {valid
              ? `${pointCount} sequential runs`
              : pointCount > maxItems
                ? `${pointCount} runs exceeds ${maxItems}`
                : "Choose at least two valid points"}
          </span>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="simulation-primary-button"
            disabled={!valid || props.disabled}
          >
            Run sweep
          </button>
        </footer>
      </form>
    </div>
  );
}
