import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import { cellParameterCallers, cellParameterUsage } from "@icm/edit-engine";
import { buildProjectHierarchy } from "@icm/derived";
import {
  projectCellInterface,
  type CellPortDirection,
  type CircuitProject,
  type ProjectedFormalCellPort,
  type SchematicDocument,
} from "@icm/model";
import { designNetlistCellPorts } from "@icm/netlist";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalBlockBodySize,
  hierarchicalSymbolId,
} from "@icm/symbols";

import { SymbolArtwork } from "../component-insert/symbol-artwork";
import {
  localBlockSymbolTarget,
  type BlockSymbolLayoutTarget,
} from "./block-symbol-layout-target";
import type {
  CellParameterChange,
  ExternalDefinitionResult,
} from "./project-structure-commands";

type Direction = CellPortDirection;
type PinSide = "north" | "east" | "south" | "west" | "auto";
type Parameter = NonNullable<
  SchematicDocument["netlist"]
>["formalParameters"][number];

const DIRECTIONS: ReadonlyArray<readonly [Direction, string]> = [
  ["input", "Input"],
  ["output", "Output"],
  ["inout", "Inout"],
  ["passive", "Passive"],
];
const SIDES: ReadonlyArray<readonly [PinSide, string]> = [
  ["auto", "Auto"],
  ["west", "Left"],
  ["east", "Right"],
  ["north", "Top"],
  ["south", "Bottom"],
];

export interface CellPropertiesDialogProps {
  project: CircuitProject;
  cellId: string;
  onClose(): void;
  /** Make this Cell the Project's Top (default entry). */
  onSetTop(cellId: string): void;
  /** Opens the Cell's Symbol view (custom artwork). */
  onCustomizeSymbol?(cellId: string): void;
  onRename(cellId: string, name: string): void;
  onRenamePin(cellId: string, terminalId: string, name: string): void;
  onSetPinDirection(cellId: string, portId: string, direction: Direction): void;
  /** Move a Pin up or down past another, swapping the two. */
  onMovePin(cellId: string, portId: string, otherPortId: string): void;
  onEditParameter(
    cellId: string,
    name: string,
    change: CellParameterChange,
  ): ExternalDefinitionResult;
  onSymbolSizeChange(
    target: BlockSymbolLayoutTarget,
    width: number,
    height: number,
  ): void;
  onPinSideChange(
    target: BlockSymbolLayoutTarget,
    terminalId: string,
    side: PinSide,
    offset: number,
  ): void;
}

type PinRow =
  | {
      kind: "pin";
      port: ProjectedFormalCellPort;
      /** A supply, which the netlist lists first: its place is fixed. */
      supply: boolean;
      /** The Pins it trades places with, moved up or down. */
      up?: string | undefined;
      down?: string | undefined;
    }
  | { kind: "added"; name: string };

/**
 * The Pins table in netlist order (#2177): the supplies first, where the
 * export puts them, then the signals in the Cell's own order, and the pins
 * the export adds (ground's, a default supply) where it writes them. A
 * signal moves past the signal beside it; a supply stays. Until every Pin
 * exports, the Cell's own order alone, each Pin movable.
 */
function cellPinRows(
  ports: readonly ProjectedFormalCellPort[],
  exported: readonly { id: string; name: string; supply: boolean }[] | null,
): PinRow[] {
  let rows: PinRow[] = ports.map((port) => ({
    kind: "pin" as const,
    port,
    supply: false,
  }));
  if (exported) {
    const listed: PinRow[] = [];
    const seen = new Set<number>();
    for (const item of exported) {
      const index = ports.findIndex((port) => port.netIds.includes(item.id));
      if (index < 0) listed.push({ kind: "added", name: item.name });
      else if (!seen.has(index)) {
        seen.add(index);
        listed.push({ kind: "pin", port: ports[index]!, supply: item.supply });
      }
    }
    if (seen.size === ports.length) rows = listed;
  }
  const movable = rows.filter(
    (row): row is Extract<PinRow, { kind: "pin" }> =>
      row.kind === "pin" && !row.supply,
  );
  movable.forEach((row, index) => {
    row.up = movable[index - 1]?.port.id;
    row.down = movable[index + 1]?.port.id;
  });
  return rows;
}

