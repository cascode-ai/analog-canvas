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
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
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

type Direction = "input" | "output" | "inout" | "passive";
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
  onRename(cellId: string, name: string): void;
  onRenamePin(cellId: string, terminalId: string, name: string): void;
  onSetPinDirection(cellId: string, portId: string, direction: Direction): void;
  onMovePin(cellId: string, portId: string, delta: -1 | 1): void;
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
          title={`${uses} internal uses; ${overrides} instance overrides`}
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
  useEffect(() => dialogRef.current?.focus(), []);
  useEffect(() => {
    // Undo or an Agent edit can remove the Cell under an open dialog.
    if (!cell?.netlist) onClose();
  }, [cell, onClose]);
  if (!cell?.netlist) return null;

  const netlist = cell.netlist;
  const projection = projectCellInterface(netlist);
  const ports = projection.ports;
  const issueByPortKey = new Map(
    projection.issues.map((issue) => [issue.portKey, issue]),
  );
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
            <div
              className="cell-props-size"
              role="group"
              aria-label="Symbol size"
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
              {actualSize.width} × {actualSize.height}
              {chosenSize ? "" : " · sized to its Pins"}
            </p>
          </aside>

          <div className="cell-props-content">
            <section className="cell-props-section" aria-label="Pins">
              <header>
                <h3>Pins</h3>
                <span className="cell-count-badge">{ports.length}</span>
                <span className="cell-props-section-note">
                  Top to bottom is the netlist order
                </span>
              </header>
              {ports.length ? (
                <div
                  className="cell-props-table"
                  role="table"
                  aria-label="Formal port order"
                >
                  <div className="cell-props-row cell-pin-row" role="row">
                    <span role="columnheader">#</span>
                    <span role="columnheader">Name</span>
                    <span role="columnheader">Direction</span>
                    <span role="columnheader">Side</span>
                    <span role="columnheader" aria-label="Order" />
                  </div>
                  {ports.map((port, index) => {
                    const issue = issueByPortKey.get(port.key);
                    const placement = placements.get(port.id);
                    return (
                      <div
                        key={port.id}
                        className="cell-props-row cell-pin-row"
                        role="row"
                      >
                        <span role="cell" className="cell-pin-order">
                          {index + 1}
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
                                title={
                                  port.terminalIds.length > 1
                                    ? `Marker ${terminal.interfaceInstanceIds.join(", ")}. Equal names form one Port.`
                                    : "Equal names form one Port."
                                }
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
                          {issue ? (
                            <small className="cell-pin-conflict" role="status">
                              Direction conflict
                            </small>
                          ) : null}
                        </span>
                        <span role="cell">
                          <select
                            aria-label={`Formal port ${port.name} direction`}
                            value={issue ? "" : port.direction}
                            onChange={(event) =>
                              props.onSetPinDirection(
                                cell.id,
                                port.id,
                                event.currentTarget.value as Direction,
                              )
                            }
                          >
                            {issue ? (
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
                        <span role="cell">
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
                        <span role="cell" className="cell-props-row-actions">
                          <button
                            type="button"
                            className="cell-props-icon-button"
                            aria-label={`Move ${port.name} up`}
                            disabled={index === 0}
                            onClick={() =>
                              props.onMovePin(cell.id, port.id, -1)
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="cell-props-icon-button"
                            aria-label={`Move ${port.name} down`}
                            disabled={index === ports.length - 1}
                            onClick={() => props.onMovePin(cell.id, port.id, 1)}
                          >
                            ↓
                          </button>
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
