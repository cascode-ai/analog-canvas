import {
  createContext,
  useEffect,
  useId,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { ArtifactRef } from "@icm/simulation-service/contract";
import {
  SimulationFolderTree,
  type SimulationFolderTreeProps,
} from "./simulation-file-tree";
import {
  useWorkspaceInteractions,
  WorkspaceNameInput,
  type WorkspaceMenuItem,
} from "./workspace-interactions";
import {
  formatSimulationArtifactPreview,
  simulationArtifactCategory,
  type SimulationArtifactContent,
} from "./simulation-artifact-files";

export const CodeDocumentActions = createContext<HTMLElement | null>(null);

export interface SimulationCodeFile {
  path: string;
  kind: "authored" | "generated" | "prepared";
  dirty?: boolean;
  draft?: boolean;
}
export interface SimulationExplorerArtifactGroup {
  key: "prepare" | "run";
  label: string;
  description: string;
  artifacts: readonly ArtifactRef[];
}
export type SimulationExplorerSelection =
  | { kind: "source"; folderId: string; path: string }
  | { kind: "artifact"; groupKey: "prepare" | "run"; artifact: ArtifactRef };
export interface SimulationCodeWorkspaceProps {
  workspaceKey: string;
  files: readonly SimulationCodeFile[];
  entryPath: string;
  configPath: string;
  activePath: string;
  onSelectFile(path: string, folderId?: string): void;
  onNewFile?(folderId?: string): void;
  onCopyFile?(path: string, folderId?: string): void;
  onExportFile?(path: string, folderId?: string): void;
  onFileAction?(
    action: "rename" | "delete" | "entry" | "discard",
    path: string,
    folderId?: string,
  ): void;
  artifactGroups?: readonly SimulationExplorerArtifactGroup[];
  artifactPreview?: SimulationArtifactContent | undefined;
  artifactBusy?: string | undefined;
  onSelectArtifact?(artifact: ArtifactRef): void;
  onCloseArtifact?(): void;
  onDownloadArtifact?(artifact: ArtifactRef): void;
  onDownloadSelection?(selection: readonly SimulationExplorerSelection[]): void;
  folders?:
    Omit<SimulationFolderTreeProps, "renderFiles" | "onNewFile"> | undefined;
  additionalActions?: WorkspaceMenuItem[];
  children: ReactNode;
  actions: ReactNode;
  status?: ReactNode;
  console: ReactNode;
  results: ReactNode;
  outputActions?: ReactNode;
  outputPane: "console" | "plot" | "operating-point" | "compare";
  onSelectOutputPane(pane: SimulationCodeWorkspaceProps["outputPane"]): void;
  maximized?: boolean;
  onToggleMaximize?(): void;
}

/** Approved Code layout only; Project, drafts and Run ownership remain in their controllers. */
export function SimulationCodeWorkspace(props: SimulationCodeWorkspaceProps) {
  const [documentActions, setDocumentActions] = useState<HTMLDivElement | null>(
    null,
  );
  const ui = useWorkspaceInteractions();
  const filesId = useId();
  const defaults = () =>
    props.files
      .filter((f) => f.kind === "generated" || f.path === props.entryPath)
      .map((f) => f.path);
  const [filesOpen, setFilesOpen] = useState(Boolean(props.folders));
  const [views, setViews] = useState<Record<string, string[]>>({});
  const opened = views[props.workspaceKey] ?? defaults();
  const setOpened = (update: string[] | ((paths: string[]) => string[])) =>
    setViews((current) => ({
      ...current,
      [props.workspaceKey]:
        typeof update === "function"
          ? update(current[props.workspaceKey] ?? defaults())
          : update,
    }));
  const [filesWidth, setFilesWidth] = useState(() => {
    try {
      return Math.max(
        110,
        Math.min(
          420,
          Number(localStorage.getItem("icm.code.files-width")) || 240,
        ),
      );
    } catch {
      return 240;
    }
  });
  const [resultsHeight, setResultsHeight] = useState(38);
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (props.activePath)
      setOpened((paths) =>
        paths.includes(props.activePath) ? paths : [...paths, props.activePath],
      );
  }, [props.activePath, props.workspaceKey]);
  useEffect(() => {
    if (ui.edit) setFilesOpen(true);
  }, [ui.edit]);
  useEffect(() => {
    try {
      localStorage.setItem("icm.code.files-width", String(filesWidth));
    } catch {
      /* Optional layout preference. */
    }
  }, [filesWidth]);
  const tabs = opened.filter((path) =>
    props.files.some((file) => file.path === path),
  );
  const openFile = (path: string, folderId?: string) => {
    if (!folderId || folderId === props.folders?.activeId)
      setOpened((paths) => (paths.includes(path) ? paths : [...paths, path]));
    props.onSelectFile(path, folderId);
    ui.closeMenu();
  };
  const closeFile = (path: string) => {
    const next = tabs.filter((item) => item !== path);
    setOpened(next);
    if (props.activePath === path) props.onSelectFile(next.at(-1) ?? "");
  };
  const sourceKey = (folderId: string, path: string) =>
    `source\u0000${folderId}\u0000${path}`;
  const artifactKey = (groupKey: string, artifactId: string) =>
    `artifact\u0000${groupKey}\u0000${artifactId}`;
  const select = (key: string, event: ReactMouseEvent) =>
    setSelected((current) =>
      event.ctrlKey || event.metaKey
        ? current.includes(key)
          ? current.filter((item) => item !== key)
          : [...current, key]
        : [key],
    );
  const selection = (): SimulationExplorerSelection[] => {
    const result: SimulationExplorerSelection[] = [];
    for (const key of selected) {
      const [kind, owner, value] = key.split("\u0000");
      if (kind === "source" && owner && value)
        result.push({ kind, folderId: owner, path: value });
      if (kind === "artifact" && (owner === "prepare" || owner === "run")) {
        const artifact = props.artifactGroups
          ?.find((group) => group.key === owner)
          ?.artifacts.find((item) => item.id === value);
        if (artifact) result.push({ kind, groupKey: owner, artifact });
      }
    }
    return result;
  };
  const fileMenu = (
    file: SimulationCodeFile,
    folderId: string | undefined,
    x: number,
    y: number,
  ) => {
    const items: WorkspaceMenuItem[] = [
      { label: "Open", run: () => openFile(file.path, folderId) },
      {
        label: "Copy contents",
        run: () => props.onCopyFile?.(file.path, folderId),
      },
      {
        label: "Export file…",
        run: () => props.onExportFile?.(file.path, folderId),
      },
    ];
    if (file.kind === "authored")
      items.push(
        ...(
          [
            ["rename", "Rename…"],
            ["delete", "Delete…"],
            ["entry", "Use as run entry"],
          ] as const
        ).map(([action, label]) => ({
          label,
          run: () => props.onFileAction?.(action, file.path, folderId),
        })),
      );
    if (file.draft)
      items.push({
        label: "Discard draft",
        run: () => props.onFileAction?.("discard", file.path, folderId),
      });
    ui.menu(x, y, items, `Actions for ${file.path}`);
  };
  const fileList = (folderId?: string) => {
    const current = !folderId || folderId === props.folders?.activeId;
    const folder = props.folders?.folders.find((f) => f.id === folderId);
    const files = current ? props.files : (folder?.files ?? []);
    const visibleFiles = files.filter(
      (file) => file.path !== (current ? props.configPath : folder?.configPath),
    );
    const editing =
      ui.edit?.kind === "file" &&
      ui.edit.folderId === (folderId ?? props.folders?.activeId);
    const resolvedFolderId = folderId ?? props.folders?.activeId ?? "workspace";
    const sourceSectionKey = `${resolvedFolderId}:source`;
    const groups = current ? (props.artifactGroups ?? []) : [];
    return (
      <div className="simulation-explorer-sections">
        <details
          className="simulation-explorer-section is-source"
          open={sectionOpen[sourceSectionKey] ?? true}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setSectionOpen((state) => ({
              ...state,
              [sourceSectionKey]: open,
            }));
          }}
        >
          <summary>
            <span>Source</span>
            <small>{visibleFiles.length}</small>
          </summary>
          <ul>
            {editing && !ui.edit?.path ? (
              <li>
                <WorkspaceNameInput key="new-file" />
              </li>
            ) : null}
            {visibleFiles.map((file) => (
              <li
                key={file.path}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  fileMenu(file, folderId, event.clientX, event.clientY);
                }}
                onKeyDown={(event) => {
                  if (event.target instanceof HTMLInputElement) return;
                  if (
                    (event.key === "F2" || event.key === "Delete") &&
                    file.kind === "authored"
                  ) {
                    event.preventDefault();
                    props.onFileAction?.(
                      event.key === "F2" ? "rename" : "delete",
                      file.path,
                      folderId,
                    );
                  }
                  if (
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  ) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    fileMenu(file, folderId, rect.left, rect.bottom);
                  }
                }}
              >
                {editing && ui.edit?.path === file.path ? (
                  <WorkspaceNameInput key={file.path} />
                ) : (
                  <button
                    type="button"
                    data-tree-row="file"
                    data-folder-id={folderId ?? props.folders?.activeId}
                    data-file-path={file.path}
                    className={[
                      current &&
                      !props.artifactPreview &&
                      file.path === props.activePath
                        ? "is-active"
                        : "",
                      selected.includes(sourceKey(resolvedFolderId, file.path))
                        ? "is-selected"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-pressed={selected.includes(
                      sourceKey(resolvedFolderId, file.path),
                    )}
                    title={file.path}
                    onClick={(event) => {
                      select(sourceKey(resolvedFolderId, file.path), event);
                      props.onCloseArtifact?.();
                      openFile(file.path, folderId);
                    }}
                  >
                    <span className="simulation-file-icon" aria-hidden="true">
                      {file.kind === "generated"
                        ? "◇"
                        : file.kind === "prepared"
                          ? "▧"
                          : "·"}
                    </span>
                    <span className="simulation-file-name">{file.path}</span>
                    {file.dirty ? (
                      <span
                        className="simulation-file-state is-dirty"
                        title="Unsaved"
                      >
                        ●
                      </span>
                    ) : file.draft ? (
                      <span
                        className="simulation-file-state"
                        title="Saved draft"
                      >
                        ◌
                      </span>
                    ) : null}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
        {groups.map((group) => {
          const groupSectionKey = `${resolvedFolderId}:${group.key}`;
          return (
            <details
              key={group.key}
              className="simulation-explorer-section is-temporary"
              aria-label={`${group.label} temporary files`}
              open={sectionOpen[groupSectionKey] ?? false}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setSectionOpen((state) => ({
                  ...state,
                  [groupSectionKey]: open,
                }));
              }}
            >
              <summary>
                <span>{group.label}</span>
                <span className="simulation-temporary-badge">Temporary</span>
                <small>{group.artifacts.length}</small>
              </summary>
              <p>{group.description}</p>
              <ul>
                {group.artifacts.map((artifact) => {
                  const key = artifactKey(group.key, artifact.id);
                  const active =
                    props.artifactPreview?.artifact.id === artifact.id;
                  return (
                    <li key={artifact.id}>
                      <button
                        type="button"
                        data-tree-row="artifact"
                        className={`${active ? "is-active" : ""}${selected.includes(key) ? " is-selected" : ""}`.trim()}
                        aria-pressed={selected.includes(key)}
                        title={`${simulationArtifactCategory(artifact)} · ${artifact.name}`}
                        disabled={props.artifactBusy !== undefined}
                        onClick={(event) => {
                          select(key, event);
                          props.onSelectArtifact?.(artifact);
                        }}
                      >
                        <span
                          className="simulation-file-icon"
                          aria-hidden="true"
                        >
                          ▧
                        </span>
                        <span className="simulation-file-name">
                          {artifact.name}
                        </span>
                        <small>{simulationArtifactCategory(artifact)}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </div>
    );
  };
  const selectedItems = selection();
  return (
    <section
      className={`simulation-code-workspace${props.maximized ? " is-maximized" : ""}`}
      aria-label="Simulation Code workspace"
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget
            .querySelector<HTMLButtonElement>("[data-workspace-save]")
            ?.click();
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "w"
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (props.activePath) closeFile(props.activePath);
        }
      }}
    >
      <header className="simulation-code-toolbar">
        <button
          type="button"
          aria-expanded={filesOpen}
          aria-controls={filesId}
          onClick={() => setFilesOpen(!filesOpen)}
        >
          Explorer
        </button>
        <div className="simulation-code-actions">{props.actions}</div>
        <div className="simulation-code-more">
          <button
            type="button"
            aria-label="More code actions"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              ui.menu(
                rect.left,
                rect.bottom,
                [
                  {
                    label: "Advanced configuration",
                    run: () => openFile(props.configPath),
                  },
                  {
                    label: "Copy current file",
                    disabled: !props.activePath,
                    run: () => props.onCopyFile?.(props.activePath),
                  },
                  {
                    label: "Export current file…",
                    disabled: !props.activePath,
                    run: () => props.onExportFile?.(props.activePath),
                  },
                  {
                    label: "Close all editors",
                    run: () => {
                      setOpened([]);
                      props.onSelectFile("");
                    },
                  },
                  ...(props.additionalActions ?? []),
                ],
                "Code actions",
              );
            }}
          >
            ···
          </button>
        </div>
      </header>
      <div className="simulation-code-source-area">
        {filesOpen ? (
          <aside
            id={filesId}
            className="simulation-code-files"
            style={{ width: filesWidth }}
            aria-label="Simulation files"
          >
            <header className="simulation-explorer-header">
              <strong>Explorer</strong>
              <button
                type="button"
                disabled={!selectedItems.length || !props.onDownloadSelection}
                onClick={() => props.onDownloadSelection?.(selectedItems)}
                title="Download selected files"
                aria-label={`Download selected files${selectedItems.length ? ` (${selectedItems.length})` : ""}`}
              >
                ↓ {selectedItems.length || ""}
              </button>
            </header>
            {props.folders ? (
              <SimulationFolderTree
                {...props.folders}
                renderFiles={fileList}
                onNewFile={(id) => props.onNewFile?.(id)}
              />
            ) : (
              fileList()
            )}
          </aside>
        ) : null}
        {filesOpen ? (
          <div
            className="workspace-files-resizer"
            role="separator"
            tabIndex={0}
            aria-label="Resize simulation files"
            aria-orientation="vertical"
            aria-valuemin={110}
            aria-valuemax={420}
            aria-valuenow={filesWidth}
            onDoubleClick={() => setFilesWidth(240)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                event.stopPropagation();
                setFilesWidth((width) =>
                  Math.max(
                    110,
                    Math.min(
                      420,
                      width + (event.key === "ArrowRight" ? 10 : -10),
                    ),
                  ),
                );
              }
            }}
            onPointerDown={(event) => {
              const handle = event.currentTarget;
              const bounds = handle.parentElement!.getBoundingClientRect();
              const maximum = Math.max(110, Math.min(420, bounds.width - 180));
              handle.setPointerCapture(event.pointerId);
              const move = (e: PointerEvent) =>
                setFilesWidth(
                  Math.max(110, Math.min(maximum, e.clientX - bounds.left)),
                );
              const end = () => {
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", end);
                handle.removeEventListener("pointercancel", end);
                handle.removeEventListener("lostpointercapture", end);
              };
              handle.addEventListener("pointermove", move);
              handle.addEventListener("pointerup", end);
              handle.addEventListener("pointercancel", end);
              handle.addEventListener("lostpointercapture", end);
            }}
          />
        ) : null}
        <div className="simulation-code-document">
          <div className="simulation-code-document-header">
            <div
              className="simulation-code-tabs"
              role="tablist"
              aria-label="Open simulation files"
            >
              {props.artifactPreview ? (
                <div className="simulation-code-tab simulation-artifact-tab">
                  <button type="button" role="tab" aria-selected="true">
                    {props.artifactPreview.artifact.name}
                    <span> Temporary</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${props.artifactPreview.artifact.name}`}
                    onClick={props.onCloseArtifact}
                  >
                    ×
                  </button>
                </div>
              ) : null}
              {tabs.map((path) => {
                const file = props.files.find((f) => f.path === path)!;
                return (
                  <div className="simulation-code-tab" key={path}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={
                        !props.artifactPreview && props.activePath === path
                      }
                      onClick={() => {
                        props.onCloseArtifact?.();
                        props.onSelectFile(path);
                      }}
                      title={path}
                    >
                      {path === props.configPath
                        ? "Configuration"
                        : path.split("/").at(-1)}
                      {file.kind === "generated" ? " ◇" : ""}
                      {file.dirty ? " ●" : file.draft ? " ◌" : ""}
                    </button>
                    {
                      <button
                        type="button"
                        aria-label={`Close ${path}`}
                        onClick={() => closeFile(path)}
                      >
                        ×
                      </button>
                    }
                  </div>
                );
              })}
            </div>
            <div
              className="simulation-code-document-actions"
              hidden={!props.activePath || Boolean(props.artifactPreview)}
              ref={setDocumentActions}
            />
          </div>
          <div className="simulation-code-document-content">
            <div
              hidden={!props.activePath || Boolean(props.artifactPreview)}
              className="workspace-editor-content"
            >
              <CodeDocumentActions.Provider value={documentActions}>
                {props.children}
              </CodeDocumentActions.Provider>
            </div>
            {props.artifactPreview ? (
              <section
                className="simulation-artifact-editor"
                aria-label="File preview"
              >
                <header>
                  <span>
                    Read-only preview · Temporary run file
                    {props.artifactPreview.truncated ? " · First 64 KB" : ""}
                  </span>
                  <button
                    type="button"
                    disabled={props.artifactBusy !== undefined}
                    onClick={() =>
                      props.onDownloadArtifact?.(
                        props.artifactPreview!.artifact,
                      )
                    }
                  >
                    Download
                  </button>
                </header>
                <pre>
                  {formatSimulationArtifactPreview(props.artifactPreview)}
                </pre>
              </section>
            ) : !props.activePath ? (
              <p className="workspace-empty-editor">
                Select a file to edit. Closing tabs does not delete files.
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div
        className="simulation-code-output-resizer"
        role="separator"
        aria-label="Resize code results"
        aria-orientation="horizontal"
        tabIndex={0}
        aria-valuemin={15}
        aria-valuemax={75}
        aria-valuenow={resultsHeight}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            setResultsHeight((height) =>
              Math.max(
                15,
                Math.min(75, height + (event.key === "ArrowUp" ? 5 : -5)),
              ),
            );
          }
        }}
        onPointerDown={(event) => {
          const handle = event.currentTarget,
            container = handle.parentElement!,
            bounds = container.getBoundingClientRect();
          handle.setPointerCapture(event.pointerId);
          const move = (pointer: PointerEvent) =>
            setResultsHeight(
              Math.max(
                15,
                Math.min(
                  75,
                  ((bounds.bottom - pointer.clientY) / bounds.height) * 100,
                ),
              ),
            );
          const end = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", end);
            handle.removeEventListener("pointercancel", end);
            handle.removeEventListener("lostpointercapture", end);
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", end);
          handle.addEventListener("pointercancel", end);
          handle.addEventListener("lostpointercapture", end);
        }}
      />
      <section
        className="simulation-code-output"
        style={{
          flexBasis: props.maximized
            ? "auto"
            : collapsed
              ? "32px"
              : `${resultsHeight}%`,
        }}
        aria-label="Code output"
      >
        <header className="simulation-code-output-tabs">
          <div role="tablist" aria-label="Code output view">
            {(["console", "plot", "operating-point", "compare"] as const).map(
              (pane) => (
                <button
                  key={pane}
                  type="button"
                  role="tab"
                  aria-selected={pane === props.outputPane}
                  aria-label={
                    pane === "operating-point" ? "Operating Point" : undefined
                  }
                  onClick={() => {
                    props.onSelectOutputPane(pane);
                    setCollapsed(false);
                  }}
                >
                  {
                    {
                      console: "Console",
                      plot: "Plot",
                      "operating-point": "OP",
                      compare: "Compare",
                    }[pane]
                  }
                </button>
              ),
            )}
          </div>
          <span className="simulation-code-output-spacer" />
          {props.outputActions}
          <button
            type="button"
            aria-label={
              collapsed ? "Expand code output" : "Collapse code output"
            }
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? "⌃" : "⌄"}
          </button>
          {props.onToggleMaximize ? (
            <button
              type="button"
              aria-label={
                props.maximized ? "Restore results" : "Maximize results"
              }
              onClick={() => {
                setCollapsed(false);
                props.onToggleMaximize?.();
              }}
            >
              {props.maximized ? "⧉" : "□"}
            </button>
          ) : null}
        </header>
        {!collapsed ? (
          <div className="simulation-code-output-content" role="tabpanel">
            {props.outputPane === "console" ? props.console : props.results}
          </div>
        ) : null}
      </section>
      <footer className="simulation-code-status">{props.status}</footer>
    </section>
  );
}