/**
 * A text field that shows the stored value until it is edited, commits on
 * Enter or leaving, and reverts on Escape. A refused commit shows the stored
 * value again, so the field never pretends an edit took effect.
 */
function CommitField({
  value,
  onCommit,
  ...input
}: {
  value: string;
  onCommit(next: string): void;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "onBlur" | "onFocus" | "onKeyDown"
>) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <input
      autoComplete="off"
      spellCheck={false}
      {...input}
      value={draft ?? value}
      onFocus={() => {
        cancelled.current = false;
        setDraft(value);
      }}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={(event) => {
        const next = event.currentTarget.value;
        setDraft(null);
        if (!cancelled.current && next !== value) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "Escape") return;
        // Leave the field, not the dialog: focus returns to the dialog, so a
        // second Escape closes it. Leaving commits unless it was Escape.
        event.preventDefault();
        event.stopPropagation();
        cancelled.current = event.key === "Escape";
        const dialog =
          event.currentTarget.closest<HTMLElement>('[role="dialog"]');
        if (dialog) dialog.focus();
        else event.currentTarget.blur();
      }}
    />
  );
}

function ParameterRow({
  parameter,
  cell,
  project,
  onEdit,
}: {
  parameter: Parameter;
  cell: SchematicDocument;
  project: CircuitProject;
  onEdit(name: string, change: CellParameterChange): void;
}) {
  const usage = cellParameterUsage(cell, parameter.name);
  const uses = usage.fields.length + usage.defaults.length;
  const overrides = cellParameterCallers(
    project,
    cell.id,
    parameter.name,
  ).length;
  return (
    <div className="cell-props-row cell-param-row" role="row">
      <span role="cell">
        <CommitField
          aria-label={`Parameter ${parameter.name} name`}
          value={parameter.name}
          onCommit={(next) =>
            onEdit(parameter.name, { kind: "rename", value: next })
          }
        />
      </span>
      <span role="cell">
        <CommitField
          aria-label={`Parameter ${parameter.name} default`}
          placeholder="No default"
          value={parameter.defaultValue ?? ""}
          onCommit={(next) =>
            onEdit(parameter.name, { kind: "default", value: next })
          }
        />
      </span>
      <span role="cell" className="cell-props-row-actions">
        <button
          type="button"
          className="cell-props-icon-button"
          aria-label={`Remove parameter ${parameter.name}`}
          title={
            uses || overrides
              ? "Remove its uses and instance overrides first"
              : "Remove this unused parameter"
          }
          disabled={uses > 0 || overrides > 0}
          onClick={() => onEdit(parameter.name, { kind: "remove" })}
        >
          ×
        </button>
      </span>
    </div>
  );
}

/**
 * One Cell definition, edited in one place: its name and how widely it is
 * shared, its block symbol as it will be drawn, its Pins with their direction,
 * order and side, and its parameters. Every edit applies at once; placing,
 * opening, Top and deletion stay on the hierarchy tree.
 */
