import { useEffect, useRef, useState, type ReactNode } from "react";
import { InlineSourceName } from "./inline-source-name";

export interface SimulationFolderNode {
  id: string;
  name: string;
  paths?: readonly string[];
}
export type FolderAction =
  "new" | "duplicate" | "rename" | "delete" | "run" | "export" | "batch";
export interface SimulationFolderTreeProps {
  folders: readonly SimulationFolderNode[];
  activeId: string;
  onSelect(id: string, path?: string): void;
  onAction(action: FolderAction, ids: string[], name?: string): void;
  onNewFile?(id: string): void;
  children: ReactNode;
  busy?: boolean;
}

/** One execution root per folder. The tree owns selection, never source or run state. */
export function SimulationFolderTree(props: SimulationFolderTreeProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([props.activeId]);
  const [naming, setNaming] = useState<{
    action: "new" | "rename" | "duplicate";
    ids: string[];
    initial: string;
  }>();
  useEffect(() => {
    setExpanded((ids) =>
      ids.includes(props.activeId) ? ids : [...ids, props.activeId],
    );
  }, [props.activeId]);
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] }>();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSelected((ids) =>
      ids.filter((id) => props.folders.some((folder) => folder.id === id)),
    );
  }, [props.folders]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(undefined);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);
  const open = (x: number, y: number, id?: string) => {
    const ids = id ? (selected.includes(id) ? selected : [id]) : [];
    setSelected(ids);
    setMenu({
      x: Math.max(0, Math.min(x, window.innerWidth - 210)),
      y: Math.max(0, Math.min(y, window.innerHeight - 280)),
      ids,
    });
  };
  const action = (name: FolderAction, ids = menu?.ids ?? []) => {
    if (name === "new" || name === "rename" || name === "duplicate") {
      const folder = props.folders.find((f) => f.id === ids[0]);
      setNaming({
        action: name,
        ids,
        initial:
          name === "new"
            ? "Untitled"
            : `${folder?.name ?? "Untitled"}${name === "duplicate" ? " copy" : ""}`,
      });
    } else props.onAction(name, ids);
    setMenu(undefined);
  };
  return (
    <div
      className="simulation-folder-tree"
      aria-label="Simulation folders"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        open(event.clientX, event.clientY);
      }}
    >
      {naming && (
        <InlineSourceName
          label="Folder name"
          initial={naming.initial}
          onCancel={() => setNaming(undefined)}
          onSubmit={(name) => {
            props.onAction(naming.action, naming.ids, name);
            setNaming(undefined);
          }}
        />
      )}
      {props.folders.map((folder) => (
        <div key={folder.id}>
          <div
            className="simulation-folder-row"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              open(event.clientX, event.clientY, folder.id);
            }}
          >
            <button
              type="button"
              aria-label={`Toggle ${folder.name}`}
              aria-expanded={expanded.includes(folder.id)}
              onClick={() =>
                setExpanded((ids) =>
                  ids.includes(folder.id)
                    ? ids.filter((id) => id !== folder.id)
                    : [...ids, folder.id],
                )
              }
            >
              {expanded.includes(folder.id) ? "▾" : "▸"}
            </button>
            <button
              type="button"
              className={folder.id === props.activeId ? "is-active" : ""}
              aria-label={`Folder ${folder.name}`}
              aria-pressed={selected.includes(folder.id)}
              onClick={(event) => {
                if (event.ctrlKey || event.metaKey)
                  setSelected((ids) =>
                    ids.includes(folder.id)
                      ? ids.filter((id) => id !== folder.id)
                      : [...ids, folder.id],
                  );
                else {
                  setSelected([folder.id]);
                  props.onSelect(folder.id);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                open(event.clientX, event.clientY, folder.id);
              }}
              onKeyDown={(event) => {
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
              {folder.name}
            </button>
          </div>
          {expanded.includes(folder.id) ? (
            folder.id === props.activeId ? (
              props.children
            ) : (
              <ul>
                {folder.paths?.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      onClick={() => props.onSelect(folder.id, path)}
                    >
                      {path}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ))}
      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Folder actions"
          className="simulation-folder-menu"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setMenu(undefined);
            }
          }}
        >
          <button role="menuitem" onClick={() => action("new", [])}>
            New folder…
          </button>
          {menu.ids.length === 1 ? (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  props.onSelect(menu.ids[0]!);
                  props.onNewFile?.(menu.ids[0]!);
                  setMenu(undefined);
                }}
              >
                New file…
              </button>
              <button
                role="menuitem"
                disabled={props.busy}
                onClick={() => action("run")}
              >
                Run folder
              </button>
              <button role="menuitem" onClick={() => action("duplicate")}>
                Duplicate…
              </button>
              <button role="menuitem" onClick={() => action("rename")}>
                Rename…
              </button>
              <button role="menuitem" onClick={() => action("export")}>
                Export folder…
              </button>
              <button role="menuitem" onClick={() => action("delete")}>
                Delete…
              </button>
            </>
          ) : null}
          {menu.ids.length > 1 ? (
            <button
              role="menuitem"
              disabled={props.busy}
              onClick={() => action("batch")}
            >
              Run selected folders ({menu.ids.length})
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
