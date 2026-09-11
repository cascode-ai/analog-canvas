import { useEffect, useRef, useState, type ReactNode } from "react";

export interface SimulationFolderNode {
  id: string;
  name: string;
}
export type FolderAction =
  "new" | "duplicate" | "rename" | "delete" | "run" | "export" | "batch";
export interface SimulationFolderTreeProps {
  folders: readonly SimulationFolderNode[];
  activeId: string;
  onSelect(id: string): void;
  onAction(action: FolderAction, ids: string[]): void;
  children: ReactNode;
  busy?: boolean;
}

/** One execution root per folder. The tree owns selection, never source or run state. */
export function SimulationFolderTree(props: SimulationFolderTreeProps) {
  const [selected, setSelected] = useState<string[]>([]);
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
    props.onAction(name, ids);
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
      <button type="button" onClick={() => props.onAction("new", [])}>
        + New folder…
      </button>
      {props.folders.map((folder) => (
        <div key={folder.id}>
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
            {folder.id === props.activeId ? "▾" : "▸"} {folder.name}
          </button>
          {folder.id === props.activeId ? props.children : null}
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
          <button role="menuitem" onClick={() => action("new", ["op"])}>
            New OP folder…
          </button>
          <button role="menuitem" onClick={() => action("new", ["ac"])}>
            New AC folder…
          </button>
          <button role="menuitem" onClick={() => action("new", ["tran"])}>
            New transient folder…
          </button>
          {menu.ids.length === 1 ? (
            <>
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
