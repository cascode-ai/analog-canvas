import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type {
  SimulationCodeWorkspaceProps,
  SimulationExplorerSelection,
  SimulationCodeFile,
} from "./code-workspace";
import { simulationArtifactCategory } from "./simulation-artifact-files";
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

interface TreeNode {
  id: string;
  name: string;
  folderId: string;
  kind: "folder" | "directory" | "file" | "artifact";
  children?: TreeNode[];
  entry?: SimulationExplorerSelection;
  file?: SimulationCodeFile;
  expanded?: boolean;
  tmp?: boolean;
}
const collect = (node: TreeNode): SimulationExplorerSelection[] =>
  node.entry ? [node.entry] : (node.children ?? []).flatMap(collect);

/** One selection owner for directories, source and immutable execution files. */
export function SimulationFileTree(props: SimulationCodeWorkspaceProps) {
  const ui = useWorkspaceInteractions();
  const anchor = useRef<string | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const folders = props.folders?.folders ?? [
    { id: props.workspaceKey, name: props.workspaceKey, files: props.files },
  ];
  const activeId = props.folders?.activeId ?? props.workspaceKey;
  useEffect(() => {
    if (!props.activePath) {
      setSelected([]);
      return;
    }
    setSelected([activeId + "/file/" + props.activePath]);
    const parts = props.activePath.split("/").slice(0, -1);
    setExpanded((state) => {
      const next = { ...state, [activeId]: true, [activeId + "/source"]: true };
      let path = activeId + "/source";
      for (const part of parts) {
        path += "/" + part;
        next[path] = true;
      }
      return next;
    });
  }, [activeId, props.activePath]);
  const nodes: TreeNode[] = folders.map((folder) => {
    const files = folder.id === activeId ? props.files : (folder.files ?? []);
    const source: TreeNode = {
      id: folder.id + "/source",
      name: "Source",
      folderId: folder.id,
      kind: "directory",
      children: [],
      expanded: true,
    };
    for (const file of files) {
      let parent = source;
      const parts = file.path.split("/");
      for (const part of parts.slice(0, -1)) {
        const id = parent.id + "/" + part;
        let child = parent.children!.find(
          (node) => node.id === id && node.children,
        );
        if (!child) {
          child = {
            id,
            name: part,
            folderId: folder.id,
            kind: "directory",
            children: [],
          };
          parent.children!.push(child);
        }
        parent = child;
      }
      parent.children!.push({
        id: folder.id + "/file/" + file.path,
        name: parts.at(-1)!,
        folderId: folder.id,
        kind: "file",
        file,
        entry: { kind: "source", folderId: folder.id, path: file.path },
      });
    }
    const children = [source];
    if (folder.id === activeId)
      for (const group of props.artifactGroups ?? []) {
        const directory: TreeNode = {
          id: folder.id + "/" + group.key,
          name: group.label,
          folderId: folder.id,
          kind: "directory",
          children: [],
          tmp: true,
        };
        for (const artifact of group.artifacts) {
          const category = simulationArtifactCategory(artifact);
          let categoryNode = directory.children!.find(
            (node) => node.name === category,
          );
          if (!categoryNode) {
            categoryNode = {
              id: directory.id + "/" + category,
              name: category,
              folderId: folder.id,
              kind: "directory",
              children: [],
            };
            directory.children!.push(categoryNode);
          }
          categoryNode.children!.push({
            id: folder.id + "/" + group.key + "/" + artifact.id,
            name: artifact.name,
            folderId: folder.id,
            kind: "artifact",
            entry: { kind: "artifact", groupKey: group.key, artifact },
          });
        }
        children.push(directory);
      }
    return {
      id: folder.id,
      name: folder.name,
      folderId: folder.id,
      kind: "folder",
      children,
      expanded: true,
    };
  });
  const all = new Map<string, TreeNode>();
  const visit = (items: TreeNode[]) =>
    items.forEach((node) => {
      all.set(node.id, node);
      if (node.children) {
        if (node.kind !== "folder")
          node.children.sort(
            (a, b) =>
              Number(Boolean(b.children)) - Number(Boolean(a.children)) ||
              a.name.localeCompare(b.name),
          );
        visit(node.children);
      }
    });
  visit(nodes);
  const isOpen = (node: TreeNode) =>
    expanded[node.id] ?? node.expanded ?? false;
  const visible: TreeNode[] = [];
  const flatten = (items: TreeNode[]) =>
    items.forEach((node) => {
      visible.push(node);
      if (node.children && isOpen(node)) flatten(node.children);
    });
  flatten(nodes);
  const validSelection = selected.filter((id) => all.has(id));
  const choose = (
    node: TreeNode,
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => {
    if (event.shiftKey && anchor.current) {
      const start = visible.findIndex((item) => item.id === anchor.current);
      const end = visible.indexOf(node);
      if (start >= 0) {
        const range = visible
          .slice(Math.min(start, end), Math.max(start, end) + 1)
          .map((item) => item.id);
        setSelected(
          event.ctrlKey || event.metaKey
            ? [...new Set([...validSelection, ...range])]
            : range,
        );
        return;
      }
    }
    anchor.current = node.id;
    setSelected(
      event.ctrlKey || event.metaKey
        ? validSelection.includes(node.id)
          ? validSelection.filter((id) => id !== node.id)
          : [...validSelection, node.id]
        : [node.id],
    );
  };
  const toggle = (node: TreeNode, open = !isOpen(node)) =>
    setExpanded((state) => ({ ...state, [node.id]: open }));
  const openFile = (node: TreeNode) => {
    if (node.entry?.kind === "source") {
      props.onCloseArtifact?.();
      props.onSelectFile(node.entry.path, node.folderId);
    } else if (node.entry?.kind === "artifact")
      props.onSelectArtifact?.(node.entry.artifact);
  };
  const menu = (node: TreeNode | undefined, x: number, y: number) => {
    const ids = node
      ? validSelection.includes(node.id)
        ? validSelection
        : [node.id]
      : [];
    setSelected(ids);
    const targets = ids.map((id) => all.get(id)!);
    const entries = [
      ...new Map(
        targets
          .flatMap(collect)
          .map((entry) => [
            entry.kind === "source"
              ? "source/" + entry.folderId + "/" + entry.path
              : "artifact/" + entry.artifact.id,
            entry,
          ]),
      ).values(),
    ];
    const items: WorkspaceMenuItem[] = [];
    if (entries.length)
      items.push({
        label:
          targets.length > 1
            ? "Download selected (" + targets.length + ")…"
            : "Download…",
        disabled: !props.onDownloadSelection,
        run: () =>
          props.onDownloadSelection?.(
            entries,
            targets.some((target) => Boolean(target.children)),
          ),
      });
    if (targets.length === 1 && node?.file) {
      items.push(
        { label: "Open", run: () => openFile(node) },
        {
          label: "Copy contents",
          run: () => props.onCopyFile?.(node.file!.path, node.folderId),
        },
      );
      if (node.file.kind === "authored")
        for (const [action, label] of [
          ["rename", "Rename…"],
          ["delete", "Delete…"],
          ["entry", "Use as run entry"],
        ] as const)
          items.push({
            label,
            run: () =>
              props.onFileAction?.(action, node.file!.path, node.folderId),
          });
      if (node.file.draft)
        items.push({
          label: "Discard draft",
          run: () =>
            props.onFileAction?.("discard", node.file!.path, node.folderId),
        });
    }
    if (props.folders) {
      if (
        targets.length <= 1 &&
        (!node || node.kind === "folder" || node.id.includes("/source"))
      ) {
        items.push({
          label: "New file…",
          run: () => {
            const id = node?.folderId ?? activeId;
            setExpanded((state) => ({
              ...state,
              [id]: true,
              [id + "/source"]: true,
            }));
            props.onNewFile?.(id);
          },
        });
      }
      if (targets.length === 1 && node?.kind === "folder")
        for (const [action, label] of [
          ["run", "Run folder"],
          ["duplicate", "Duplicate…"],
          ["rename", "Rename…"],
          ["delete", "Delete…"],
        ] as const)
          items.push({
            label,
            disabled: action === "run" && props.folders.busy,
            run: () => props.folders?.onAction(action, [node.folderId]),
          });
      if (targets.length > 1 && targets.every((item) => item.kind === "folder"))
        items.push({
          label: "Run selected folders (" + targets.length + ")",
          disabled: props.folders.busy,
          run: () => props.folders?.onAction("batch", ids),
        });
      items.push({
        label: "New experiment…",
        run: () => props.folders?.onAction("new", []),
      });
    }
    items.push({
      label: "Collapse all",
      run: () =>
        setExpanded(
          Object.fromEntries([...all.keys()].map((id) => [id, false])),
        ),
    });
    ui.menu(
      x,
      y,
      items,
      node?.file ? "Actions for " + node.file.path : "Folder actions",
    );
  };
  const render = (node: TreeNode, level: number): ReactNode => {
    const naming =
      ui.edit?.folderId === node.folderId &&
      (node.kind === "folder"
        ? ui.edit.kind === "folder"
        : node.file &&
          ui.edit.kind === "file" &&
          ui.edit.path === node.file.path);
    const active =
      node.entry?.kind === "source"
        ? node.folderId === activeId &&
          node.entry.path === props.activePath &&
          !props.artifactPreview
        : node.entry?.kind === "artifact" &&
          node.entry.artifact.id === props.artifactPreview?.artifact.id;
    return (
      <div
        key={node.id}
        className="simulation-tree-node"
        role="none"
        aria-label={node.tmp ? node.name + " temporary files" : undefined}
      >
        <div
          className={
            "simulation-tree-row" +
            (validSelection.includes(node.id) ? " is-selected" : "") +
            (active ? " is-active" : "")
          }
          style={{ "--tree-depth": level } as CSSProperties}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            menu(node, event.clientX, event.clientY);
          }}
        >
          {node.children ? (
            <button
              type="button"
              className="simulation-tree-chevron"
              tabIndex={-1}
              aria-label={"Toggle " + node.name}
              aria-expanded={isOpen(node)}
              onClick={(event) => {
                event.stopPropagation();
                toggle(node);
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d={isOpen(node) ? "m4 6 4 4 4-4" : "m6 4 4 4-4 4"} />
              </svg>
            </button>
          ) : (
            <span className="simulation-tree-chevron" />
          )}
          {naming ? (
            <WorkspaceNameInput />
          ) : (
            <button
              type="button"
              role="treeitem"
              aria-level={level + 1}
              aria-selected={validSelection.includes(node.id)}
              aria-expanded={node.children ? isOpen(node) : undefined}
              data-tree-row={node.kind}
              data-node-id={node.id}
              data-folder-id={node.folderId}
              data-file-path={node.file?.path}
              aria-label={
                node.kind === "folder" ? "Folder " + node.name : node.name
              }
              aria-current={active ? "page" : undefined}
              title={node.file?.path ?? node.name}
              onClick={(event) => {
                choose(node, event);
                if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
                  if (node.children) toggle(node);
                  else openFile(node);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  if (node.children) toggle(node, event.key === "ArrowRight");
                }
                if (event.key === "F2" || event.key === "Delete") {
                  event.preventDefault();
                  if (node.kind === "folder")
                    props.folders?.onAction(
                      event.key === "F2" ? "rename" : "delete",
                      [node.folderId],
                    );
                  else if (node.file?.kind === "authored")
                    props.onFileAction?.(
                      event.key === "F2" ? "rename" : "delete",
                      node.file.path,
                      node.folderId,
                    );
                }
                if (
                  event.key === "ContextMenu" ||
                  (event.shiftKey && event.key === "F10")
                ) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  menu(node, rect.left, rect.bottom);
                }
              }}
            >
              <span className="simulation-tree-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16">
                  <path
                    d={
                      node.children
                        ? "M2 4h4l2 2h6v7H2z"
                        : node.file?.kind === "generated"
                          ? "m8 2 5 6-5 6-5-6z"
                          : "M4 2h5l3 3v9H4z M9 2v4h3"
                    }
                  />
                </svg>
              </span>
              <span className="simulation-file-name">{node.name}</span>
              {node.tmp ? <small>tmp</small> : null}
              {node.file?.dirty ? (
                <span className="simulation-file-state" title="Unsaved">
                  ●
                </span>
              ) : node.file?.draft ? (
                <span className="simulation-file-state" title="Saved draft">
                  ◌
                </span>
              ) : null}
            </button>
          )}
        </div>
        {node.children && isOpen(node) ? (
          <div role="group" aria-label={node.name + " files"}>
            {node.id.endsWith("/source") &&
            ui.edit?.kind === "file" &&
            ui.edit.folderId === node.folderId &&
            !ui.edit.path ? (
              <div
                className="simulation-tree-row"
                style={{ "--tree-depth": level + 1 } as CSSProperties}
              >
                <WorkspaceNameInput />
              </div>
            ) : null}
            {node.children.map((child) => render(child, level + 1))}
          </div>
        ) : null}
      </div>
    );
  };
  return (
    <div
      className="simulation-folder-tree"
      role="tree"
      aria-label="Simulation folders"
      aria-multiselectable="true"
      onContextMenu={(event) => {
        event.preventDefault();
        menu(undefined, event.clientX, event.clientY);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) setSelected([]);
      }}
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          ["s", "w"].includes(event.key.toLowerCase())
        )
          return;
        event.stopPropagation();
        if (event.target instanceof HTMLInputElement) return;
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "a"
        ) {
          event.preventDefault();
          setSelected(visible.map((node) => node.id));
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSelected([]);
        }
        if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const rows = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "[data-node-id]",
            ),
          ];
          const index = rows.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? rows.length - 1
                : Math.max(
                    0,
                    Math.min(
                      rows.length - 1,
                      index + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
          rows[next]?.focus();
          const node = all.get(rows[next]?.dataset.nodeId ?? "");
          if (node) choose(node, event);
        }
      }}
    >
      {props.folders ? (
        <button
          type="button"
          data-workspace-new-folder="true"
          onClick={() => props.folders?.onAction("new", [])}
        >
          + New experiment
        </button>
      ) : null}
      {ui.edit?.kind === "folder" && !ui.edit.folderId ? (
        <WorkspaceNameInput />
      ) : null}
      {nodes.map((node) => render(node, 0))}
    </div>
  );
}
