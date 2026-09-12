import { useState, type ReactNode } from "react";
import {
  useWorkspaceInteractions,
  WorkspaceNameInput,
  type WorkspaceMenuItem,
} from "./workspace-interactions";
export interface SimulationFolderNode {
  id: string;
  name: string;
  files?: readonly {
    path: string;
    kind: "authored" | "generated" | "prepared";
    dirty?: boolean;
    draft?: boolean;
  }[];
  configPath?: string;
}
export type FolderAction =
  "new" | "duplicate" | "rename" | "delete" | "run" | "export" | "batch";
export interface SimulationFolderTreeProps {
  folders: readonly SimulationFolderNode[];
  activeId: string;
  onSelect(id: string): void;
  onAction(action: FolderAction, ids: string[]): void;
  renderFiles(id: string): ReactNode;
  onNewFile(id: string): void;
  busy?: boolean;
}
/** Selection and expansion do not change execution context. Opening a file does. */
export function SimulationFolderTree(props: SimulationFolderTreeProps) {
  const ui = useWorkspaceInteractions();
  const [selected, setSelected] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const action = (name: FolderAction, ids: string[]) =>
    props.onAction(name, ids);
  const open = (x: number, y: number, id?: string) => {
    const ids = id
      ? selected.includes(id)
        ? selected.filter((key) => props.folders.some((f) => f.id === key))
        : [id]
      : [];
    setSelected(ids);
    const target = id ?? props.activeId;
    const items: WorkspaceMenuItem[] = [
      { label: "New experiment…", run: () => action("new", []) },
      {
        label: "New file…",
        disabled: !target,
        run: () => {
          setCollapsed(
            (set) => new Set([...set].filter((key) => key !== target)),
          );
          props.onNewFile(target);
        },
      },
    ];
    if (ids.length === 1)
      items.push(
        {
          label: "Run folder",
          disabled: props.busy,
          run: () => action("run", ids),
        },
        { label: "Duplicate…", run: () => action("duplicate", ids) },
        { label: "Rename…", run: () => action("rename", ids) },
        { label: "Export folder…", run: () => action("export", ids) },
        { label: "Delete…", run: () => action("delete", ids) },
      );
    if (ids.length > 1)
      items.push({
        label: `Run selected folders (${ids.length})`,
        disabled: props.busy,
        run: () => action("batch", ids),
      });
    items.push({
      label: "Collapse all",
      run: () => setCollapsed(new Set(props.folders.map((f) => f.id))),
    });
    ui.menu(x, y, items, "Folder actions");
  };
  const naming = ui.edit?.kind === "folder";
  return (
    <div
      className="simulation-folder-tree"
      aria-label="Simulation folders"
      onClick={(event) => {
        if (
          event.target === event.currentTarget ||
          (event.target instanceof Element &&
            event.target.closest('[data-tree-row="file"]'))
        )
          setSelected([]);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        open(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.target instanceof HTMLInputElement) return;
        if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
          const rows = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button[data-tree-row]",
            ),
          ];
          const current = rows.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? rows.length - 1
                : Math.max(
                    0,
                    Math.min(
                      rows.length - 1,
                      current + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
          event.preventDefault();
          rows[index]?.focus();
        }
      }}
    >
      <button
        type="button"
        data-workspace-new-folder="true"
        onClick={() => action("new", [])}
      >
        + New experiment
      </button>
      {naming && !ui.edit?.folderId ? (
        <WorkspaceNameInput key="new-folder" />
      ) : null}
      {props.folders.map((folder) => (
        <div key={folder.id}>
          {naming && ui.edit?.folderId === folder.id ? (
            <WorkspaceNameInput key={folder.id} />
          ) : (
            <div
              className="workspace-folder-row"
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                open(event.clientX, event.clientY, folder.id);
              }}
            >
              <button
                type="button"
                className="workspace-folder-toggle"
                aria-label={`Toggle ${folder.name}`}
                aria-expanded={!collapsed.has(folder.id)}
                onClick={() =>
                  setCollapsed((set) => {
                    const next = new Set(set);
                    if (next.has(folder.id)) next.delete(folder.id);
                    else next.add(folder.id);
                    return next;
                  })
                }
              >
                {collapsed.has(folder.id) ? "▸" : "▾"}
              </button>
              <button
                type="button"
                data-tree-row="folder"
                data-folder-id={folder.id}
                aria-label={`Folder ${folder.name}`}
                aria-pressed={selected.includes(folder.id)}
                title={
                  folder.id === props.activeId
                    ? `${folder.name} · Run target`
                    : folder.name
                }
                className={folder.id === props.activeId ? "is-active" : ""}
                onClick={(event) =>
                  setSelected((ids) =>
                    event.ctrlKey || event.metaKey
                      ? ids.includes(folder.id)
                        ? ids.filter((id) => id !== folder.id)
                        : [...ids, folder.id]
                      : [folder.id],
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    setCollapsed((set) => {
                      const next = new Set(set);
                      if (event.key === "ArrowLeft") next.add(folder.id);
                      else next.delete(folder.id);
                      return next;
                    });
                  }
                  if (event.key === "F2" || event.key === "Delete") {
                    event.preventDefault();
                    action(event.key === "F2" ? "rename" : "delete", [
                      folder.id,
                    ]);
                  }
                  if (
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  ) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    open(rect.left, rect.bottom, folder.id);
                  }
                }}
              >
                <span>{folder.name}</span>
                {folder.id === props.activeId ? (
                  <small className="simulation-run-target-badge">
                    Run target
                  </small>
                ) : null}
              </button>
            </div>
          )}
          {!collapsed.has(folder.id) ? props.renderFiles(folder.id) : null}
        </div>
      ))}
    </div>
  );
}
