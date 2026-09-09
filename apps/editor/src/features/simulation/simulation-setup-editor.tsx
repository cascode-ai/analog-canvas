import { useEffect, useId, useState, type ReactNode } from "react";
import authoringProfile from "../../../../../containers/ngspice/hosted-sky130-profile.json";
import {
  SIMULATION_NOISE_INPUT_DENSITY_ID,
  SIMULATION_NOISE_OUTPUT_DENSITY_ID,
  SimulationSetupSchema,
  parseSimulationExpression,
  type ProjectSimulationSetup,
  type SimulationMeasurementSpec,
  type SimulationDeviceOperatingPointSpec,
  type SimulationDesignVariable,
  type SimulationExpression,
  type SimulationOutputSpec,
  type SimulationStructuredInput,
  type SimulationRunPlan,
  type SimulationVoltageProbe,
} from "@icm/model";
import type { Capabilities, Problem } from "@icm/simulation-service/contract";
import type { SpiceSimulationSurfaceProps } from "./simulation-surface-types";
import {
  deriveSimulationProbeOptions,
  matchSimulationTerminalCurrentProbeOptions,
  matchSimulationVoltageProbeOptions,
  simulationProbeSelectionKey,
  simulationProbeTargetKey,
  simulationDeviceOperatingPointTargetKey,
  type SimulationProbeOption,
} from "./simulation-probe-options";
import { SimulationMeasurementEditor } from "./simulation-measurement-editor";
import {
  DesignVariablesEditor,
  RunPlanEditor,
  simulationRunPlanPointCount,
} from "./simulation-design-run-plan-editor";
const uiProblem = (code: string, message: string): Problem => ({
  code,
  message,
  stage: "input",
  recovery: "fix-input",
});
// Vite's UI-only development server has no execution capabilities endpoint.
// Keep its single Preview profile visible for setup authoring; a deployed
// executor's advertised profiles remain authoritative whenever available.
export const DEVELOPMENT_PROFILE_ID = import.meta.env.DEV
  ? authoringProfile.id
  : "";
const DEVELOPMENT_PROFILE_LABEL = authoringProfile.displayName;
const DEVELOPMENT_CORNERS = authoringProfile.qualifiedScope.sections;
const DEFAULT_SIMULATION_TEMPERATURE_C = 27;

function SimulationSettingsSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="simulation-settings-section"
      aria-label={`${title} settings`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <strong>{title}</strong>
        {summary ? <span>{summary}</span> : null}
      </summary>
      <div className="simulation-settings-section-body">{children}</div>
    </details>
  );
}

