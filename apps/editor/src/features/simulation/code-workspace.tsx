import { useEffect, useId, useState, type ReactNode } from "react";
import { InlineSourceName } from "./inline-source-name";
import {
  SimulationFolderTree,
  type SimulationFolderTreeProps,
} from "./simulation-file-tree";

export interface SimulationCodeFile {
  path: string;
  kind: "authored" | "generated" | "prepared";
  dirty?: boolean;
}
export interface SimulationCodeWorkspaceProps {
  workspaceKey: string;
  files: readonly SimulationCodeFile[];
  entryPath: string;
  configPath: string;
  activePath: string;
  onSelectFile(path: string): void;
  onNewFile?(path: string): void;
  newFileRequest?: string | undefined;
  onCopyFile?(): void;
  onExportFile?(): void;
  onFileAction?(
    action: "rename" | "delete" | "entry" | "discard",
    path: string,
    newPath?: string,
  ): void;
  folders?: Omit<SimulationFolderTreeProps, "children"> | undefined;
  additionalActions?: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  status?: ReactNode;
  console: ReactNode;
  results: ReactNode;
  outputPane: "console" | "plot" | "operating-point" | "compare" | "files";
  onSelectOutputPane(pane: SimulationCodeWorkspaceProps["outputPane"]): void;
  maximized?: boolean;
  onToggleMaximize?(): void;
}

