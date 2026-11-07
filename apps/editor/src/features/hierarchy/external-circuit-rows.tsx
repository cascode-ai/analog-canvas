import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { CircuitProject } from "@icm/model";
import { ContextMenu } from "../../components/context-menu";
import { startCanvasDrag } from "../editor-shell/canvas-drag";
import { HierarchyIcon } from "./hierarchy-icons";

/** What the External circuits rows ask of the editor. */
export interface ExternalCircuitRowActions {
  /** Open a model's sheet: its source, Pins and symbol. */
  edit(definitionId: string): void;
  /** Start placing a model in the open Cell; false when it is refused. */
  place(definitionId: string): boolean;
  /** End a drag from a row: place under the pointer, or cancel off canvas. */
  drop(clientX: number, clientY: number): void;
  remove(definitionId: string): void;
  /** Open the Cell that places a model, with that part selected. */
  openCaller(documentId: string, instanceId: string): void;
  notice(message: string): void;
}

interface Caller {
  documentId: string;
  documentName: string;
  instanceId: string;
  reference: string;
}

/** Every part that places each external circuit, by definition. */
function externalCircuitCallers(
  project: CircuitProject,
): Map<string, Caller[]> {
  const callers = new Map<string, Caller[]>();
  for (const document of project.documents)
    for (const instance of document.instances) {
      const binding = instance.netlist?.binding;
      if (binding?.kind !== "external-subcircuit") continue;
      const list = callers.get(binding.definitionId) ?? [];
      list.push({
        documentId: document.id,
        documentName: document.name,
        instanceId: instance.id,
        reference: instance.reference ?? instance.id,
      });
      callers.set(binding.definitionId, list);
    }
  return callers;
}

/**
 * The Project's external circuits, as rows of the hierarchy panel: one per
 * model, worked on as a Cell's row is. Its name opens the model; the row's
 * icons place it or open it; dragging it onto the canvas places it; ×N lists
 * the parts that place it; right-click, the Menu key or Shift+F10 opens the
 * rest. Nothing shows while the Project has none.
 */
