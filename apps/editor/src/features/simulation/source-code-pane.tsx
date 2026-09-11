import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  readSimulationExperimentConfig,
  type CircuitProject,
  type ProjectSimulationSetup,
} from "@icm/model";
import type { SpiceSimulationSurfaceProps } from "./simulation-surface-types";
import {
  deriveSimulationProbeOptions,
  matchSimulationVoltageProbeOptions,
  matchSimulationTerminalCurrentProbeOptions,
  type SimulationProbeOption,
} from "./simulation-probe-options";
import { generateCircuitSource, planCircuitSourceEdit } from "@icm/netlist";
import type { SimulationFiles } from "@icm/simulation-service/files";
import { sha256 } from "@icm/simulation-service/files";
import type {
  Problem,
  SimulationSourceLocation,
} from "@icm/simulation-service/contract";
import SimulationCodeEditor from "./code-editor";
import { downloadTextArtifact } from "../../document/project-file-service";
import { WORKING_COPY_STORAGE_KEY } from "../../document/recovery-coordinator";
import { sourceDraftCache } from "./source-draft-cache";
import { SimulationCodeWorkspace } from "./code-workspace";

export type SourceFlush =
  { ok: true; setup: ProjectSimulationSetup; revision: number } | { ok: false };
export interface SourceCodeHandle {
  flush(): Promise<SourceFlush>;
  discard(): void;
  reveal(location: SimulationSourceLocation): Promise<void>;
}
interface Props extends Pick<
  SpiceSimulationSurfaceProps,
  | "pickedNet"
  | "pickedTerminal"
  | "pickNetsActive"
  | "pickTerminalsActive"
  | "onPickNetsChange"
  | "onPickTerminalsChange"
> {
  project: CircuitProject;
  selectedCircuitObject?:
    { documentId: string; instanceId: string } | undefined;
  setup: ProjectSimulationSetup;
  files: SimulationFiles;
  actions: ReactNode;
  console: ReactNode;
  results: ReactNode;
  status?: ReactNode;
  outputPane: "console" | "results";
  onSelectOutputPane(pane: "console" | "results"): void;
  maximized: boolean;
  onToggleMaximize(): void;
  onDirty(dirty: boolean): void;
  onProblem(problem: Problem | undefined): void;
  diagnostics?: Problem["diagnostics"];
  onRun(): void;
  onSaveProject?: (() => void) | undefined;
  onHistoryBoundary(direction: "undo" | "redo"): void;
}
const inputProblem = (code: string, message: string): Problem => ({
  code,
  message,
  stage: "input",
  recovery: "fix-input",
});