export function SetupEditor({
  project,
  activeDocumentId,
  draftContext,
  capabilities,
  onSaveSetup,
  setup,
  onDirty,
  onProblem,
  pickNetsActive,
  pickedNet,
  onPickNetsChange,
  pickTerminalsActive,
  pickedTerminal,
  onPickTerminalsChange,
}: SpiceSimulationSurfaceProps & {
  setup: ProjectSimulationSetup | undefined;
  capabilities: Capabilities | undefined;
  onDirty(value: boolean): void;
  onProblem(value: Problem | undefined): void;
}) {
  const saved = setup?.input.kind === "structured" ? setup.input : undefined;
  const rootId =
    saved?.rootDocumentId ?? draftContext?.rootDocumentId ?? activeDocumentId;
  const [outputs, setOutputs] = useState(saved?.outputs ?? []);
  const [measurements, setMeasurements] = useState<SimulationMeasurementSpec[]>(
    [...(saved?.measurements ?? [])],
  );
  const [deviceOperatingPoints, setDeviceOperatingPoints] = useState<
    SimulationDeviceOperatingPointSpec[]
  >([...(saved?.deviceOperatingPoints ?? [])]);
  const [designVariables, setDesignVariables] = useState<
    SimulationDesignVariable[]
  >([...(saved?.designVariables ?? [])]);
  const [runPlan, setRunPlan] = useState<SimulationRunPlan>(
    saved?.runPlan ?? { mode: "nominal" },
  );
  const [deviceOperatingPointChoice, setDeviceOperatingPointChoice] =
    useState("");
  const [setupName, setSetupName] = useState(
    setup?.name ?? draftContext?.setupName ?? "Setup 1",
  );
  const [expressionText, setExpressionText] = useState("");
  const [expressionLabel, setExpressionLabel] = useState("");
  const [editingOutputId, setEditingOutputId] = useState<string>();
  const root = project.documents.find((d) => d.id === rootId);
  const probeOptions = deriveSimulationProbeOptions(project, rootId);
  const dcSources = (root?.instances ?? []).flatMap((instance) => {
    const binding = instance.netlist?.binding;
    if (
      binding?.kind !== "primitive" ||
      (binding.deviceClass !== "voltage-source" &&
        binding.deviceClass !== "current-source")
    )
      return [];
    return [
      {
        id: instance.id,
        label: `${instance.reference} · ${binding.deviceClass === "voltage-source" ? "Voltage" : "Current"}`,
        unit: binding.deviceClass === "voltage-source" ? "V" : "A",
      },
    ];
  });
  const probeLabels = new Map<string, string>();
  for (const option of [
    ...probeOptions.voltage,
    ...probeOptions.terminalCurrent,
  ]) {
    // The option key is Logical-Net scoped for selection deduplication, while
    // a persisted output keeps its durable object anchor. Both identities
    // describe the same visible target and therefore share one display label.
    probeLabels.set(option.key, option.label);
    probeLabels.set(simulationProbeTargetKey(option.target), option.label);
  }
  const selectedProbeKeys = new Set(
    outputs.flatMap((output) =>
      output.expression.kind === "voltage" ||
      output.expression.kind === "current"
        ? [simulationProbeSelectionKey(project, output.expression)]
        : [],
    ),
  );
  const dc = saved?.analyses.find((a) => a.kind === "dc");
  const ac = saved?.analyses.find((a) => a.kind === "ac");
  const tran = saved?.analyses.find((a) => a.kind === "tran");
  const noise = saved?.analyses.find((a) => a.kind === "noise");
  const [dcEnabled, setDcEnabled] = useState(!!dc);
  const [dcSourceId, setDcSourceId] = useState(
    dc?.sourceInstanceId ?? dcSources[0]?.id ?? "",
  );
  const [acEnabled, setAcEnabled] = useState(!!ac);
  const [tranEnabled, setTranEnabled] = useState(!!tran);
  const [noiseEnabled, setNoiseEnabled] = useState(!!noise);
  const [noiseInputSourceId, setNoiseInputSourceId] = useState(
    noise?.inputSourceInstanceId ?? dcSources[0]?.id ?? "",
  );
  const [noisePositive, setNoisePositive] = useState<
    SimulationVoltageProbe | undefined
  >(noise?.output.positive);
  const [noiseNegative, setNoiseNegative] = useState<
    SimulationVoltageProbe | undefined
  >(noise?.output.negative);
  const [opEnabled, setOpEnabled] = useState(
    !saved || saved.analyses.some((analysis) => analysis.kind === "op"),
  );
  const [profileId, setProfileId] = useState(
    saved?.environment.profileId ?? DEVELOPMENT_PROFILE_ID,
  );
  const [corner, setCorner] = useState(
    saved?.environment.corner ?? (DEVELOPMENT_PROFILE_ID ? "tt" : ""),
  );
  const [temperatureC, setTemperatureC] = useState(
    String(saved?.environment.temperatureC ?? DEFAULT_SIMULATION_TEMPERATURE_C),
  );
  const rawSaved = setup?.input.kind === "raw" ? setup.input : undefined;
  const [switchFromRaw, setSwitchFromRaw] = useState(false);
  const [pickCandidates, setPickCandidates] = useState<
    readonly SimulationProbeOption[]
  >([]);
  useEffect(() => {
    const defaultProfileId = capabilities?.profiles[0]?.id;
    if (
      !saved?.environment.profileId &&
      defaultProfileId &&
      (!profileId || profileId === DEVELOPMENT_PROFILE_ID)
    )
      setProfileId(defaultProfileId);
  }, [capabilities?.profiles[0]?.id, profileId, saved?.environment.profileId]);
  const advertisedProfiles =
    capabilities?.profiles ??
    (DEVELOPMENT_PROFILE_ID
      ? [
          {
            id: DEVELOPMENT_PROFILE_ID,
            label: DEVELOPMENT_PROFILE_LABEL,
            corners: [...DEVELOPMENT_CORNERS],
          },
        ]
      : []);
  const selectedProfile = advertisedProfiles.find(
    (profile) => profile.id === profileId,
  );
  const defaultCorner = selectedProfile?.corners[0] ?? "";
  useEffect(() => {
    if (!corner && !saved?.environment.corner && defaultCorner)
      setCorner(defaultCorner);
  }, [corner, defaultCorner, saved?.environment.corner]);
  const profileUnavailable = !!profileId && !!capabilities && !selectedProfile;
  const showProfilePicker = advertisedProfiles.length > 1 || profileUnavailable;
  const environmentLabel =
    selectedProfile?.label ??
    (profileUnavailable
      ? `${profileId} (unavailable)`
      : "Loading environment…");
  const environmentTemperature =
    temperatureC.trim() || String(DEFAULT_SIMULATION_TEMPERATURE_C);
  const analysisSummary = [
    dcEnabled ? "DC" : undefined,
    opEnabled ? "OP" : undefined,
    acEnabled ? "AC" : undefined,
    tranEnabled ? "TRAN" : undefined,
    noiseEnabled ? "Noise" : undefined,
  ]
    .filter(Boolean)
    .join(" + ");
  const selectedDcSourceId = dcSources.some(
    (source) => source.id === dcSourceId,
  )
    ? dcSourceId
    : (dcSources[0]?.id ?? "");
  const selectedNoiseSourceId = dcSources.some(
    (source) => source.id === noiseInputSourceId,
  )
    ? noiseInputSourceId
    : (dcSources[0]?.id ?? "");
  const noisePositiveKey = noisePositive
    ? simulationProbeTargetKey({ kind: "voltage", ...noisePositive })
    : "";
  const noiseNegativeKey = noiseNegative
    ? simulationProbeTargetKey({ kind: "voltage", ...noiseNegative })
    : "";
  useEffect(() => {
    if (!pickedNet) return;
    const candidates = matchSimulationVoltageProbeOptions(
      project,
      probeOptions.voltage,
      pickedNet,
    );
    if (candidates.length > 1) {
      setPickCandidates(candidates);
      onProblem(undefined);
      return;
    }
    const option = candidates[0];
    if (!option) {
      onProblem(
        uiProblem(
          "PROBE_TARGET_UNAVAILABLE",
          "That Net is outside this Setup's Testbench. Choose it from the Output list or create a Setup for the intended Testbench.",
        ),
      );
      return;
    }
    const key = simulationProbeSelectionKey(project, option.target);
    if (
      outputs.some(
        (output) =>
          (output.expression.kind === "voltage" ||
            output.expression.kind === "current") &&
          simulationProbeSelectionKey(project, output.expression) === key,
      )
    )
      return;
    setOutputs((current) => [...current, outputFromOption(option, current)]);
    onDirty(true);
    setPickCandidates([]);
    onProblem(undefined);
  }, [pickedNet?.sequence]);
  useEffect(() => {
    if (!pickedTerminal) return;
    const candidates = matchSimulationTerminalCurrentProbeOptions(
      probeOptions.terminalCurrent,
      pickedTerminal,
    );
    const presentedCandidates = candidates.map((candidate) =>
      pickedTerminal.directionPinName
        ? {
            ...candidate,
            label: candidate.label.replace(
              `${pickedTerminal.pinName} current`,
              `${pickedTerminal.pinName}→${pickedTerminal.directionPinName} current`,
            ),
          }
        : candidate,
    );
    if (presentedCandidates.length > 1) {
      setPickCandidates(presentedCandidates);
      onProblem(undefined);
      return;
    }
    const option = presentedCandidates[0];
    if (!option) {
      onProblem(
        uiProblem(
          "PROBE_TARGET_UNAVAILABLE",
          "That terminal is not a connected current target in the selected Testbench occurrence.",
        ),
      );
      return;
    }
    const key = simulationProbeSelectionKey(project, option.target);
    if (
      outputs.some(
        (output) =>
          (output.expression.kind === "voltage" ||
            output.expression.kind === "current") &&
          simulationProbeSelectionKey(project, output.expression) === key,
      )
    ) {
      onProblem(
        uiProblem(
          "PROBE_TARGET_ALREADY_SELECTED",
          "That terminal current is already present in this Setup.",
        ),
      );
      return;
    }
    setOutputs((current) => [...current, outputFromOption(option, current)]);
    onDirty(true);
    setPickCandidates([]);
    onProblem(undefined);
  }, [pickedTerminal?.sequence]);
  useEffect(() => {
    onDirty(false);
  }, []);
  if (rawSaved && !switchFromRaw) {
    return (
      <aside className="simulation-setup-panel" aria-label="Simulation setup">
        <header>
          <div>
            <strong>Raw setup</strong>
          </div>
        </header>
        <div className="simulation-raw-summary">
          <p>
            <strong>{rawSaved.entry}</strong>
          </p>
          <button type="button" onClick={() => setSwitchFromRaw(true)}>
            Switch to structured setup…
          </button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="simulation-setup-panel" aria-label="Simulation setup">
      <header>
        <div>
          <strong>Settings</strong>
        </div>
      </header>
      <form
        onChange={(event) => {
          if (
            (event.target as unknown as { name?: string }).name !== "setupName"
          )
            onDirty(true);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          if (data.has("noise") && !noisePositive) {
            onProblem(
              uiProblem(
                "SIMULATION_NOISE_OUTPUT_REQUIRED",
                "Choose a positive Noise output Net.",
              ),
            );
            return;
          }
          const parsed = SimulationSetupSchema.safeParse({
            version: 3,
            input: {
              kind: "structured",
              rootDocumentId: rootId,
              analyses: [
                ...(data.has("op") ? [{ kind: "op" }] : []),
                ...(data.has("dc")
                  ? [
                      {
                        kind: "dc",
                        sourceInstanceId: data.get("dcSourceInstanceId"),
                        startValue: Number(data.get("dcStartValue")),
                        stopValue: Number(data.get("dcStopValue")),
                        stepValue: Number(data.get("dcStepValue")),
                      },
                    ]
                  : []),
                ...(data.has("ac")
                  ? [
                      {
                        kind: "ac",
                        sweep: data.get("sweep"),
                        points: Number(data.get("points")),
                        startHz: Number(data.get("startHz")),
                        stopHz: Number(data.get("stopHz")),
                      },
                    ]
                  : []),
                ...(data.has("tran")
                  ? [
                      {
                        kind: "tran",
                        stepSeconds: Number(data.get("tranStepSeconds")),
                        stopSeconds: Number(data.get("tranStopSeconds")),
                        ...optionalFormNumber(
                          data,
                          "tranStartSeconds",
                          "startSeconds",
                        ),
                        ...optionalFormNumber(
                          data,
                          "tranMaxStepSeconds",
                          "maxStepSeconds",
                        ),
                      },
                    ]
                  : []),
                ...(data.has("noise") && noisePositive
                  ? [
                      {
                        kind: "noise",
                        output: {
                          positive: noisePositive,
                          ...(noiseNegative ? { negative: noiseNegative } : {}),
                        },
                        inputSourceInstanceId: data.get(
                          "noiseInputSourceInstanceId",
                        ),
                        sweep: data.get("noiseSweep"),
                        points: Number(data.get("noisePoints")),
                        startHz: Number(data.get("noiseStartHz")),
                        stopHz: Number(data.get("noiseStopHz")),
                      },
                    ]
                  : []),
              ],
              outputs,
              ...(deviceOperatingPoints.length
                ? { deviceOperatingPoints }
                : {}),
              ...(measurements.length ? { measurements } : {}),
              designVariables,
              runPlan,
              environment: {
                profileId: data.get("profileId"),
                ...(data.get("corner") ? { corner: data.get("corner") } : {}),
                ...(data.get("temperatureC")
                  ? { temperatureC: Number(data.get("temperatureC")) }
                  : {}),
              },
            },
          });
          if (!parsed.success) {
            onProblem(
              uiProblem(
                "SIMULATION_SETUP_INVALID",
                parsed.error.issues.map((i) => i.message).join("\n"),
              ),
            );
            return;
          }
          const setupName = String(data.get("setupName") ?? "").trim();
          if (!setupName) {
            onProblem(
              uiProblem("SIMULATION_SETUP_INVALID", "Setup name is required"),
            );
            return;
          }
          const setupId =
            setup?.id ??
            draftContext?.setupId ??
            `simulation-setup-${crypto.randomUUID()}`;
          const result = onSaveSetup({
            id: setupId,
            name: setupName,
            ...parsed.data,
          });
          if (result.status !== "rejected") {
            onDirty(false);
            onProblem(undefined);
          } else onProblem(result.problem);
        }}
      >
        <SimulationSettingsSection
          title="Setup"
          summary={`${corner ? corner.toUpperCase() : "—"} · ${environmentTemperature} °C`}
          defaultOpen
        >
          <label>
            Name
            <input
              aria-label="Setup name"
              name="setupName"
              required
              value={setupName}
              onChange={(event) => setSetupName(event.currentTarget.value)}
              onBlur={() => {
                const name = setupName.trim();
                if (!setup || name === setup.name) return;
                if (!name) {
                  setSetupName(setup.name);
                  onProblem(
                    uiProblem(
                      "SIMULATION_SETUP_INVALID",
                      "Setup name is required.",
                    ),
                  );
                  return;
                }
                const result = onSaveSetup({ ...setup, name });
                if (result.status !== "rejected") onProblem(undefined);
                else {
                  setSetupName(setup.name);
                  onProblem(result.problem);
                }
              }}
            />
          </label>
          <div className="simulation-environment-grid">
            {showProfilePicker ? (
              <label className="simulation-environment-profile">
                Profile
                <select
                  name="profileId"
                  required
                  value={profileId}
                  onChange={(event) => {
                    const nextId = event.currentTarget.value;
                    const nextProfile = advertisedProfiles.find(
                      (profile) => profile.id === nextId,
                    );
                    setProfileId(nextId);
                    if (!nextProfile?.corners.includes(corner))
                      setCorner(nextProfile?.corners[0] ?? "");
                  }}
                >
                  {profileUnavailable ? (
                    <option value={profileId}>{profileId} (unavailable)</option>
                  ) : null}
                  {advertisedProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label ?? profile.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="simulation-environment-profile">
                Profile
                <span className="simulation-environment-value">
                  {environmentLabel}
                </span>
                <input name="profileId" type="hidden" value={profileId} />
              </label>
            )}
            <label>
              Corner
              <select
                aria-label="Process corner"
                name="corner"
                value={corner}
                onChange={(event) => setCorner(event.currentTarget.value)}
                disabled={!selectedProfile}
              >
                {!corner ? (
                  <option value="">
                    {selectedProfile ? "Profile default" : "Unavailable"}
                  </option>
                ) : null}
                {corner && !selectedProfile?.corners.includes(corner) ? (
                  <option value={corner}>
                    {corner.toUpperCase()} (unavailable)
                  </option>
                ) : null}
                {selectedProfile?.corners.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Temperature (°C)
              <input
                name="temperatureC"
                type="number"
                step="any"
                value={temperatureC}
                onChange={(event) => setTemperatureC(event.currentTarget.value)}
              />
            </label>
          </div>
        </SimulationSettingsSection>
        <SimulationSettingsSection
          title="Analyses"
          summary={analysisSummary || "None"}
        >
          <fieldset className="simulation-analysis-row">
            <legend className="simulation-visually-hidden">Analyses</legend>
            <div className="simulation-analysis-options">
              <label>
                <input
                  name="dc"
                  type="checkbox"
                  checked={dcEnabled}
                  onChange={(event) =>
                    setDcEnabled(event.currentTarget.checked)
                  }
                />
                DC
              </label>
              <label>
                <input
                  name="op"
                  type="checkbox"
                  checked={opEnabled}
                  disabled={deviceOperatingPoints.length > 0}
                  onChange={(event) =>
                    setOpEnabled(event.currentTarget.checked)
                  }
                />
                OP
              </label>
              <label>
                <input
                  name="ac"
                  type="checkbox"
                  checked={acEnabled}
                  onChange={(event) =>
                    setAcEnabled(event.currentTarget.checked)
                  }
                />
                AC
              </label>
              <label>
                <input
                  name="tran"
                  type="checkbox"
                  checked={tranEnabled}
                  onChange={(event) =>
                    setTranEnabled(event.currentTarget.checked)
                  }
                />
                TRAN
              </label>
              <label>
                <input
                  name="noise"
                  type="checkbox"
                  checked={noiseEnabled}
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    setNoiseEnabled(enabled);
                    if (enabled && !noisePositive) {
                      const first = probeOptions.voltage[0];
                      if (first) setNoisePositive(voltageProbe(first));
                    }
                  }}
                />
                Noise
              </label>
            </div>
          </fieldset>
          {dcEnabled ? (
            <div className="simulation-setup-group simulation-analysis-settings">
              <label>
                DC sweep source
                <select
                  name="dcSourceInstanceId"
                  required
                  value={selectedDcSourceId}
                  onChange={(event) => setDcSourceId(event.currentTarget.value)}
                >
                  {dcSources.length === 0 ? (
                    <option value="">
                      No independent sources in Testbench
                    </option>
                  ) : null}
                  {dcSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="simulation-inline-fields columns-3">
                <label>
                  Start
                  <input
                    name="dcStartValue"
                    type="number"
                    step="any"
                    required
                    defaultValue={dc?.startValue ?? 0}
                  />
                </label>
                <label>
                  Stop
                  <input
                    name="dcStopValue"
                    type="number"
                    step="any"
                    required
                    defaultValue={dc?.stopValue ?? 1.8}
                  />
                </label>
                <label>
                  Step
                  <input
                    name="dcStepValue"
                    type="number"
                    step="any"
                    required
                    defaultValue={dc?.stepValue ?? 0.01}
                  />
                </label>
              </div>
              <small>
                Values use{" "}
                {dcSources.find((source) => source.id === selectedDcSourceId)
                  ?.unit ?? "the source unit"}
                ; step is a positive magnitude.
              </small>
            </div>
          ) : null}
          {acEnabled ? (
            <div className="simulation-setup-group simulation-analysis-settings">
              <label>
                AC sweep
                <select name="sweep" defaultValue={ac?.sweep ?? "dec"}>
                  <option value="dec">Decade</option>
                  <option value="oct">Octave</option>
                  <option value="lin">Linear</option>
                </select>
              </label>
              <div className="simulation-inline-fields columns-3">
                <label>
                  Points
                  <input
                    name="points"
                    type="number"
                    min="1"
                    defaultValue={ac?.points ?? 20}
                  />
                </label>
                <label>
                  Start (Hz)
                  <input
                    name="startHz"
                    type="number"
                    step="any"
                    defaultValue={ac?.startHz ?? 1}
                  />
                </label>
                <label>
                  Stop (Hz)
                  <input
                    name="stopHz"
                    type="number"
                    step="any"
                    defaultValue={ac?.stopHz ?? 1e6}
                  />
                </label>
              </div>
            </div>
          ) : null}
          {tranEnabled ? (
            <div className="simulation-setup-group simulation-inline-fields columns-2">
              <label>
                TRAN step (s)
                <input
                  name="tranStepSeconds"
                  type="number"
                  step="any"
                  defaultValue={tran?.stepSeconds ?? 1e-9}
                />
              </label>
              <label>
                TRAN stop (s)
                <input
                  name="tranStopSeconds"
                  type="number"
                  step="any"
                  defaultValue={tran?.stopSeconds ?? 1e-6}
                />
              </label>
              <label>
                TRAN start saving (s)
                <input
                  name="tranStartSeconds"
                  type="number"
                  step="any"
                  min="0"
                  defaultValue={tran?.startSeconds ?? ""}
                  placeholder="0"
                />
              </label>
              <label>
                TRAN maximum step (s)
                <input
                  name="tranMaxStepSeconds"
                  type="number"
                  step="any"
                  min="0"
                  defaultValue={tran?.maxStepSeconds ?? ""}
                  placeholder="Simulator default"
                />
              </label>
            </div>
          ) : null}
          {noiseEnabled ? (
            <div className="simulation-setup-group simulation-analysis-settings">
              <div className="simulation-inline-fields columns-2">
                <label>
                  Output +
                  <select
                    aria-label="Noise output positive"
                    value={noisePositiveKey}
                    required
                    onChange={(event) => {
                      const option = probeOptions.voltage.find(
                        (candidate) =>
                          simulationProbeTargetKey(candidate.target) ===
                          event.currentTarget.value,
                      );
                      setNoisePositive(
                        option ? voltageProbe(option) : undefined,
                      );
                    }}
                  >
                    <option value="">Choose a Net</option>
                    {probeOptions.voltage.map((option) => (
                      <option
                        key={option.key}
                        value={simulationProbeTargetKey(option.target)}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Output −
                  <select
                    aria-label="Noise output negative"
                    value={noiseNegativeKey}
                    onChange={(event) => {
                      const option = probeOptions.voltage.find(
                        (candidate) =>
                          simulationProbeTargetKey(candidate.target) ===
                          event.currentTarget.value,
                      );
                      setNoiseNegative(
                        option ? voltageProbe(option) : undefined,
                      );
                    }}
                  >
                    <option value="">Ground</option>
                    {probeOptions.voltage.map((option) => (
                      <option
                        key={option.key}
                        value={simulationProbeTargetKey(option.target)}
                        disabled={
                          simulationProbeTargetKey(option.target) ===
                          noisePositiveKey
                        }
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Input source
                <select
                  name="noiseInputSourceInstanceId"
                  required
                  value={selectedNoiseSourceId}
                  onChange={(event) =>
                    setNoiseInputSourceId(event.currentTarget.value)
                  }
                >
                  {dcSources.length === 0 ? (
                    <option value="">
                      No independent sources in Testbench
                    </option>
                  ) : null}
                  {dcSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Noise sweep
                <select name="noiseSweep" defaultValue={noise?.sweep ?? "dec"}>
                  <option value="dec">Decade</option>
                  <option value="oct">Octave</option>
                  <option value="lin">Linear</option>
                </select>
              </label>
              <div className="simulation-inline-fields columns-3">
                <label>
                  Points
                  <input
                    name="noisePoints"
                    type="number"
                    min="1"
                    defaultValue={noise?.points ?? 20}
                  />
                </label>
                <label>
                  Start (Hz)
                  <input
                    name="noiseStartHz"
                    type="number"
                    step="any"
                    defaultValue={noise?.startHz ?? 1}
                  />
                </label>
                <label>
                  Stop (Hz)
                  <input
                    name="noiseStopHz"
                    type="number"
                    step="any"
                    defaultValue={noise?.stopHz ?? 1e6}
                  />
                </label>
              </div>
            </div>
          ) : null}
        </SimulationSettingsSection>
        <SimulationSettingsSection
          title="Design Variables"
          summary={`${designVariables.length} configured`}
        >
          <DesignVariablesEditor
            project={project}
            variables={designVariables}
            onChange={(next) => {
              setDesignVariables(next);
              const ids = new Set(next.map(({ id }) => id));
              if (runPlan.mode === "sweep") {
                const axes = runPlan.axes.filter(
                  (axis) =>
                    axis.kind !== "variable" || ids.has(axis.variableId),
                );
                setRunPlan(
                  axes.length ? { mode: "sweep", axes } : { mode: "nominal" },
                );
              }
              onDirty(true);
            }}
          />
        </SimulationSettingsSection>
        <SimulationSettingsSection
          title="Run Plan"
          summary={
            runPlan.mode === "nominal"
              ? "Nominal"
              : `${simulationRunPlanPointCount(runPlan)} points`
          }
        >
          <RunPlanEditor
            project={project}
            variables={designVariables}
            plan={runPlan}
            capabilities={capabilities}
            profileId={profileId}
            onChange={(next) => {
              setRunPlan(next);
              onDirty(true);
            }}
          />
        </SimulationSettingsSection>
        <SimulationSettingsSection
          title="Output probes"
          summary={`${outputs.filter((output) => output.expression.kind === "voltage" || output.expression.kind === "current").length} selected`}
        >
          <ProbeSelect
            label="Add voltage probe"
            placeholder="Choose a Net"
            options={probeOptions.voltage}
            selectedKeys={selectedProbeKeys}
            onAdd={(option) => {
              setOutputs([...outputs, outputFromOption(option, outputs)]);
              onDirty(true);
            }}
            trailingAction={
              <button
                type="button"
                className={
                  pickNetsActive ? "simulation-pick-active" : undefined
                }
                aria-pressed={pickNetsActive}
                onClick={() => onPickNetsChange?.(!pickNetsActive)}
              >
                {pickNetsActive ? "Picking Nets…" : "Pick on canvas"}
              </button>
            }
          />
          {pickCandidates.length > 1 ? (
            <fieldset
              className="simulation-setup-group"
              aria-label="Choose probe occurrence"
            >
              <legend>Choose occurrence</legend>
              {pickCandidates.map((option) => (
                <button
                  type="button"
                  key={option.key}
                  onClick={() => {
                    setOutputs((current) => [
                      ...current,
                      outputFromOption(option, current),
                    ]);
                    setPickCandidates([]);
                    onDirty(true);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </fieldset>
          ) : null}
          <ProbeSelect
            label="Add current output"
            placeholder="Choose a terminal current"
            options={probeOptions.terminalCurrent}
            selectedKeys={selectedProbeKeys}
            onAdd={(option) => {
              setOutputs([...outputs, outputFromOption(option, outputs)]);
              onDirty(true);
            }}
            trailingAction={
              <button
                type="button"
                className={
                  pickTerminalsActive ? "simulation-pick-active" : undefined
                }
                aria-pressed={pickTerminalsActive}
                onClick={() => onPickTerminalsChange?.(!pickTerminalsActive)}
              >
                {pickTerminalsActive ? "Picking current…" : "Pick current"}
              </button>
            }
          />
          <small>First terminal sets the positive current direction.</small>
        </SimulationSettingsSection>
        <SimulationSettingsSection
          title="Device operating point"
          summary={`${deviceOperatingPoints.length} selected`}
        >
          <div className="simulation-inline-fields columns-2">
            <label>
              MOS occurrence
              <select
                aria-label="MOS operating-point device"
                value={deviceOperatingPointChoice}
                onChange={(event) =>
                  setDeviceOperatingPointChoice(event.currentTarget.value)
                }
              >
                <option value="">Choose a MOS</option>
                {probeOptions.deviceOperatingPoint.map((option) => (
                  <option
                    key={option.key}
                    value={option.key}
                    disabled={deviceOperatingPoints.some(
                      (item) =>
                        simulationDeviceOperatingPointTargetKey(item) ===
                        option.key,
                    )}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!deviceOperatingPointChoice}
              onClick={() => {
                const option = probeOptions.deviceOperatingPoint.find(
                  (candidate) => candidate.key === deviceOperatingPointChoice,
                );
                if (!option) return;
                setDeviceOperatingPoints((current) => [
                  ...current,
                  { id: crypto.randomUUID(), ...option.target },
                ]);
                setDeviceOperatingPointChoice("");
                setOpEnabled(true);
                onDirty(true);
              }}
            >
              Add operating-point details
            </button>
          </div>
          <ul
            className="simulation-probe-list"
            aria-label="Selected MOS operating-point devices"
          >
            {deviceOperatingPoints.map((item) => {
              const key = simulationDeviceOperatingPointTargetKey(item);
              const label =
                probeOptions.deviceOperatingPoint.find(
                  (option) => option.key === key,
                )?.label ?? `${item.instanceId} (unavailable)`;
              return (
                <li key={item.id}>
                  <span>
                    <strong>{label}</strong>
                    <small>VGS · VDS · VBS · ID</small>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove operating-point details for ${label}`}
                    onClick={() => {
                      setDeviceOperatingPoints((current) =>
                        current.filter((candidate) => candidate.id !== item.id),
                      );
                      onDirty(true);
                    }}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          {deviceOperatingPoints.length ? (
            <small>OP remains enabled while device details are selected.</small>
          ) : null}
        </SimulationSettingsSection>
        <SimulationSettingsSection
          title="Output signals"
          summary={`${outputs.length} configured`}
        >
          <fieldset className="simulation-expression-editor">
            <legend>Derived expression</legend>
            <div className="simulation-inline-fields columns-2">
              <label>
                Name
                <input
                  value={expressionLabel}
                  placeholder="Gain"
                  onChange={(event) =>
                    setExpressionLabel(event.currentTarget.value)
                  }
                />
              </label>
              <label>
                Expression
                <input
                  value={expressionText}
                  placeholder="db20(Vout / Vin)"
                  onChange={(event) =>
                    setExpressionText(event.currentTarget.value)
                  }
                />
              </label>
            </div>
            <small>
              Use output names with +, −, ×, ÷, mag, db20, phase, real, imag, or
              abs.
            </small>
            <button
              type="button"
              onClick={() => {
                const label = expressionLabel.trim();
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(label)) {
                  onProblem(
                    uiProblem(
                      "SIMULATION_OUTPUT_NAME_INVALID",
                      "Expression names use letters, numbers, and underscores, beginning with a letter or underscore.",
                    ),
                  );
                  return;
                }
                if (
                  outputs.some(
                    (output) =>
                      output.id !== editingOutputId &&
                      output.label.toLowerCase() === label.toLowerCase(),
                  )
                ) {
                  onProblem(
                    uiProblem(
                      "SIMULATION_OUTPUT_NAME_DUPLICATE",
                      `An output named ${label} already exists.`,
                    ),
                  );
                  return;
                }
                const symbols = new Map(
                  outputs
                    .filter(
                      (output) =>
                        output.id !== editingOutputId &&
                        /^[A-Za-z_][A-Za-z0-9_]*$/u.test(output.label),
                    )
                    .map(
                      (output) => [output.label, output.expression] as const,
                    ),
                );
                const parsed = parseSimulationExpression(
                  expressionText,
                  symbols,
                );
                if (!parsed.ok) {
                  onProblem(
                    uiProblem(
                      `SIMULATION_EXPRESSION_${parsed.code}`,
                      `${parsed.message} at character ${parsed.offset + 1}.`,
                    ),
                  );
                  return;
                }
                setOutputs((current) => {
                  const next = {
                    id: editingOutputId ?? crypto.randomUUID(),
                    label,
                    expression: parsed.expression,
                  };
                  return editingOutputId
                    ? current.map((output) =>
                        output.id === editingOutputId ? next : output,
                      )
                    : [...current, next];
                });
                setExpressionLabel("");
                setExpressionText("");
                setEditingOutputId(undefined);
                onDirty(true);
                onProblem(undefined);
              }}
            >
              {editingOutputId ? "Save expression" : "Add expression"}
            </button>
          </fieldset>
          <ul className="simulation-probe-list" aria-label="Configured Outputs">
            {outputs.map((output) => (
              <li key={output.id}>
                <span>
                  <input
                    aria-label={`Output name for ${output.label}`}
                    value={output.label}
                    onChange={(event) => {
                      event.stopPropagation();
                      const label = event.currentTarget.value;
                      setOutputs((current) =>
                        current.map((candidate) =>
                          candidate.id === output.id
                            ? { ...candidate, label }
                            : candidate,
                        ),
                      );
                      onDirty(true);
                    }}
                  />
                  <small>
                    {describeOutputExpression(output, probeLabels, outputs)}
                  </small>
                </span>
                {output.expression.kind !== "voltage" &&
                output.expression.kind !== "current" &&
                formatOutputExpression(output.expression, outputs) ? (
                  <button
                    type="button"
                    aria-label={`Edit expression ${output.label}`}
                    onClick={() => {
                      setEditingOutputId(output.id);
                      setExpressionLabel(output.label);
                      setExpressionText(
                        formatOutputExpression(output.expression, outputs)!,
                      );
                    }}
                  >
                    Edit
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Remove output"
                  onClick={() => {
                    setOutputs(
                      outputs.filter((value) => value.id !== output.id),
                    );
                    setMeasurements((current) =>
                      current.filter(
                        (measurement) => measurement.outputId !== output.id,
                      ),
                    );
                    if (editingOutputId === output.id) {
                      setEditingOutputId(undefined);
                      setExpressionLabel("");
                      setExpressionText("");
                    }
                    onDirty(true);
                  }}
                >
                  Remove output
                </button>
              </li>
            ))}
          </ul>
        </SimulationSettingsSection>
        <SimulationSettingsSection
          title="Measurements"
          summary={`${measurements.length} saved`}
        >
          <SimulationMeasurementEditor
            analyses={[
              ...(opEnabled ? (["op"] as const) : []),
              ...(dcEnabled ? (["dc"] as const) : []),
              ...(acEnabled ? (["ac"] as const) : []),
              ...(tranEnabled ? (["tran"] as const) : []),
              ...(noiseEnabled ? (["noise"] as const) : []),
            ]}
            outputs={[
              ...outputs,
              ...(noiseEnabled
                ? [
                    {
                      id: SIMULATION_NOISE_OUTPUT_DENSITY_ID,
                      label: "Output noise density",
                    },
                    {
                      id: SIMULATION_NOISE_INPUT_DENSITY_ID,
                      label: "Input-referred noise density",
                    },
                  ]
                : []),
            ]}
            measurements={measurements}
            onChange={(next) => {
              setMeasurements(next);
              onDirty(true);
            }}
          />
        </SimulationSettingsSection>
        <div className="simulation-settings-actions">
          <button type="submit">Apply setup</button>
        </div>
      </form>
    </aside>
  );
}

function voltageProbe(
  option: SimulationProbeOption<
    Extract<SimulationExpression, { kind: "voltage" }>
  >,
): SimulationVoltageProbe {
  const { kind: _kind, ...probe } = option.target;
  return structuredClone(probe);
}

function optionalFormNumber(
  data: FormData,
  formName: "tranStartSeconds" | "tranMaxStepSeconds",
  outputName: "startSeconds" | "maxStepSeconds",
): Partial<Record<typeof outputName, number>> {
  const value = String(data.get(formName) ?? "").trim();
  return value ? { [outputName]: Number(value) } : {};
}

function outputFromOption(
  option: SimulationProbeOption,
  existing: readonly SimulationOutputSpec[],
): SimulationStructuredInput["outputs"][number] {
  const source = option.label.split(" · ").at(-1) ?? "Output";
  const stem = source.replace(/[^A-Za-z0-9_]/gu, "_");
  const base = /^[A-Za-z_]/u.test(stem) ? stem : `Output_${stem}`;
  const used = new Set(existing.map((output) => output.label.toLowerCase()));
  let label = base;
  for (let suffix = 2; used.has(label.toLowerCase()); suffix++)
    label = `${base}_${suffix}`;
  return {
    id: crypto.randomUUID(),
    label,
    expression: structuredClone(option.target),
  };
}

function describeOutputExpression(
  output: SimulationOutputSpec,
  labels: ReadonlyMap<string, string>,
  outputs: readonly SimulationOutputSpec[],
): string {
  const expression = output.expression;
  if (expression.kind === "voltage" || expression.kind === "current")
    return (
      labels.get(simulationProbeTargetKey(expression)) ??
      (expression.kind === "voltage"
        ? "Voltage target unavailable"
        : "Current target unavailable")
    );
  return formatOutputExpression(expression, outputs) ?? "Derived expression";
}

function formatOutputExpression(
  expression: SimulationExpression,
  outputs: readonly SimulationOutputSpec[],
): string | null {
  if (expression.kind === "voltage" || expression.kind === "current") {
    const key = simulationProbeTargetKey(expression);
    return (
      outputs.find(
        (output) =>
          (output.expression.kind === "voltage" ||
            output.expression.kind === "current") &&
          simulationProbeTargetKey(output.expression) === key &&
          /^[A-Za-z_][A-Za-z0-9_]*$/u.test(output.label),
      )?.label ?? null
    );
  }
  if (expression.kind === "constant") return String(expression.value);
  if ("operand" in expression) {
    const operand = formatOutputExpression(expression.operand, outputs);
    if (!operand) return null;
    if (expression.kind === "negate") return `-(${operand})`;
    const functions = {
      magnitude: "mag",
      db20: "db20",
      phase: "phase",
      real: "real",
      imaginary: "imag",
      absolute: "abs",
    } as const;
    return `${functions[expression.kind]}(${operand})`;
  }
  const left = formatOutputExpression(expression.left, outputs);
  const right = formatOutputExpression(expression.right, outputs);
  if (!left || !right) return null;
  const operators = {
    add: "+",
    subtract: "-",
    multiply: "*",
    divide: "/",
  } as const;
  return `(${left} ${operators[expression.kind]} ${right})`;
}

function ProbeSelect({
  label,
  placeholder,
  options,
  selectedKeys,
  onAdd,
  trailingAction,
}: {
  label: string;
  placeholder: string;
  options: readonly SimulationProbeOption[];
  selectedKeys: ReadonlySet<string>;
  onAdd(option: SimulationProbeOption): void;
  trailingAction?: ReactNode;
}) {
  const selectId = useId();
  return (
    <div className="simulation-probe-select">
      <label htmlFor={selectId}>{label}</label>
      <span className="simulation-probe-control">
        <select
          id={selectId}
          value=""
          onChange={(event) => {
            const option = options.find(
              (candidate) => candidate.key === event.target.value,
            );
            if (option) onAdd(option);
          }}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option
              key={option.key}
              value={option.key}
              disabled={selectedKeys.has(option.key)}
            >
              {option.label}
            </option>
          ))}
        </select>
        {trailingAction}
      </span>
    </div>
  );
}