export function ExternalCircuitRows({
  project,
  activeName,
  query,
  actions,
}: {
  project: CircuitProject;
  /** The open Cell's name, where Place puts a model. */
  activeName: string;
  /** The panel's filter, lower case; only matching models show. */
  query: string;
  actions: ExternalCircuitRowActions;
}) {
  const [usesOf, setUsesOf] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    definitionId: string;
    x: number;
    y: number;
    fromKeyboard?: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const listRef = useRef<HTMLDivElement>(null);

  const callers = externalCircuitCallers(project);
  const definitions = project.externalSubcircuitDefinitions.filter(
    (definition) => definition.name.toLowerCase().includes(query),
  );
  if (!definitions.length) return null;

  const deleteRefusal = (definitionId: string) => {
    const first = callers.get(definitionId)?.[0];
    const name = project.externalSubcircuitDefinitions.find(
      (definition) => definition.id === definitionId,
    )?.name;
    return first
      ? `${name} is placed in ${first.documentName} as ${first.reference}; delete that part first`
      : undefined;
  };
  const remove = (definitionId: string) => {
    const refusal = deleteRefusal(definitionId);
    if (refusal) actions.notice(refusal);
    else actions.remove(definitionId);
  };
  const onKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    definitionId: string,
  ) => {
    const labels = [
      ...(listRef.current?.querySelectorAll<HTMLElement>(
        ".hierarchy-node-label",
      ) ?? []),
    ];
    const at = labels.indexOf(event.currentTarget);
    if (
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey)
    ) {
      const box = event.currentTarget.getBoundingClientRect();
      setMenu({
        definitionId,
        x: box.left + 24,
        y: box.bottom,
        fromKeyboard: true,
      });
    } else if (event.key === "ArrowDown") labels[at + 1]?.focus();
    else if (event.key === "ArrowUp") labels[at - 1]?.focus();
    else if (event.key === "Delete" || event.key === "Backspace")
      remove(definitionId);
    else return;
    event.preventDefault();
  };

  const menuItem = (label: string, run: () => void, refusal?: string) => (
    <button
      type="button"
      role="menuitem"
      disabled={Boolean(refusal)}
      onClick={() => {
        setMenu(null);
        run();
      }}
    >
      <span>
        {label}
        {refusal ? (
          <small className="hierarchy-menu-note">{refusal}</small>
        ) : null}
      </span>
    </button>
  );
  const menuDefinition = menu
    ? project.externalSubcircuitDefinitions.find(
        (definition) => definition.id === menu.definitionId,
      )
    : undefined;

  return (
    <div
      ref={listRef}
      className="hierarchy-externals"
      role="group"
      aria-label="External circuits"
    >
      <h3 className="hierarchy-group-label">External circuits</h3>
      {definitions.map((definition) => {
        const uses = callers.get(definition.id) ?? [];
        const listed = usesOf === definition.id;
        return (
          <div key={definition.id}>
            <div
              className="hierarchy-node"
              data-definition-id={definition.id}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({
                  definitionId: definition.id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <span className="hierarchy-expand" aria-hidden="true" />
              <button
                type="button"
                className="hierarchy-node-label"
                aria-label={`${definition.name}, external circuit`}
                onPointerDown={(event) =>
                  startCanvasDrag(event, {
                    begin: () => actionsRef.current.place(definition.id),
                    drop: (x, y) => actionsRef.current.drop(x, y),
                    suppressClick,
                  })
                }
                onClick={() => {
                  if (!suppressClick.current) actions.edit(definition.id);
                }}
                onKeyDown={(event) => onKeyDown(event, definition.id)}
              >
                <span className="hierarchy-ref">{definition.name}</span>
                <span className="hierarchy-cell">
                  {definition.terminals.length} Pins
                </span>
              </button>
              {uses.length ? (
                <button
                  type="button"
                  tabIndex={-1}
                  className="hierarchy-uses"
                  aria-expanded={listed}
                  aria-label={`${uses.length} ${uses.length === 1 ? "use" : "uses"} of ${definition.name}`}
                  onClick={() => setUsesOf(listed ? null : definition.id)}
                >
                  ×{uses.length}
                </button>
              ) : null}
              <span className="hierarchy-row-actions">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Place ${definition.name}`}
                  title={`Place ${definition.name} in ${activeName}, or drag the row onto the canvas`}
                  onClick={() => actions.place(definition.id)}
                >
                  <HierarchyIcon name="place" />
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`${definition.name} model`}
                  title={`${definition.name} model: source, Pins and symbol`}
                  onClick={() => actions.edit(definition.id)}
                >
                  <HierarchyIcon name="properties" />
                </button>
              </span>
            </div>
            {listed ? (
              <div
                className="hierarchy-inline-uses"
                role="group"
                aria-label={`Uses of ${definition.name}`}
                style={{ paddingLeft: 24 }}
              >
                {uses.map((use) => (
                  <button
                    key={`${use.documentId}:${use.instanceId}`}
                    type="button"
                    className="hierarchy-use"
                    onClick={() =>
                      actions.openCaller(use.documentId, use.instanceId)
                    }
                  >
                    {use.documentName} · {use.reference}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {menu && menuDefinition ? (
        <ContextMenu
          position={menu}
          label={`Actions for ${menuDefinition.name}`}
          testId="external-circuit-menu"
          className="hierarchy-context-menu"
          takeFocus={menu.fromKeyboard ?? false}
          onClose={() => setMenu(null)}
        >
          {menuItem("Edit model…", () => actions.edit(menuDefinition.id))}
          {menuItem(`Place in ${activeName}`, () =>
            actions.place(menuDefinition.id),
          )}
          {callers.get(menuDefinition.id)?.length
            ? menuItem(
                `Show ${callers.get(menuDefinition.id)?.length} uses`,
                () => setUsesOf(menuDefinition.id),
              )
            : null}
          <div className="hierarchy-context-divider" role="separator" />
          {menuItem(
            "Delete model",
            () => remove(menuDefinition.id),
            deleteRefusal(menuDefinition.id),
          )}
        </ContextMenu>
      ) : null}
    </div>
  );
}