/** Approved Code layout only; Project, drafts and Run ownership remain in their controllers. */
export function SimulationCodeWorkspace(props: SimulationCodeWorkspaceProps) {
  const filesId = useId();
  const defaults = () =>
    props.files
      .filter((f) => f.kind === "generated" || f.path === props.entryPath)
      .map((f) => f.path);
  const [filesOpen, setFilesOpen] = useState(Boolean(props.folders));
  const [opened, setOpened] = useState(defaults);
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [resultsHeight, setResultsHeight] = useState(38);
  const [collapsed, setCollapsed] = useState(false);
  const [fileMenu, setFileMenu] = useState<string>();
  const [naming, setNaming] = useState<{ path?: string; initial: string }>();
  useEffect(() => {
    if (props.newFileRequest) {
      setFilesOpen(true);
      setNaming({ initial: "untitled.spice" });
    }
  }, [props.newFileRequest]);
  useEffect(() => {
    setOpened(defaults());
    setFileMenu(undefined);
    setMoreOpen(false);
  }, [props.workspaceKey]);
  useEffect(() => {
    setOpened((paths) =>
      paths.includes(props.activePath) ? paths : [...paths, props.activePath],
    );
  }, [props.activePath]);
  const tabs = opened.filter((path) =>
    props.files.some((file) => file.path === path),
  );
  const openFile = (path: string) => {
    setOpened((paths) => (paths.includes(path) ? paths : [...paths, path]));
    props.onSelectFile(path);
    setMoreOpen(false);
  };
  const closeFile = (path: string) => {
    const next = tabs.filter((item) => item !== path);
    setOpened(next);
    if (props.activePath === path)
      props.onSelectFile(next.at(-1) ?? props.entryPath);
  };
  const fileList = () => (
    <ul>
      <li>
        <button
          type="button"
          onClick={() => setNaming({ initial: "untitled.spice" })}
        >
          + New file
        </button>
      </li>
      {naming && (
        <li>
          <InlineSourceName
            label="File name"
            initial={naming.initial}
            onCancel={() => setNaming(undefined)}
            onSubmit={(name) => {
              if (naming.path)
                props.onFileAction?.("rename", naming.path, name);
              else props.onNewFile?.(name);
              setNaming(undefined);
            }}
          />
        </li>
      )}
      {props.files
        .filter((file) => file.path !== props.configPath)
        .map((file) => (
          <li
            key={file.path}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openFile(file.path);
              setFileMenu(file.path);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setFileMenu(undefined);
              }
            }}
          >
            <button
              type="button"
              className={file.path === props.activePath ? "is-active" : ""}
              title={file.path}
              onClick={() => openFile(file.path)}
            >
              <span aria-hidden="true">
                {file.kind === "generated"
                  ? "◇"
                  : file.kind === "prepared"
                    ? "▧"
                    : "·"}
              </span>{" "}
              {file.path}
              {file.dirty ? " ●" : ""}
            </button>
            {fileMenu === file.path ? (
              <div role="menu" aria-label={`Actions for ${file.path}`}>
                <button
                  role="menuitem"
                  onClick={() => {
                    props.onCopyFile?.();
                    setFileMenu(undefined);
                  }}
                >
                  Copy contents
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    props.onExportFile?.();
                    setFileMenu(undefined);
                  }}
                >
                  Export file…
                </button>
                {file.kind === "authored" ? (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setNaming({ path: file.path, initial: file.path });
                        setFileMenu(undefined);
                      }}
                    >
                      Rename…
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        props.onFileAction?.("delete", file.path);
                        setFileMenu(undefined);
                      }}
                    >
                      Delete…
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        props.onFileAction?.("entry", file.path);
                        setFileMenu(undefined);
                      }}
                    >
                      Use as run entry
                    </button>
                  </>
                ) : null}
                {file.dirty ? (
                  <button
                    role="menuitem"
                    onClick={() => {
                      props.onFileAction?.("discard", file.path);
                      setFileMenu(undefined);
                    }}
                  >
                    Discard draft
                  </button>
                ) : null}
                <button role="menuitem" onClick={() => setFileMenu(undefined)}>
                  Close menu
                </button>
              </div>
            ) : null}
          </li>
        ))}
    </ul>
  );
  return (
    <section
      className={`simulation-code-workspace${props.maximized ? " is-maximized" : ""}`}
      aria-label="Simulation Code workspace"
    >
      <header className="simulation-code-toolbar">
        <button
          type="button"
          aria-expanded={filesOpen}
          aria-controls={filesId}
          onClick={() => setFilesOpen(!filesOpen)}
        >
          Files
        </button>
        <div className="simulation-code-actions">{props.actions}</div>
        <div
          className="simulation-code-more"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setMoreOpen(false);
          }}
        >
          <button
            type="button"
            aria-label="More code actions"
            aria-expanded={moreOpen}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenuPosition({
                top: rect.bottom,
                right: Math.max(4, window.innerWidth - rect.right),
              });
              setMoreOpen(!moreOpen);
            }}
          >
            ···
          </button>
          {moreOpen ? (
            <div
              className="simulation-code-menu"
              style={menuPosition}
              onClick={() => setMoreOpen(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setMoreOpen(false);
              }}
            >
              <button type="button" onClick={() => openFile(props.configPath)}>
                Advanced configuration
              </button>
              {props.onCopyFile ? (
                <button
                  type="button"
                  onClick={() => {
                    props.onCopyFile?.();
                    setMoreOpen(false);
                  }}
                >
                  Copy current file
                </button>
              ) : null}
              {props.onExportFile ? (
                <button
                  type="button"
                  onClick={() => {
                    props.onExportFile?.();
                    setMoreOpen(false);
                  }}
                >
                  Export current file…
                </button>
              ) : null}
              {props.onNewFile ? (
                <button
                  type="button"
                  onClick={() => {
                    setFilesOpen(true);
                    setNaming({ initial: "untitled.spice" });
                    setMoreOpen(false);
                  }}
                >
                  New file…
                </button>
              ) : null}
              {props.additionalActions}
            </div>
          ) : null}
        </div>
      </header>
      <div className="simulation-code-source-area">
        {filesOpen ? (
          <aside
            id={filesId}
            className="simulation-code-files"
            aria-label="Simulation files"
          >
            {props.folders ? (
              <SimulationFolderTree {...props.folders}>
                {fileList()}
              </SimulationFolderTree>
            ) : (
              fileList()
            )}
          </aside>
        ) : null}
        <div className="simulation-code-document">
          <div
            className="simulation-code-tabs"
            role="tablist"
            aria-label="Open simulation files"
          >
            {tabs.map((path) => {
              const file = props.files.find((f) => f.path === path)!;
              return (
                <div className="simulation-code-tab" key={path}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={props.activePath === path}
                    onClick={() => props.onSelectFile(path)}
                    title={path}
                  >
                    {path === props.configPath
                      ? "Configuration"
                      : path.split("/").at(-1)}
                    {file.kind === "generated" ? " ◇" : ""}
                    {file.dirty ? " ●" : ""}
                  </button>
                  {path !== props.entryPath ? (
                    <button
                      type="button"
                      aria-label={`Close ${path}`}
                      onClick={() => closeFile(path)}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="simulation-code-document-content">
            {props.children}
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
            {(
              [
                "console",
                "plot",
                "operating-point",
                "compare",
                "files",
              ] as const
            ).map((pane) => (
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
                    files: "Files",
                  }[pane]
                }
              </button>
            ))}
          </div>
          <span className="simulation-code-output-spacer" />
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
