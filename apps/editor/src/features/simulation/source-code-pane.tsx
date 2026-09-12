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
  type ProjectSimulationFolder,
  type SimulationSourceExpression,
} from "@icm/model";
import type { SpiceSimulationSurfaceProps } from "./simulation-surface-types";
import {
  deriveSimulationProbeOptions,
  matchSimulationVoltageProbeOptions,
  matchSimulationTerminalCurrentProbeOptions,
  type SimulationProbeOption,
} from "./simulation-probe-options";
import {
  generateCircuitSource,
  planCircuitSourceEdit,
  compileSourceSimulation,
  simulationSignals,
} from "@icm/netlist";
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
import { useWorkspaceInteractions } from "./workspace-interactions";
import {
  SimulationCodeWorkspace,
  type SimulationCodeWorkspaceProps,
  type SimulationExplorerSelection,
} from "./code-workspace";
import {
  buildSimulationWorkspaceArchive,
  simulationArtifactCategory,
  simulationExplorerArtifactCategory,
} from "./simulation-artifact-files";
import { sourceProbeChoices } from "./source-probe-choices";
import { SourceProbePicker } from "./source-probe-picker";
import { SimulationActionIcon } from "./simulation-action-icon";

export type SourceFlush =
  | { ok: true; folder: ProjectSimulationFolder; revision: number }
  | { ok: false };