/** Local dirty buffers only; Project files, circuit parameters and runs keep their existing owners. */
export const SourceCodePane = forwardRef<SourceCodeHandle, Props>(
  function SourceCodePane(props, ref) {
    const current = useRef(props);
    current.current = props;
    let storage: Storage | undefined;
    let workingCopyId = "";
    try {
      storage = window.sessionStorage;
      workingCopyId = storage.getItem(WORKING_COPY_STORAGE_KEY) ?? "";
    } catch {
      /* Editing remains available without storage. */
    }
    const cache = useMemo(
      () => sourceDraftCache(storage, workingCopyId, props.project.id),
      [storage, workingCopyId, props.project.id],
    );
    const drafts = useMemo(() => ({ current: cache.read() }), [cache]);
    const [draftRevision, render] = useState(0);
    const [recoveryAvailable, setRecoveryAvailable] = useState(true);
    useEffect(() => {
      setRecoveryAvailable(cache.write(drafts.current));
    }, [cache, draftRevision]);
    const [path, setPath] = useState(props.setup.input.entry);
    const [saving, setSaving] = useState(false);
    const [reveal, setReveal] = useState<{
      sourceOffset: number;
      requestId: string;
      focus?: boolean;
    }>();
    const [sourceDigest, setSourceDigest] = useState("");
    const savingRef = useRef(false);
    const picked = useRef({
      net: props.pickedNet?.sequence,
      terminal: props.pickedTerminal?.sequence,
    });
    const input = props.setup.input;
    const binding = input.circuitBindings.find(
      (b) => b.emission === "top-level",
    );
    const options = useMemo(
      () =>
        binding
          ? deriveSimulationProbeOptions(props.project, binding.documentId)
          : undefined,
      [props.project, binding],
    );
    const addPicked = (matches: readonly SimulationProbeOption[]) => {
      if (!binding) return;
      if (matches.length !== 1) {
        props.onProblem(
          inputProblem(
            "SIMULATION_PICK_OCCURRENCE_REQUIRED",
            "Open the desired Cell occurrence from its Testbench before picking; no output was guessed.",
          ),
        );
        return;
      }
      const file = props.setup.input.files.find(
          (f) => f.path === input.configPath,
        ),
        draft = drafts.current.get(
          `${props.setup.id}\u0000${input.configPath}`,
        );
      const parsed = readSimulationExperimentConfig({
        ...props.setup,
        input: {
          ...input,
          files: [
            ...input.files.filter((f) => f.path !== input.configPath),
            { path: input.configPath, text: draft?.text ?? file?.text ?? "" },
          ],
        },
      });
      if (!parsed.ok) {
        props.onProblem(
          inputProblem(
            "SIMULATION_CONFIG_INVALID",
            `${parsed.path}: ${parsed.message}`,
          ),
        );
        setPath(input.configPath);
        return;
      }
      const match = matches[0]!,
        expression = {
          ...match.target,
          circuit: { bindingId: binding.id, callPath: [] },
        };
      if (
        parsed.config.outputs.some(
          (o) => JSON.stringify(o.expression) === JSON.stringify(expression),
        )
      )
        return;
      parsed.config.outputs.push({
        id: `output-${crypto.randomUUID()}`,
        label: match.label,
        expression,
      });
      drafts.current.set(`${props.setup.id}\u0000${input.configPath}`, {
        base: draft?.base ?? file?.text ?? "",
        text: JSON.stringify(parsed.config, null, 2) + "\n",
        committed: draft?.committed ?? props.project.structureRevision,
      });
      render((v) => v + 1);
    };
    useEffect(() => {
      if (!props.pickedNet || props.pickedNet.sequence === picked.current.net)
        return;
      picked.current.net = props.pickedNet.sequence;
      if (props.pickNetsActive && options)
        addPicked(
          matchSimulationVoltageProbeOptions(
            props.project,
            options.voltage,
            props.pickedNet,
          ),
        );
    }, [props.pickedNet]);
    useEffect(() => {
      if (
        !props.pickedTerminal ||
        props.pickedTerminal.sequence === picked.current.terminal
      )
        return;
      picked.current.terminal = props.pickedTerminal.sequence;
      if (props.pickTerminalsActive && options)
        addPicked(
          matchSimulationTerminalCurrentProbeOptions(
            options.terminalCurrent,
            props.pickedTerminal,
          ),
        );
    }, [props.pickedTerminal]);
    const generated = useMemo(
      () =>
        input.circuitBindings.map((binding) => ({
          binding,
          result: generateCircuitSource(props.project, binding),
        })),
      [props.project, input.circuitBindings],
    );
    useEffect(() => {
      const selected = props.selectedCircuitObject;
      if (!selected) return;
      for (const { binding, result } of generated) {
        if (!result.ok) continue;
        const instance = result.source.instances.find(
          (card) =>
            card.documentId === selected.documentId &&
            card.instanceId === selected.instanceId,
        );
        if (!instance) continue;
        const draft = drafts.current.get(
          `${props.setup.id}\u0000${binding.path}`,
        );
        // Offsets describe the exact generated snapshot, never a changed numeric draft.
        if (draft && draft.text !== result.source.text) return;
        setPath(binding.path);
        setReveal({
          sourceOffset: instance.startOffset,
          requestId: crypto.randomUUID(),
          focus: false,
        });
        return;
      }
    }, [
      props.selectedCircuitObject?.documentId,
      props.selectedCircuitObject?.instanceId,
    ]);
    const sourceFiles = [
      ...input.files,
      ...generated.map(({ binding, result }) => ({
        path: binding.path,
        text: result.ok
          ? result.source.text
          : result.diagnostics
              .map((d) => `* ${d.code}: ${d.message}`)
              .join("\n"),
      })),
    ];
    const latestSources = useRef({
      setupId: props.setup.id,
      files: sourceFiles,
      drafts,
    });
    latestSources.current = {
      setupId: props.setup.id,
      files: sourceFiles,
      drafts,
    };
    const key = (filePath: string) => `${props.setup.id}\u0000${filePath}`;
    const selected = sourceFiles.find((file) => file.path === path);
    const originalGenerated = generated.find(
      (item) => item.binding.path === path,
    )?.result;
    const buffer = drafts.current.get(key(path));
    const conflict = buffer && buffer.base !== selected?.text;
    const text = buffer?.text ?? selected?.text ?? "";
    useEffect(() => {
      let current = true;
      setSourceDigest("");
      void sha256(text).then((digest) => {
        if (current) setSourceDigest(digest);
      });
      return () => {
        current = false;
      };
    }, [text]);
    const dirty = [...drafts.current].some(
      ([key, value]) =>
        key.startsWith(`${props.setup.id}\u0000`) && value.text !== value.base,
    );
    useEffect(() => props.onDirty(dirty), [dirty, props.setup.id]);
    useEffect(() => {
      setPath(input.entry);
    }, [props.setup.id]);
    useEffect(() => {
      // Clean buffers follow remote edits. A dirty buffer remains visible for explicit repair.
      for (const file of sourceFiles) {
        const stored = drafts.current.get(key(file.path));
        if (stored && stored.text === stored.base && stored.base !== file.text)
          drafts.current.delete(key(file.path));
      }
    }, [props.project]);
    const flush = async (): Promise<SourceFlush> => {
      if (savingRef.current) return { ok: false };
      savingRef.current = true;
      setSaving(true);
      try {
        let revision = current.current.project.structureRevision;
        let setup = current.current.setup;
        const pending = [...drafts.current].filter(
          ([key, value]) =>
            key.startsWith(`${setup.id}\u0000`) && value.text !== value.base,
        );
        const authored: Array<{ path: string; text: string }> = [];
        const circuitEdits: Array<{
          path: string;
          textDigest: string;
          text: string;
        }> = [];
        for (const [draftKey, draft] of pending) {
          const filePath = draftKey.slice(setup.id.length + 1);
          if (draft.binding) {
            const regenerated = generateCircuitSource(
              current.current.project,
              draft.binding,
            );
            if (!regenerated.ok || regenerated.source.text !== draft.base) {
              props.onProblem(
                inputProblem(
                  "SOURCE_DRAFT_CONFLICT",
                  `${filePath} changed on Canvas. Your draft is retained; copy it or discard it before editing the current Circuit.`,
                ),
              );
              return { ok: false };
            }
            const planned = planCircuitSourceEdit(
              regenerated.source,
              draft.text,
            );
            if (!planned.ok) {
              props.onProblem(inputProblem(planned.code, planned.message));
              return { ok: false };
            }
            circuitEdits.push({
              path: filePath,
              textDigest: await sha256(draft.base),
              text: draft.text,
            });
          } else {
            const existing =
              setup.input.files.find((file) => file.path === filePath)?.text ??
              "";
            if (existing !== draft.base) {
              props.onProblem(
                inputProblem(
                  "SOURCE_DRAFT_CONFLICT",
                  `${filePath} was edited elsewhere. Your draft is retained; copy it or discard it to load the current file.`,
                ),
              );
              return { ok: false };
            }
            authored.push({ path: filePath, text: draft.text });
          }
        }
        // One File Resource transaction applies authored files and mapped Canvas parameters atomically.
        if (authored.length || circuitEdits.length) {
          const result = await props.files.handle({
            action: "update",
            owner: { kind: "project-setup", setupId: setup.id },
            expectedRevision: revision,
            writes: authored,
            circuitEdits,
          });
          if (!result.ok) {
            props.onProblem(result.error);
            return { ok: false };
          }
          if (!("source" in result)) return { ok: false };
          revision = result.source.revision;
          const replacements = new Map(
            authored.map((file) => [file.path, file.text]),
          );
          setup = {
            ...setup,
            input: {
              ...setup.input,
              files: [
                ...setup.input.files.filter(
                  (file) => !replacements.has(file.path),
                ),
                ...authored,
              ],
            },
          };
        }
        for (const [draftKey, draft] of pending) {
          const latest = drafts.current.get(draftKey);
          if (latest === draft) drafts.current.delete(draftKey);
          else if (latest)
            drafts.current.set(draftKey, {
              ...latest,
              base: draft.text,
              committed: revision,
            });
        }
        props.onProblem(undefined);
        render((value) => value + 1);
        return { ok: true, setup, revision };
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    };
    useImperativeHandle(ref, () => ({
      flush,
      reveal: async (location) => {
        const setupId = props.setup.id;
        const captured =
          drafts.current.get(key(location.path))?.text ??
          sourceFiles.find((file) => file.path === location.path)?.text;
        if (
          captured === undefined ||
          (await sha256(captured)) !== location.textDigest ||
          latestSources.current.setupId !== setupId ||
          (latestSources.current.drafts.current.get(
            `${setupId}\u0000${location.path}`,
          )?.text ??
            latestSources.current.files.find(
              (file) => file.path === location.path,
            )?.text) !== captured
        ) {
          props.onProblem(
            inputProblem(
              "SOURCE_LOCATION_STALE",
              "This diagnostic belongs to older source. Prepare again to locate the current text.",
            ),
          );
          return;
        }
        setPath(location.path);
        setReveal({
          sourceOffset: location.startOffset,
          requestId: crypto.randomUUID(),
        });
      },
      discard: () => {
        drafts.current.clear();
        cache.write(drafts.current);
        render((value) => value + 1);
      },
    }));
    const change = (next: string) => {
      const existing = drafts.current.get(key(path));
      drafts.current.set(key(path), {
        base: existing?.base ?? selected?.text ?? "",
        text: next,
        committed: existing?.committed ?? props.project.structureRevision,
        ...(existing?.binding
          ? { binding: existing.binding }
          : originalGenerated?.ok
            ? { binding: originalGenerated.source.binding }
            : {}),
      });
      render((value) => value + 1);
    };
    const ownFiles = [
      ...new Set([
        ...sourceFiles.map((file) => file.path),
        ...[...drafts.current.keys()]
          .filter((id) => id.startsWith(`${props.setup.id}\u0000`))
          .map((id) => id.slice(props.setup.id.length + 1)),
      ]),
    ];
    return (
      <SimulationCodeWorkspace
        workspaceKey={props.setup.id}
        files={ownFiles.map((filePath) => ({
          path: filePath,
          kind: input.circuitBindings.some((b) => b.path === filePath)
            ? "generated"
            : "authored",
          dirty:
            !!drafts.current.get(key(filePath)) &&
            drafts.current.get(key(filePath))!.text !==
              drafts.current.get(key(filePath))!.base,
        }))}
        activePath={path}
        onSelectFile={setPath}
        entryPath={input.entry}
        configPath={input.configPath}
        onCopyFile={() => {
          void navigator.clipboard
            .writeText(text)
            .catch(() =>
              props.onProblem(
                inputProblem(
                  "SOURCE_COPY_FAILED",
                  "Clipboard access is unavailable. Select the code to copy, or export the current file.",
                ),
              ),
            );
        }}
        onExportFile={() => {
          const result = downloadTextArtifact(text, path.split("/").at(-1)!);
          if (result.status === "failed")
            props.onProblem(
              inputProblem("SOURCE_EXPORT_FAILED", result.message),
            );
        }}
        onNewFile={() => {
          const path = window.prompt("Relative file path", "stimulus.cir");
          if (!path) return;
          if (ownFiles.includes(path)) {
            setPath(path);
            return;
          }
          drafts.current.set(key(path), {
            base: "",
            text: "* New source\n",
            committed: props.project.structureRevision,
          });
          setPath(path);
          render((value) => value + 1);
        }}
        actions={
          <>
            <button
              disabled={saving}
              onClick={() =>
                props.onSaveProject ? props.onSaveProject() : void flush()
              }
            >
              Save
            </button>
            {props.actions}
            {binding ? (
              <>
                <button
                  aria-pressed={props.pickNetsActive ?? false}
                  onClick={() =>
                    props.onPickNetsChange?.(!props.pickNetsActive)
                  }
                >
                  {props.pickNetsActive ? "Picking Nets…" : "Pick Net"}
                </button>
                <button
                  aria-pressed={props.pickTerminalsActive ?? false}
                  onClick={() =>
                    props.onPickTerminalsChange?.(!props.pickTerminalsActive)
                  }
                >
                  {props.pickTerminalsActive
                    ? "Picking current…"
                    : "Pick current"}
                </button>
              </>
            ) : null}
          </>
        }
        console={props.console}
        results={props.results}
        outputPane={props.outputPane}
        onSelectOutputPane={props.onSelectOutputPane}
        maximized={props.maximized}
        onToggleMaximize={props.onToggleMaximize}
        status={
          <>
            {!recoveryAvailable ? (
              <span role="alert">
                Draft recovery unavailable — save or export before leaving.
              </span>
            ) : null}
            {conflict ? (
              <>
                <span role="alert">Changed elsewhere — draft retained.</span>
                <button
                  onClick={() => {
                    drafts.current.delete(key(path));
                    render((value) => value + 1);
                  }}
                >
                  Discard local draft
                </button>
              </>
            ) : dirty ? (
              "Unsaved source"
            ) : (
              props.status
            )}
          </>
        }
      >
        <SimulationCodeEditor
          path={path}
          text={text}
          historyKey={`${props.setup.id}:${buffer?.committed ?? props.project.structureRevision}`}
          mode={path.endsWith(".json") ? "json" : "spice"}
          entry={path === input.entry}
          reveal={reveal}
          diagnostics={props.diagnostics
            ?.filter(
              (diagnostic) =>
                diagnostic.source?.path === path &&
                diagnostic.source.textDigest === sourceDigest,
            )
            .map((diagnostic) => ({
              code: diagnostic.code,
              message: diagnostic.message,
              severity: diagnostic.severity,
              path: diagnostic.source!.path,
              sourceRef: diagnostic.sourceRef ?? {
                fileId: path,
                start: {
                  offset: diagnostic.source!.startOffset,
                  line: diagnostic.source!.line,
                  column: diagnostic.source!.column,
                },
                end: {
                  offset: diagnostic.source!.endOffset,
                  line: diagnostic.source!.line,
                  column: diagnostic.source!.column,
                },
              },
            }))}
          readOnly={originalGenerated?.ok === false}
          acceptChange={(next) => {
            const source = originalGenerated?.ok
              ? originalGenerated.source
              : undefined;
            if (!source) return true;
            if (conflict) return false;
            const plan = planCircuitSourceEdit(source, next);
            return plan.ok || plan.code === "SIMULATION_PARAMETER_INVALID";
          }}
          onRejectedChange={() =>
            props.onProblem(
              inputProblem(
                "SIMULATION_CIRCUIT_STRUCTURE_LOCKED",
                "Circuit topology is Canvas-owned; only mapped numeric parameter values are editable here.",
              ),
            )
          }
          onChange={change}
          onSave={() =>
            props.onSaveProject ? props.onSaveProject() : void flush()
          }
          onRun={props.onRun}
          onHistoryBoundary={props.onHistoryBoundary}
        />
      </SimulationCodeWorkspace>
    );
  },
);
