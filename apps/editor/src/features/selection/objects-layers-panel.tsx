import { useMemo, useRef, useState, type DragEvent } from "react";
import type {
  ResolvedDocumentLogicalNets,
  ResolvedDrawingScene,
} from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import {
  drawingOrderKey,
  type DrawingObjectEntry,
  type DrawingOrderEntry,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { ToolIcon } from "../editor-shell/tool-icon";

import type { EditorCommandRouter } from "../../commands/editor-command";
import { drawingLayerRows, type DrawingLayerRow } from "./drawing-layer-rows";
import {
  DRAWING_ORDER_ACTIONS,
  drawingDragIncludes,
  selectedDrawingObjectIds,
  selectionForDrawingLayer,
  type DrawingDragRevision,
} from "./drawing-order-actions";
import type { SelectionPolicy } from "./selection-filter";
import type { VisualSelection } from "./visual-selection";

interface ObjectsLayersPanelProps {
  document: SchematicDocument;
  scene: ResolvedDrawingScene;
  resolver: SymbolResolver;
  logicalNets: ResolvedDocumentLogicalNets;
  open: boolean;
  selection: VisualSelection;
  selectionPolicy: SelectionPolicy;
  commands: EditorCommandRouter;
  revision: DrawingDragRevision;
  endpoints: readonly WireSource[];
  wireActive: boolean;
  wireHasSource: boolean;
  objectActionsEnabled: boolean;
  onSelect(entry: DrawingObjectEntry, additive: boolean): void;
  onLocate(entry: DrawingObjectEntry): void;
  onEditText(entry: DrawingObjectEntry): void;
  onFormula(instanceId: string): void;
  onPin(source: WireSource): void;
}

export function ObjectsLayersPanel({
  document,
  scene,
  resolver,
  logicalNets,
  open,
  selection,
  selectionPolicy,
  commands,
  revision,
  endpoints,
  wireActive,
  wireHasSource,
  objectActionsEnabled,
  onSelect,
  onLocate,
  onEditText,
  onFormula,
  onPin,
}: ObjectsLayersPanelProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const drag = useRef<{
    objectIds: string[];
    expected: DrawingDragRevision;
  } | null>(null);
  const [drop, setDrop] = useState<{
    key: string;
    kind: "after" | "before";
  } | null>(null);
  const rows = useMemo(
    () =>
      open ? drawingLayerRows(document, scene, resolver, logicalNets) : [],
    [document, scene, resolver, logicalNets, open],
  );
  const selected = new Set([
    ...selection.instanceIds,
    ...selection.annotationIds,
    ...selection.draftingIds,
  ]);
  const pinsByInstance = useMemo(() => {
    const pins = new Map<string, { label: string; source: WireSource }[]>();
    if (!open) return pins;
    for (const source of endpoints) {
      const endpoint = source.endpoint;
      if (endpoint.kind !== "terminal") continue;
      const pin = { label: endpoint.pinName, source };
      const existing = pins.get(endpoint.instanceId);
      if (existing) existing.push(pin);
      else pins.set(endpoint.instanceId, [pin]);
    }
    return pins;
  }, [endpoints, open]);
  function toggleExpanded(key: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }
  function clearDrag(): void {
    drag.current = null;
    setDrop(null);
  }
  function startDrag(event: DragEvent, entry: DrawingObjectEntry): void {
    const selectedObjects = selected.has(entry.id)
      ? selection
      : selectionForDrawingLayer(
          document,
          selectionPolicy,
          entry,
          selection,
          false,
        );
    const objectIds = selectedDrawingObjectIds(document, selectedObjects);
    if (
      !objectIds.length ||
      !commands.state({
        id: "selection.reorder",
        position: { kind: "front" },
        drag: { objectIds, expected: revision },
      }).enabled
    ) {
      event.preventDefault();
      return;
    }
    drag.current = { objectIds, expected: revision };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-icm-drawing-order", entry.id);
    if (!selected.has(entry.id)) onSelect(entry, false);
  }
  function positionAt(event: DragEvent, target: DrawingOrderEntry) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const kind =
      event.clientY < bounds.top + bounds.height / 2 ? "after" : "before";
    return { kind, target } as const;
  }
  function allowDrop(entry: DrawingOrderEntry): boolean {
    return Boolean(
      drag.current &&
      (!("id" in entry) ||
        !drawingDragIncludes(document, drag.current.objectIds, entry)),
    );
  }
  function objectButton(row: DrawingLayerRow, isDraggable = false) {
    const entry = row.entry;
    if (!("id" in entry))
      return <span className="objects-layer-name">{row.label}</span>;
    const allowed =
      objectActionsEnabled && selectionPolicy.allowsCanvasHit(entry, "select");
    return (
      <button
        type="button"
        className="objects-layer-select"
        aria-label={row.detail ? row.detail + " " + row.label : row.label}
        aria-pressed={selected.has(entry.id)}
        disabled={!allowed}
        draggable={allowed && isDraggable}
        title={row.label}
        onClick={(event) =>
          onSelect(entry, event.shiftKey || event.ctrlKey || event.metaKey)
        }
        onDoubleClick={() => onEditText(entry)}
        onDragStart={
          isDraggable ? (event) => startDrag(event, entry) : undefined
        }
      >
        {row.detail ? <small>{row.detail}</small> : null}
        <span className="objects-layer-name">{row.label}</span>
        {row.ownerLabel && row.ownerLabel !== row.label ? (
          <small>{row.ownerLabel}</small>
        ) : null}
      </button>
    );
  }
  function locateButton(row: DrawingLayerRow) {
    const entry = row.entry;
    if (!("id" in entry)) return null;
    const label = "Locate " + (row.detail ? row.detail + " " : "") + row.label;
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        className="objects-layer-locate"
        disabled={
          !objectActionsEnabled ||
          !selectionPolicy.allowsCanvasHit(entry, "select")
        }
        onClick={() => onLocate(entry)}
      >
        <ToolIcon name="fit" />
      </button>
    );
  }

  return (
    <aside
      id="objects-layers-panel"
      className="shapes-panel objects-layers-panel"
      aria-label="Objects & layers"
      hidden={!open}
      data-plain-keys="local"
    >
      <header className="objects-layers-header">
        <h2>Objects &amp; layers</h2>
        <span title={document.name}>{document.name}</span>
        <div
          className="objects-layer-actions"
          role="group"
          aria-label="Drawing order"
        >
          {DRAWING_ORDER_ACTIONS.map(({ kind, label, key, icon }) => {
            const command = {
              id: "selection.reorder",
              position: { kind },
            } as const;
            return (
              <button
                key={kind}
                type="button"
                aria-label={label}
                aria-keyshortcuts={"Alt+Shift+" + key}
                title={label}
                disabled={!commands.state(command).enabled}
                onClick={() => commands.execute(command)}
              >
                {icon}
              </button>
            );
          })}
        </div>
      </header>
      <ol
        className="objects-layers-list"
        aria-label="Front to back"
        role="list"
        onDragEnd={clearDrag}
        onDragLeave={(event) => {
          if (!(
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          ))
            setDrop(null);
        }}
      >
        {rows.map((row) => {
          const key = drawingOrderKey(row.entry);
          const entry = row.entry;
          const pins =
            entry.kind === "instance"
              ? pinsByInstance.get(entry.id)
              : undefined;
          const hasChildren =
            row.formula ||
            row.attached?.length ||
            row.separate?.length ||
            pins?.length;
          const isExpanded = expanded.has(key);
          return (
            <li
              key={key}
              className="objects-layer"
              data-selected={"id" in entry && selected.has(entry.id)}
            >
              <div
                className="objects-layer-summary"
                data-drop={drop?.key === key ? drop.kind : undefined}
                onDragOver={(event) => {
                  if (!allowDrop(entry)) {
                    setDrop(null);
                    return;
                  }
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDrop({ key, kind: positionAt(event, entry).kind });
                }}
                onDrop={(event) => {
                  const started = drag.current;
                  if (!started || !allowDrop(entry)) return;
                  event.preventDefault();
                  const position = positionAt(event, entry);
                  clearDrag();
                  commands.execute({
                    id: "selection.reorder",
                    position,
                    drag: started,
                  });
                }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className="objects-layer-disclosure"
                    aria-expanded={isExpanded}
                    aria-label={
                      (isExpanded ? "Collapse " : "Expand ") + row.label
                    }
                    onClick={() => toggleExpanded(key)}
                  >
                    {isExpanded ? "▾" : "▸"}
                  </button>
                ) : null}
                {objectButton(row, true)}
                {locateButton(row)}
              </div>
              {isExpanded && entry.kind === "instance" ? (
                <div
                  className="objects-layer-children"
                  role="group"
                  aria-label={row.label + " contents"}
                >
                  {row.formula ? (
                    <button
                      type="button"
                      className="objects-layer-select"
                      disabled={
                        !objectActionsEnabled ||
                        !selectionPolicy.allowsCanvasHit(entry, "edit")
                      }
                      onClick={() => onFormula(entry.id)}
                    >
                      Formula
                    </button>
                  ) : null}
                  {row.attached?.map((child) => (
                    <div
                      className="objects-layer-summary"
                      key={drawingOrderKey(child.entry)}
                    >
                      {objectButton(child)}
                      {locateButton(child)}
                    </div>
                  ))}
                  {row.separate?.map((child) => (
                    <div
                      className="objects-layer-summary"
                      key={drawingOrderKey(child.entry)}
                    >
                      {objectButton(child)}
                      <small>Drawn separately</small>
                      {locateButton(child)}
                    </div>
                  ))}
                  {pins?.map(({ label, source }) => (
                    <button
                      key={label}
                      type="button"
                      className="objects-layer-select"
                      aria-label={
                        (wireActive
                          ? wireHasSource
                            ? "Connect to pin "
                            : "Start wire at pin "
                          : "Pin ") + label
                      }
                      disabled={
                        !wireActive &&
                        (!objectActionsEnabled ||
                          !selectionPolicy.allowsEndpoint("terminal", "select"))
                      }
                      onClick={() => onPin(source)}
                    >
                      <small>Pin</small>
                      <span className="objects-layer-name">{label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