export interface SourceCodeHandle {
  flush(): Promise<SourceFlush>;
  save(): Promise<boolean>;
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
  | "onPreviewSignal"
> {
  project: CircuitProject;
  selectedCircuitObject?:
    { documentId: string; instanceId: string } | undefined;
  folder: ProjectSimulationFolder;
  files: SimulationFiles;
  actions: ReactNode;
  toolbarEnd?: ReactNode;
  folders?: SimulationCodeWorkspaceProps["folders"];
  additionalActions?: SimulationCodeWorkspaceProps["additionalActions"];
  console: ReactNode;
  results: ReactNode;
  outputActions?: ReactNode;
  artifactGroups?: SimulationCodeWorkspaceProps["artifactGroups"];
  artifactPreview?: SimulationCodeWorkspaceProps["artifactPreview"];
  artifactBusy?: string | undefined;
  onSelectArtifact?: SimulationCodeWorkspaceProps["onSelectArtifact"];
  onCloseArtifact?: SimulationCodeWorkspaceProps["onCloseArtifact"];
  onDownloadArtifact?: SimulationCodeWorkspaceProps["onDownloadArtifact"];
  status?: ReactNode;
  outputPane: SimulationCodeWorkspaceProps["outputPane"];
  onSelectOutputPane: SimulationCodeWorkspaceProps["onSelectOutputPane"];
  maximized: boolean;
  onToggleMaximize(): void;
  onDirty(dirty: boolean): void;
  onActiveDirty(dirty: boolean): void;
  onProblem(problem: Problem | undefined): void;
  diagnostics?: Problem["diagnostics"];
  onRun(): void;
  onSaveProject?: (() => void | Promise<unknown>) | undefined;
  projectSaveState?: SpiceSimulationSurfaceProps["projectSaveState"];
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
    const ui = useWorkspaceInteractions();
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
    const drafts = useMemo(() => {
      const buffers = cache.read();
      for (const folder of props.project.simulationFolders)
        for (const draft of folder.input.drafts ?? []) {
          const key = `${folder.id}\u0000${draft.path}`;
          if (!buffers.has(key))
            buffers.set(key, {
              base: draft.base,
              text: draft.text,
              committed: props.project.structureRevision,
              ...(draft.binding ? { binding: draft.binding } : {}),
            });
        }
      return { current: buffers };
    }, [cache]);
    const [draftRevision, render] = useState(0);
    const [recoveryAvailable, setRecoveryAvailable] = useState(true);
    useEffect(() => {
      setRecoveryAvailable(cache.write(drafts.current));
    }, [cache, draftRevision]);
    const [paths, setPaths] = useState<Record<string, string>>({});
    const path = paths[props.folder.id] ?? props.folder.input.entry;
    const setPath = (value: string, folderId = props.folder.id) => {
      setPaths((current) => ({ ...current, [folderId]: value }));
      if (folderId !== props.folder.id) props.folders?.onSelect(folderId);
    };
    const [saving, setSaving] = useState(false);
    const [saveRequested, setSaveRequested] = useState(false);
    const projectSaveRequest = useRef(false);
    const [reveal, setReveal] = useState<{
      sourceOffset: number;
      requestId: string;
      focus?: boolean;
    }>();
    const [sourceDigest, setSourceDigest] = useState("");
    const [saveRequest, setSaveRequest] = useState<{
      id: string;
      session: string;
      vectors: string[];
    }>();
    const saveSession = useRef(crypto.randomUUID());
    const beginSignalSelection = () => {
      saveSession.current = crypto.randomUUID();
      if (props.pickNetsActive) props.onPickNetsChange?.(false);
      if (props.pickTerminalsActive) props.onPickTerminalsChange?.(false);
      setProbePicker(undefined);
    };
    const savingRef = useRef(false);
    const picked = useRef({
      net: props.pickedNet?.sequence,
      terminal: props.pickedTerminal?.sequence,
    });
    const input = props.folder.input;
    const signals = useMemo(
      () =>
        simulationSignals(props.project, {
          ...input,
          files: input.files.map((file) => ({
            ...file,
            text:
              drafts.current.get(`${props.folder.id}\u0000${file.path}`)
                ?.text ?? file.text,
          })),
        }),
      [props.project, input, draftRevision],
    );
    const [probePicker, setProbePicker] = useState<"voltage" | "current">();
    const probeChoices = useMemo(
      () =>
        probePicker
          ? sourceProbeChoices(props.project, {
              ...input,
              files: input.files.map((file) => ({
                ...file,
                text:
                  drafts.current.get(`${props.folder.id}\u0000${file.path}`)
                    ?.text ?? file.text,
              })),
            })
          : [],
      [props.project, input, draftRevision, probePicker],
    );
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
    const saveSignal = (
      label: string,
      expression: SimulationSourceExpression,
    ): boolean => {
      const insert = (vectors: string[]) => {
        if (
          input.circuitBindings.some((b) => b.path === path) ||
          path.endsWith(".json")
        )
          setPath(input.entry);
        setSaveRequest({
          id: crypto.randomUUID(),
          session: saveSession.current,
          vectors,
        });
      };
      if (expression.kind === "vector") {
        if (/[\r\n;]/u.test(expression.vector)) {
          props.onProblem(
            inputProblem(
              "SIMULATION_VECTOR_INVALID",
              "Enter a vector, not a command.",
            ),
          );
          return false;
        }
        insert([expression.vector]);
        return true;
      }
      const file = props.folder.input.files.find(
          (f) => f.path === input.configPath,
        ),
        draft = drafts.current.get(
          `${props.folder.id}\u0000${input.configPath}`,
        );
      const parsed = readSimulationExperimentConfig({
        ...props.folder,
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
        return false;
      }
      const previousOutputs = [...parsed.config.outputs];
      parsed.config.outputs.push({
        id: `output-${crypto.randomUUID()}`,
        label,
        expression,
      });
      const projected = {
        ...props.folder,
        input: {
          ...input,
          drafts: [],
          files: input.files.map((source) => ({
            ...source,
            text:
              source.path === input.configPath
                ? JSON.stringify(parsed.config)
                : (drafts.current.get(`${props.folder.id}\u0000${source.path}`)
                    ?.text ?? source.text),
          })),
        },
      };
      const resolved = compileSourceSimulation(props.project, projected);
      if (!resolved.ok) {
        props.onProblem(
          inputProblem(
            "SIMULATION_SIGNAL_UNRESOLVED",
            resolved.diagnostics.map((d) => d.message).join("; "),
          ),
        );
        return false;
      }
      const output = resolved.outputs.at(-1)!;
      const acquisitionIds = new Set<string>();
      const visit = (value: typeof output.expression) => {
        if (value.kind === "acquisition")
          acquisitionIds.add(value.acquisitionId);
        if ("operand" in value) visit(value.operand);
        if ("left" in value) {
          visit(value.left);
          visit(value.right);
        }
      };
      visit(output.expression);
      const nativeVectors = resolved.vectors
        .filter((v) => acquisitionIds.has(v.probeId))
        .map((v) => v.vector);
      // Only terminal-current targets require a durable instrumentation owner.
      // Ordinary voltage picks are native save text, not a second output setup.
      if (expression.kind !== "current")
        parsed.config.outputs = previousOutputs;
      else if (
        previousOutputs.some(
          (o) => JSON.stringify(o.expression) === JSON.stringify(expression),
        )
      )
        parsed.config.outputs = previousOutputs;
      if (expression.kind === "current") {
        drafts.current.set(`${props.folder.id}\u0000${input.configPath}`, {
          base: draft?.base ?? file?.text ?? "",
          text: JSON.stringify(parsed.config, null, 2) + "\n",
          committed: draft?.committed ?? props.project.structureRevision,
        });
      }
      insert(nativeVectors.length ? nativeVectors : ["v(0)"]);
      render((v) => v + 1);
      return true;
    };
    const addPicked = (matches: readonly SimulationProbeOption[]) => {
      if (!binding) return;
      if (matches.length !== 1) {
        props.onProblem(
          inputProblem(
            "SIMULATION_SIGNAL_UNRESOLVED",
            "This pick has no unique signal. Choose a mapped Net or terminal, or select the signal from Helper.",
          ),
        );
        return;
      }
      const match = matches[0]!;
      saveSignal(match.label, {
        ...match.target,
        circuit: { bindingId: binding.id, callPath: [] },
      });
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
      setReveal(undefined);
      setProbePicker(undefined);
      saveSession.current = crypto.randomUUID();
    }, [props.folder.id]);
    const lastCanvasSelection = useRef<string | undefined>(undefined);
    useEffect(() => {
      const selected = props.selectedCircuitObject;
      const selectionKey = selected
        ? JSON.stringify([selected.documentId, selected.instanceId])
        : undefined;
      const changed = lastCanvasSelection.current !== selectionKey;
      lastCanvasSelection.current = selectionKey;
      if (!selected) return;
      // A new Canvas selection reveals code; changing folders must not overwrite
      // an explicit file activation with an old selection from the drawing.
      if (!changed && paths[props.folder.id] !== undefined) return;
      for (const { binding, result } of generated) {
        if (!result.ok) continue;
        const instance = result.source.instances.find(
          (card) =>
            card.documentId === selected.documentId &&
            card.instanceId === selected.instanceId,
        );
        if (!instance) continue;
        const draft = drafts.current.get(
          `${props.folder.id}\u0000${binding.path}`,
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
      props.folder.id,
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
      folderId: props.folder.id,
      files: sourceFiles,
      drafts,
    });
    latestSources.current = {
      folderId: props.folder.id,
      files: sourceFiles,
      drafts,
    };
    const key = (filePath: string) => `${props.folder.id}\u0000${filePath}`;
    const selected = sourceFiles.find((file) => file.path === path);
    const originalGenerated = generated.find(
      (item) => item.binding.path === path,
    )?.result;
    const buffer = drafts.current.get(key(path));
    const conflict = buffer && buffer.base !== (selected?.text ?? "");
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
    const unsaved = [...drafts.current].filter(([key, value]) => {
      const owner = props.project.simulationFolders.find((folder) =>
        key.startsWith(`${folder.id}\u0000`),
      );
      if (!owner || value.text === value.base) return false;
      return !owner.input.drafts?.some(
        (saved) =>
          saved.path === key.slice(owner.id.length + 1) &&
          saved.base === value.base &&
          saved.text === value.text,
      );
    });
    const dirty = unsaved.length > 0;
    const activeDirty = unsaved.some(([key]) =>
      key.startsWith(`${props.folder.id}\u0000`),
    );
    useEffect(() => props.onDirty(dirty), [dirty, props.folder.id]);
    useEffect(
      () => props.onActiveDirty(activeDirty),
      [activeDirty, props.folder.id],
    );
    useEffect(() => {
      // Clean buffers follow remote edits. A dirty buffer remains visible for explicit repair.
      for (const file of sourceFiles) {
        const stored = drafts.current.get(key(file.path));
        if (stored && stored.text === stored.base && stored.base !== file.text)
          drafts.current.delete(key(file.path));
      }
    }, [props.project]);
    const flush = async (onlyPath?: string): Promise<SourceFlush> => {
      if (savingRef.current) return { ok: false };
      savingRef.current = true;
      setSaving(true);
      try {
        let revision = current.current.project.structureRevision;
        let folder = current.current.folder;
        const pending = [...drafts.current].filter(
          ([key, value]) =>
            key.startsWith(`${folder.id}\u0000`) &&
            value.text !== value.base &&
            (onlyPath === undefined || key === `${folder.id}\u0000${onlyPath}`),
        );
        const authored: Array<{ path: string; text: string }> = [];
        const circuitEdits: Array<{
          path: string;
          textDigest: string;
          text: string;
        }> = [];
        for (const [draftKey, draft] of pending) {
          const filePath = draftKey.slice(folder.id.length + 1);
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
              folder.input.files.find((file) => file.path === filePath)?.text ??
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
            owner: { kind: "project-folder", folderId: folder.id },
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
          folder = {
            ...folder,
            input: {
              ...folder.input,
              files: [
                ...folder.input.files.filter(
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
        return { ok: true, folder, revision };
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    };
    useImperativeHandle(ref, () => ({
      flush,
      save: async () => {
        const applied = await flush();
        // Preserve every folder's remaining buffer, including invalid values and
        // concurrent-edit conflicts, without treating it as runnable source.
        for (const folder of current.current.project.simulationFolders) {
          const pending = [...drafts.current].filter(
            ([key, draft]) =>
              key.startsWith(`${folder.id}\u0000`) && draft.base !== draft.text,
          );
          if (!pending.length) continue;
          const owner = {
            kind: "project-folder" as const,
            folderId: folder.id,
          };
          const listed = await props.files.handle({ action: "list", owner });
          if (!listed.ok || !("source" in listed)) {
            if (!listed.ok) props.onProblem(listed.error);
            return false;
          }
          const reply = await props.files.handle({
            action: "update",
            owner,
            expectedRevision: listed.source.revision,
            drafts: pending.map(([key, draft]) => ({
              path: key.slice(folder.id.length + 1),
              base: draft.base,
              text: draft.text,
              ...(draft.binding ? { binding: draft.binding } : {}),
            })),
          });
          if (!reply.ok) {
            props.onProblem(reply.error);
            return false;
          }
        }
        if (!applied.ok)
          props.onProblem(
            inputProblem(
              "SOURCE_DRAFT_SAVED",
              "Saved unfinished code as a draft. Circuit values are unchanged; finish or discard the draft before Run.",
            ),
          );
        return true;
      },
      reveal: async (location) => {
        const folderId = props.folder.id;
        const captured =
          drafts.current.get(key(location.path))?.text ??
          sourceFiles.find((file) => file.path === location.path)?.text;
        if (
          captured === undefined ||
          (await sha256(captured)) !== location.textDigest ||
          latestSources.current.folderId !== folderId ||
          (latestSources.current.drafts.current.get(
            `${folderId}\u0000${location.path}`,
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
          .filter((id) => id.startsWith(`${props.folder.id}\u0000`))
          .map((id) => id.slice(props.folder.id.length + 1)),
      ]),
    ];
    const validateFileName = (
      name: string,
      folderId: string,
      previous?: string,
    ) => {
      if (
        /^[\\/]|[\\\u0000-\u001f]/u.test(name) ||
        name.split("/").some((part) => !part || part === "." || part === "..")
      )
        return "Use a relative file path without . or .. segments.";
      const folder = current.current.project.simulationFolders.find(
        (item) => item.id === folderId,
      );
      if (
        name !== previous &&
        (folder?.input.files.some((f) => f.path === name) ||
          folder?.input.circuitBindings.some((b) => b.path === name) ||
          drafts.current.has(`${folderId}\u0000${name}`))
      )
        return "A file with this path already exists.";
      return undefined;
    };
    const fileText = (folderId: string, filePath: string) => {
      const draft = drafts.current.get(`${folderId}\u0000${filePath}`);
      if (draft) return draft.text;
      const folder = props.project.simulationFolders.find(
        (item) => item.id === folderId,
      );
      const file = folder?.input.files.find((item) => item.path === filePath);
      if (file) return file.text;
      const binding = folder?.input.circuitBindings.find(
        (item) => item.path === filePath,
      );
      if (!binding) return "";
      const generated = generateCircuitSource(props.project, binding);
      return generated.ok
        ? generated.source.text
        : generated.diagnostics.map((d) => `* ${d.message}`).join("\n");
    };
    const requestSave = async () => {
      if (projectSaveRequest.current) return;
      projectSaveRequest.current = true;
      setSaveRequested(true);
      try {
        if (props.onSaveProject) await props.onSaveProject();
        else await flush();
      } catch (error) {
        props.onProblem(
          inputProblem(
            "PROJECT_SAVE_FAILED",
            error instanceof Error
              ? error.message
              : "Save failed; drafts retained.",
          ),
        );
      } finally {
        projectSaveRequest.current = false;
        setSaveRequested(false);
      }
    };
    const downloadSelection = async (
      selection: readonly SimulationExplorerSelection[],
      archive = false,
    ) => {
      if (selection.length === 1 && !archive) {
        const item = selection[0]!;
        if (item.kind === "source") {
          const result = downloadTextArtifact(
            fileText(item.folderId, item.path),
            item.path.split("/").at(-1)!,
          );
          if (result.status === "failed")
            props.onProblem(
              inputProblem("SOURCE_EXPORT_FAILED", result.message),
            );
        } else props.onDownloadArtifact?.(item.artifact);
        return;
      }
      const bundle = await buildSimulationWorkspaceArchive(
        props.files,
        selection.map((item) => {
          if (item.kind === "artifact")
            return {
              kind: "artifact" as const,
              path: `${item.groupKey}/${(simulationExplorerArtifactCategory(item.artifact) ?? simulationArtifactCategory(item.artifact)).toLowerCase()}/${item.artifact.name}`,
              artifact: item.artifact,
            };
          const folder = props.project.simulationFolders.find(
            (candidate) => candidate.id === item.folderId,
          );
          return {
            kind: "text" as const,
            path: `${folder?.name ?? item.folderId}/source/${item.path}`,
            text: fileText(item.folderId, item.path),
          };
        }),
      );
      if (!bundle.ok) {
        props.onProblem(bundle.error);
        return;
      }
      const url = URL.createObjectURL(
        new Blob([bundle.bytes as BlobPart], { type: "application/zip" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${props.folder.name}-selected-files.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    const saveState =
      saveRequested || saving || props.projectSaveState === "saving"
        ? "saving"
        : props.projectSaveState === "failed" ||
            props.projectSaveState === "offline"
          ? "failed"
          : props.projectSaveState === "clean" && !dirty
            ? "saved"
            : "dirty";
    const saveFeedback =
      saveState === "saving"
        ? "Saving project…"
        : saveState === "saved"
          ? "Project saved"
          : saveState === "failed"
            ? "Save failed; drafts remain local. Retry save."
            : "Save project";
    return (
      <SimulationCodeWorkspace
        workspaceKey={props.folder.id}
        folders={
          props.folders
            ? {
                ...props.folders,
                folders: props.folders.folders.map((node) => {
                  const folder = props.project.simulationFolders.find(
                    (f) => f.id === node.id,
                  )!;
                  const names = new Set([
                    ...(node.files ?? []).map((f) => f.path),
                    ...[...drafts.current.keys()]
                      .filter((key) => key.startsWith(`${node.id}\u0000`))
                      .map((key) => key.slice(node.id.length + 1)),
                  ]);
                  return {
                    ...node,
                    files: [...names].map((path) => {
                      const draft = drafts.current.get(
                        `${node.id}\u0000${path}`,
                      );
                      const modified = !!draft && draft.text !== draft.base;
                      return {
                        path,
                        kind: folder.input.circuitBindings.some(
                          (b) => b.path === path,
                        )
                          ? ("generated" as const)
                          : ("authored" as const),
                        draft: modified,
                        dirty:
                          modified &&
                          !folder.input.drafts?.some(
                            (saved) =>
                              saved.path === path &&
                              saved.base === draft.base &&
                              saved.text === draft.text,
                          ),
                      };
                    }),
                  };
                }),
              }
            : undefined
        }
        additionalActions={props.additionalActions ?? []}
        {...(props.artifactGroups
          ? { artifactGroups: props.artifactGroups }
          : {})}
        {...(props.artifactPreview
          ? { artifactPreview: props.artifactPreview }
          : {})}
        {...(props.artifactBusy ? { artifactBusy: props.artifactBusy } : {})}
        {...(props.onSelectArtifact
          ? { onSelectArtifact: props.onSelectArtifact }
          : {})}
        {...(props.onCloseArtifact
          ? { onCloseArtifact: props.onCloseArtifact }
          : {})}
        {...(props.onDownloadArtifact
          ? { onDownloadArtifact: props.onDownloadArtifact }
          : {})}
        onDownloadSelection={(selection, archive) =>
          void downloadSelection(selection, archive)
        }
        files={ownFiles.map((filePath) => ({
          path: filePath,
          kind: input.circuitBindings.some((b) => b.path === filePath)
            ? "generated"
            : "authored",
          dirty:
            !!drafts.current.get(key(filePath)) &&
            drafts.current.get(key(filePath))!.text !==
              drafts.current.get(key(filePath))!.base &&
            !input.drafts?.some(
              (saved) =>
                saved.path === filePath &&
                saved.text === drafts.current.get(key(filePath))!.text &&
                saved.base === drafts.current.get(key(filePath))!.base,
            ),
          draft:
            !!drafts.current.get(key(filePath)) &&
            drafts.current.get(key(filePath))!.text !==
              drafts.current.get(key(filePath))!.base,
        }))}
        activePath={path}
        onSelectFile={setPath}
        onFileAction={async (
          action,
          filePath,
          targetFolderId = props.folder.id,
        ) => {
          const owner = {
            kind: "project-folder" as const,
            folderId: targetFolderId,
          };
          const bufferKey = `${targetFolderId}\u0000${filePath}`;
          if (action === "discard") {
            const listed = await props.files.handle({
              action: "list",
              owner,
            });
            if (!listed.ok || !("source" in listed)) return;
            const result = await props.files.handle({
              action: "update",
              owner,
              expectedRevision: listed.source.revision,
              drafts: (listed.source.drafts ?? []).filter(
                (draft) => draft.path !== filePath,
              ),
            });
            if (!result.ok) {
              props.onProblem(result.error);
              return;
            }
            drafts.current.delete(bufferKey);
            cache.write(drafts.current);
            render((v) => v + 1);
            props.onProblem(undefined);
            return;
          }
          if (
            action === "delete" &&
            !(await ui.confirm({
              title: `Delete ${filePath}?`,
              message:
                "This removes the file and its draft. Undo restores it. References to this file may need repair.",
            }))
          )
            return;
          const nextPath =
            action === "rename"
              ? await ui.name({
                  kind: "file",
                  folderId: targetFolderId,
                  path: filePath,
                  label: "Relative file path",
                  initial: filePath,
                  validate: (name) =>
                    validateFileName(name, targetFolderId, filePath),
                })
              : filePath;
          if (!nextPath || (action === "rename" && nextPath === filePath))
            return;
          const listed = await props.files.handle({ action: "list", owner });
          if (!listed.ok || !("source" in listed)) {
            if (!listed.ok) props.onProblem(listed.error);
            return;
          }
          const folder = current.current.project.simulationFolders.find(
            (item) => item.id === targetFolderId,
          );
          const persistedFile = folder?.input.files.find(
            (item) => item.path === filePath,
          );
          const draft = drafts.current.get(bufferKey);
          const file =
            persistedFile ?? (draft ? { path: filePath, text: "" } : undefined);
          if (!folder || !file) return;
          if (draft && draft.base !== file.text) {
            props.onProblem(
              inputProblem(
                "SOURCE_CONFLICT",
                "File changed elsewhere; draft retained.",
              ),
            );
            return;
          }
          const content = draft?.text ?? file.text;
          const result = await props.files.handle({
            action: "update",
            owner,
            expectedRevision: listed.source.revision,
            ...(action === "rename"
              ? {
                  removes: [filePath],
                  writes: [{ path: nextPath, text: content }],
                  ...(filePath === folder.input.entry
                    ? { entry: nextPath }
                    : {}),
                  ...(filePath === folder.input.configPath
                    ? { configPath: nextPath }
                    : {}),
                }
              : action === "delete"
                ? { removes: [filePath] }
                : {
                    entry: filePath,
                    writes: [{ path: filePath, text: content }],
                  }),
          });
          if (!result.ok) props.onProblem(result.error);
          else {
            drafts.current.delete(bufferKey);
            cache.write(drafts.current);
            render((v) => v + 1);
            // Operating on a background file never opens it as a side effect.
            if (
              paths[targetFolderId] === filePath ||
              (targetFolderId === props.folder.id && path === filePath)
            )
              setPaths((current) => ({
                ...current,
                [targetFolderId]: action === "delete" ? "" : nextPath,
              }));
            props.onProblem(undefined);
          }
        }}
        entryPath={input.entry}
        configPath={input.configPath}
        onCopyFile={(filePath, folderId = props.folder.id) => {
          void navigator.clipboard
            .writeText(fileText(folderId, filePath))
            .catch(() =>
              props.onProblem(
                inputProblem(
                  "SOURCE_COPY_FAILED",
                  "Clipboard access is unavailable. Select the code to copy, or export the current file.",
                ),
              ),
            );
        }}
        onExportFile={(filePath, folderId = props.folder.id) => {
          const result = downloadTextArtifact(
            fileText(folderId, filePath),
            filePath.split("/").at(-1)!,
          );
          if (result.status === "failed")
            props.onProblem(
              inputProblem("SOURCE_EXPORT_FAILED", result.message),
            );
        }}
        onNewFile={async (folderId = props.folder.id) => {
          const path = await ui.name({
            kind: "file",
            folderId,
            label: "Relative file path",
            initial: "stimulus.cir",
            validate: (name) => validateFileName(name, folderId),
          });
          if (!path) return;
          drafts.current.set(`${folderId}\u0000${path}`, {
            base: "",
            text: "* New source\n",
            committed: current.current.project.structureRevision,
          });
          setPath(path, folderId);
          render((value) => value + 1);
        }}
        actions={
          <>
            <button
              className="simulation-action-button"
              data-workspace-save="true"
              data-save-state={saveState}
              aria-label="Save project"
              aria-description={saveFeedback}
              title={`${saveFeedback} · Ctrl+S`}
              disabled={saveState === "saving" || saveState === "saved"}
              aria-busy={saveState === "saving"}
              onClick={() => void requestSave()}
            >
              <SimulationActionIcon
                kind={saveState === "dirty" ? "save" : saveState}
              />
            </button>
            {props.actions}
          </>
        }
        toolbarEnd={props.toolbarEnd}
        console={props.console}
        results={props.results}
        outputActions={props.outputActions}
        outputPane={props.outputPane}
        onSelectOutputPane={props.onSelectOutputPane}
        maximized={props.maximized}
        onToggleMaximize={props.onToggleMaximize}
        status={
          !recoveryAvailable || conflict || props.status ? (
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
              ) : (
                props.status
              )}
            </>
          ) : null
        }
      >
        <SimulationCodeEditor
          helperContent={
            probePicker ? (
              <SourceProbePicker
                key={`${props.folder.id}:${probePicker}`}
                choices={probeChoices}
                kind={probePicker}
                onAdd={saveSignal}
                onClose={() => setProbePicker(undefined)}
              />
            ) : undefined
          }
          onCloseHelperContent={() => setProbePicker(undefined)}
          picking={
            props.pickNetsActive || props.pickTerminalsActive
              ? {
                  label: props.pickNetsActive
                    ? "Picking voltage"
                    : "Picking current",
                  onStop: () => {
                    props.onPickNetsChange?.(false);
                    props.onPickTerminalsChange?.(false);
                  },
                }
              : undefined
          }
          signalNames={() =>
            Object.fromEntries(
              Object.entries(signals).map(([vector, signal]) => [
                vector,
                signal.label,
              ]),
            )
          }
          onFocusSignal={(vector) => {
            props.onPreviewSignal?.(
              vector
                ? (signals[vector.toLowerCase()]?.targets[0] ?? null)
                : null,
            );
          }}
          saveRequest={saveRequest}
          relatedSources={sourceFiles.map(
            (file) =>
              drafts.current.get(`${props.folder.id}\u0000${file.path}`)
                ?.text ?? file.text,
          )}
          helperActions={[
            {
              id: "save-voltage",
              label: "Save voltage…",
              keywords: "probe voltage 电压 信号 看输出",
              run: () => {
                beginSignalSelection();
                setProbePicker("voltage");
              },
            },
            {
              id: "save-current",
              label: "Save terminal current…",
              keywords: "probe current 电流 MOS 端口",
              run: () => {
                beginSignalSelection();
                setProbePicker("current");
              },
            },
            ...(binding
              ? [
                  {
                    id: "pick-net",
                    label: props.pickNetsActive
                      ? "Stop picking Nets"
                      : "Pick Net on Canvas",
                    keywords: "probe 电压 画布",
                    run: () => {
                      beginSignalSelection();
                      props.onPickNetsChange?.(!props.pickNetsActive);
                    },
                  },
                  {
                    id: "pick-current",
                    label: props.pickTerminalsActive
                      ? "Stop picking current"
                      : "Pick current on Canvas",
                    keywords: "probe 电流 画布",
                    run: () => {
                      beginSignalSelection();
                      props.onPickTerminalsChange?.(!props.pickTerminalsActive);
                    },
                  },
                ]
              : []),
          ]}
          path={path}
          text={text}
          historyKey={`${props.folder.id}:${buffer?.committed ?? props.project.structureRevision}`}
          mode={path.endsWith(".json") ? "json" : "spice"}
          entry={path === input.entry}
          generated={Boolean(originalGenerated)}
          validateText={(text) => {
            if (!originalGenerated?.ok) return [];
            const plan = planCircuitSourceEdit(originalGenerated.source, text);
            return !plan.ok && plan.range
              ? [{ ...plan.range, message: plan.message, code: plan.code }]
              : [];
          }}
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
          onSave={() => void requestSave()}
          onRun={props.onRun}
          onHistoryBoundary={props.onHistoryBoundary}
        />
      </SimulationCodeWorkspace>
    );
  },
);