export function CellPropertiesDialog(props: CellPropertiesDialogProps) {
  const { project, cellId, onClose } = props;
  const cell = project.documents.find((item) => item.id === cellId);
  const dialogRef = useRef<HTMLElement>(null);
  const pressedBackdrop = useRef(false);
  const [parameterError, setParameterError] = useState("");
  const [newParameter, setNewParameter] = useState({ name: "", value: "" });
  const newParameterRef = useRef<HTMLInputElement>(null);
  const usage = useMemo(
    () => buildProjectHierarchy(project).usage(cellId, 0),
    [project, cellId],
  );
  const symbol = useMemo(() => {
    const name = cell?.netlist?.name;
    return name
      ? createProjectSymbolResolver(project, builtInSymbols).resolve(
          hierarchicalSymbolId(name),
        )?.definition
      : undefined;
  }, [project, cell]);
  const exportedPorts = useMemo(
    () => designNetlistCellPorts(project, cellId),
    [project, cellId],
  );
  useEffect(() => dialogRef.current?.focus(), []);
  useEffect(() => {
    // Undo or an Agent edit can remove the Cell under an open dialog.
    if (!cell?.netlist) onClose();
  }, [cell, onClose]);
  if (!cell?.netlist) return null;

  const netlist = cell.netlist;
  const projection = projectCellInterface(netlist);
  const ports = projection.ports;
  const pinRows = cellPinRows(ports, exportedPorts);
  const target = localBlockSymbolTarget(cell);
  const placements = new Map(
    (target.presentation?.pinPlacements ?? []).map((placement) => [
      placement.terminalId,
      placement,
    ]),
  );
  const automaticSize = hierarchicalBlockBodySize(target.terminals);
  const actualSize = hierarchicalBlockBodySize(
    target.terminals,
    target.presentation,
  );
  const chosenSize = target.presentation?.bodyBounds
    ? actualSize
    : target.presentation?.minimumBodySize;
  const isTop = project.topDocumentId === cell.id;
  const uses = `${usage.total}${usage.atLeast ? "+" : ""}`;
  const scope =
    usage.total > 1
      ? `Shared by ${uses} uses · edits apply to all of them`
      : usage.total === 1
        ? isTop
          ? "Default entry"
          : "1 use"
        : "Not placed yet";
  const parameters = netlist.formalParameters;
  const editParameter = (name: string, change: CellParameterChange) => {
    const result = props.onEditParameter(cell.id, name, change);
    setParameterError(result.ok ? "" : result.message);
    return result.ok;
  };

  return (
    <div
      className="insert-dialog-backdrop"
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Close on a click that began on the backdrop, after any field has
        // committed on blur.
        if (pressedBackdrop.current && event.target === event.currentTarget)
          onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="cell-props-dialog"
        role="dialog"
        data-plain-keys="local"
        aria-modal="true"
        aria-label={`${cell.name} Cell properties`}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          onClose();
        }}
      >
        <header className="cell-props-header">
          <div className="cell-props-identity">
            <CommitField
              className="cell-props-name"
              aria-label="Cell name"
              value={cell.name}
              onCommit={(next) => {
                if (next.trim()) props.onRename(cell.id, next.trim());
              }}
            />
            <p className="cell-props-scope">
              {isTop ? <span className="cell-props-badge">Top</span> : null}
              <span>{scope}</span>
              {isTop ? null : (
                <button
                  type="button"
                  className="cell-props-set-top"
                  onClick={() => props.onSetTop(cell.id)}
                >
                  Set as Top
                </button>
              )}
            </p>
          </div>
          <button
            type="button"
            className="cell-props-close"
            aria-label="Close Cell properties"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="cell-props-body">
          <aside className="cell-props-symbol" aria-label="Cell symbol">
            <div className="cell-props-preview">
              {symbol ? (
                <SymbolArtwork
                  symbol={symbol}
                  className="cell-props-artwork"
                  fitContent
                />
              ) : null}
            </div>
            {props.onCustomizeSymbol ? (
              <button
                type="button"
                className="cell-props-customize"
                onClick={() => props.onCustomizeSymbol!(cell.id)}
              >
                {target.presentation?.artwork
                  ? "Edit custom symbol…"
                  : "Customize symbol…"}
              </button>
            ) : null}
            <div
              className="cell-props-size"
              role="group"
              aria-label="Symbol size"
              hidden={Boolean(target.presentation?.artwork)}
            >
              <label>
                <span>W</span>
                <CommitField
                  aria-label="Cell symbol width"
                  inputMode="numeric"
                  placeholder="Auto"
                  value={chosenSize ? String(chosenSize.width) : ""}
                  onCommit={(next) =>
                    props.onSymbolSizeChange(
                      target,
                      next.trim() ? Number(next) : automaticSize.width,
                      chosenSize?.height ?? automaticSize.height,
                    )
                  }
                />
              </label>
              <span aria-hidden="true">×</span>
              <label>
                <span>H</span>
                <CommitField
                  aria-label="Cell symbol height"
                  inputMode="numeric"
                  placeholder="Auto"
                  value={chosenSize ? String(chosenSize.height) : ""}
                  onCommit={(next) =>
                    props.onSymbolSizeChange(
                      target,
                      chosenSize?.width ?? automaticSize.width,
                      next.trim() ? Number(next) : automaticSize.height,
                    )
                  }
                />
              </label>
            </div>
            <p className="cell-props-note">
              {target.presentation?.artwork
                ? "Custom artwork"
                : `${actualSize.width} × ${actualSize.height}${chosenSize ? "" : " · sized to its Pins"}`}
            </p>
          </aside>

          <div className="cell-props-content">
            <section className="cell-props-section" aria-label="Pins">
              <header>
                <h3>Pins</h3>
                <span className="cell-count-badge">{ports.length}</span>
                <span className="cell-props-section-note">
                  Top to bottom is the netlist order
                  {pinRows.some((row) => row.kind === "pin" && row.supply)
                    ? "; supplies lead"
                    : ""}
                </span>
              </header>
              {ports.length ? (
                <div
                  className="cell-props-table cell-pin-table"
                  role="table"
                  aria-label="Formal port order"
                >
                  <div className="cell-props-row cell-pin-row" role="row">
                    <span role="columnheader" className="cell-pin-order">
                      #
                    </span>
                    <span role="columnheader" className="cell-pin-name">
                      Name
                    </span>
                    <span role="columnheader" className="cell-pin-direction">
                      Direction
                    </span>
                    <span role="columnheader" className="cell-pin-side">
                      Side
                    </span>
                    <span
                      role="columnheader"
                      className="cell-pin-actions"
                      aria-label="Order"
                    />
                  </div>
                  {pinRows.map((row, position) => {
                    if (row.kind === "added")
                      return (
                        <div
                          key={`added-${row.name}`}
                          className="cell-props-row cell-pin-row cell-pin-added"
                          role="row"
                        >
                          <span role="cell" className="cell-pin-order">
                            {position + 1}
                          </span>
                          <span role="cell" className="cell-pin-name">
                            <span className="cell-pin-added-name">
                              {row.name}
                            </span>
                          </span>
                          <span role="cell" className="cell-pin-added-note">
                            Added by the netlist
                          </span>
                        </div>
                      );
                    const { port } = row;
                    // Declarations of one name may state different
                    // directions; a direction is only a drawing hint.
                    const mixed =
                      new Set(
                        port.terminalIds.map(
                          (id) =>
                            netlist.terminals.find((item) => item.id === id)
                              ?.direction,
                        ),
                      ).size > 1;
                    const placement = placements.get(port.id);
                    return (
                      <div
                        key={port.id}
                        className="cell-props-row cell-pin-row"
                        role="row"
                      >
                        <span role="cell" className="cell-pin-order">
                          {position + 1}
                        </span>
                        <span role="cell" className="cell-pin-name">
                          {port.terminalIds.map((id) => {
                            const terminal = netlist.terminals.find(
                              (item) => item.id === id,
                            )!;
                            return (
                              <CommitField
                                key={`${id}/${terminal.name}`}
                                aria-label={`Port ${terminal.name} name`}
                                value={terminal.name}
                                onCommit={(next) =>
                                  props.onRenamePin(cell.id, id, next)
                                }
                              />
                            );
                          })}
                          {port.interfaceInstanceIds.length > 1 ? (
                            <small>
                              {port.interfaceInstanceIds.length} markers
                            </small>
                          ) : null}
                        </span>
                        <span role="cell" className="cell-pin-direction">
                          <select
                            aria-label={`Formal port ${port.name} direction`}
                            value={mixed ? "" : port.direction}
                            onChange={(event) =>
                              props.onSetPinDirection(
                                cell.id,
                                port.id,
                                event.currentTarget.value as Direction,
                              )
                            }
                          >
                            {mixed ? (
                              <option value="" disabled>
                                Mixed
                              </option>
                            ) : null}
                            {DIRECTIONS.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </span>
                        <span role="cell" className="cell-pin-side">
                          <select
                            aria-label={`Cell symbol ${port.name} pin side`}
                            value={placement?.side ?? "auto"}
                            onChange={(event) =>
                              props.onPinSideChange(
                                target,
                                port.id,
                                event.currentTarget.value as PinSide,
                                placement?.offset ?? 0,
                              )
                            }
                          >
                            {SIDES.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </span>
                        <span
                          role="cell"
                          className="cell-props-row-actions cell-pin-actions"
                        >
                          {/* A supply's place is the netlist's: it leads. */}
                          {row.supply ? null : (
                            <>
                              <button
                                type="button"
                                className="cell-props-icon-button"
                                aria-label={`Move ${port.name} up`}
                                disabled={!row.up}
                                onClick={() =>
                                  row.up &&
                                  props.onMovePin(cell.id, port.id, row.up)
                                }
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="cell-props-icon-button"
                                aria-label={`Move ${port.name} down`}
                                disabled={!row.down}
                                onClick={() =>
                                  row.down &&
                                  props.onMovePin(cell.id, port.id, row.down)
                                }
                              >
                                ↓
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="cell-props-empty">
                  No Pins yet. Open {cell.name} and place a Cell Pin (P); it
                  appears here and on the symbol.
                </p>
              )}
            </section>

            <section
              className="cell-props-section"
              aria-label="Cell parameters"
            >
              <header>
                <h3>Parameters</h3>
                <span className="cell-count-badge">{parameters.length}</span>
                <span className="cell-props-section-note">
                  Instances override the defaults
                </span>
              </header>
              <div
                className="cell-props-table"
                role="table"
                aria-label="Cell parameter definitions"
              >
                {parameters.length ? (
                  <div className="cell-props-row cell-param-row" role="row">
                    <span role="columnheader">Name</span>
                    <span role="columnheader">Default</span>
                    <span role="columnheader" aria-label="Remove" />
                  </div>
                ) : null}
                {parameters.map((parameter) => (
                  <ParameterRow
                    key={parameter.name}
                    parameter={parameter}
                    cell={cell}
                    project={project}
                    onEdit={editParameter}
                  />
                ))}
              </div>
              <form
                className="cell-props-row cell-param-row cell-param-add"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    editParameter(newParameter.name.trim(), {
                      kind: "add",
                      value: newParameter.value.trim(),
                    })
                  ) {
                    setNewParameter({ name: "", value: "" });
                    newParameterRef.current?.focus();
                  }
                }}
              >
                <input
                  ref={newParameterRef}
                  autoComplete="off"
                  aria-label="New parameter name"
                  placeholder="New parameter"
                  value={newParameter.name}
                  onChange={(event) =>
                    setNewParameter({
                      ...newParameter,
                      name: event.currentTarget.value,
                    })
                  }
                />
                <input
                  autoComplete="off"
                  aria-label="New parameter default"
                  placeholder="Default"
                  value={newParameter.value}
                  onChange={(event) =>
                    setNewParameter({
                      ...newParameter,
                      value: event.currentTarget.value,
                    })
                  }
                />
                <button
                  type="submit"
                  className="cell-props-add"
                  aria-label="Add parameter"
                  disabled={
                    !newParameter.name.trim() || !newParameter.value.trim()
                  }
                >
                  Add
                </button>
              </form>
              {parameterError ? (
                <p className="cell-props-error" role="alert">
                  {parameterError}
                </p>
              ) : null}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
