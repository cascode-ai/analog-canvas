import { useDeferredValue, useMemo, useRef, useState } from "react";
import type { CircuitProject } from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
} from "@icm/symbols";

import { SymbolArtwork } from "../component-insert/symbol-artwork";
import {
  addChildPortNames,
  cellNameIssue,
  createChildCellDraft,
  type ChildPortDraft,
} from "./new-cell";

type Direction = ChildPortDraft["direction"];

const DIRECTIONS: readonly Direction[] = [
  "input",
  "output",
  "inout",
  "passive",
];
const DIRECTION_LABEL: Record<Direction, string> = {
  input: "Input",
  output: "Output",
  inout: "Inout",
  passive: "Passive",
};
// The preview draft never enters the Project, so its name only has to be one
// no Cell uses; the symbol does not draw it.
const PREVIEW_NAME = "new_cell_preview";

/** What the dialog says for each of the three ways it makes a Cell. */
function dialogWording(
  parentName: string | undefined,
  fromSelection: { parts: number } | undefined,
) {
  if (fromSelection)
    return {
      title: "New Cell",
      detail: `from ${fromSelection.parts} selected part${fromSelection.parts === 1 ? "" : "s"}`,
      hint: `The new block replaces the parts in ${parentName ?? "this Cell"}; its Pins stay connected, unrouted`,
      submit: "Create from selection",
    };
  if (parentName)
    return {
      title: "New child Cell",
      detail: `in ${parentName}`,
      hint: `Then click in ${parentName} to place it · Esc cancels`,
      submit: "Create and place",
    };
  return {
    title: "New Cell",
    detail: "",
    hint: "Opens it to draw; place it later from the tree",
    submit: "Create Cell",
  };
}

/**
 * Name a new Cell and type its Pins; the block it will be drawn as follows
 * every keystroke. With a parent the block is then placed in it, as one undo
 * step; without one the Cell is created unplaced; from a selection it takes
 * the selected parts' place.
 */
export function NewCellDialog({
  project,
  parentId,
  parentName,
  fromSelection,
  onCancel,
  onCreate,
}: {
  project: CircuitProject;
  /** The open Cell; the new Cell takes its drawing style. */
  parentId: string;
  /** Present to place the new Cell in the open Cell; absent to only create it. */
  parentName?: string;
  /**
   * Make the Cell from selected parts: its Pins are the Nets that leave them,
   * fixed except for their direction.
   */
  fromSelection?: {
    parts: number;
    pins: readonly ChildPortDraft[];
    /** Said before creating, when the open Cell has several uses. */
    note?: string;
  };
  onCancel(): void;
  onCreate(name: string, ports: ChildPortDraft[]): string | undefined;
}) {
  const locked = Boolean(fromSelection);
  const [name, setName] = useState("");
  const [ports, setPorts] = useState<ChildPortDraft[]>(() =>
    (fromSelection?.pins ?? []).map(({ name: pin, direction }) => ({
      name: pin,
      direction,
    })),
  );
  const [pinDraft, setPinDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const pinInputRef = useRef<HTMLInputElement>(null);
  const previewPorts = useDeferredValue(ports);
  const preview = useMemo(() => {
    try {
      const draft = createChildCellDraft(
        project,
        parentId,
        "new-cell-preview",
        PREVIEW_NAME,
        previewPorts,
      );
      return {
        symbol: createProjectSymbolResolver(
          { ...project, documents: [...project.documents, draft] },
          builtInSymbols,
        ).resolve(hierarchicalSymbolId(PREVIEW_NAME))?.definition,
        error: "",
      };
    } catch (failure) {
      return {
        symbol: undefined,
        error: failure instanceof Error ? failure.message : String(failure),
      };
    }
  }, [project, parentId, previewPorts]);
  const trimmed = name.trim();
  const invalidName = trimmed ? (cellNameIssue(project, trimmed) ?? "") : "";
  const wording = dialogWording(parentName, fromSelection);

  const addPins = (text: string) => {
    const added = addChildPortNames(ports, text);
    setPorts(added.ports);
    setNotice(
      added.skipped.length
        ? `${added.skipped.join(", ")} ${added.skipped.length === 1 ? "is" : "are"} already a Pin`
        : "",
    );
  };
  const removePin = (index: number) => {
    setPorts(ports.filter((_, item) => item !== index));
    setNotice("");
    pinInputRef.current?.focus();
  };
  const cycleDirection = (index: number) =>
    setPorts(
      ports.map((port, item) =>
        item === index
          ? {
              ...port,
              direction:
                DIRECTIONS[
                  (DIRECTIONS.indexOf(port.direction) + 1) % DIRECTIONS.length
                ]!,
            }
          : port,
      ),
    );

  return (
    <div
      className="insert-dialog-backdrop"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <form
        className="new-cell-dialog"
        role="dialog"
        data-plain-keys="local"
        aria-modal="true"
        aria-labelledby="new-cell-title"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed || invalidName) return;
          const message = onCreate(
            trimmed,
            addChildPortNames(ports, pinDraft).ports,
          );
          setError(message ?? "");
        }}
      >
        <header className="new-cell-header">
          <h2 id="new-cell-title">
            {wording.title}
            {wording.detail ? (
              <>
                {" "}
                <span>{wording.detail}</span>
              </>
            ) : null}
          </h2>
          <button
            type="button"
            className="cell-props-close"
            aria-label="Cancel"
            onClick={onCancel}
          >
            ×
          </button>
        </header>

        <div className="new-cell-body">
          <figure className="new-cell-preview" aria-label="Symbol preview">
            {preview.symbol ? (
              <SymbolArtwork
                symbol={preview.symbol}
                className="cell-props-artwork"
                fitContent
              />
            ) : null}
            <figcaption>
              {preview.error ||
                (ports.length
                  ? `${trimmed || "Cell"} · ${ports.length} Pin${ports.length === 1 ? "" : "s"}`
                  : "Pins you add appear here")}
            </figcaption>
          </figure>

          <div className="new-cell-fields">
            <label className="new-cell-field">
              <span>Name</span>
              <input
                autoFocus
                aria-label="Cell name"
                aria-invalid={invalidName ? true : undefined}
                placeholder="e.g. bias_gen"
                spellCheck={false}
                value={name}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                  setError("");
                }}
              />
              {invalidName ? (
                <small className="new-cell-issue">{invalidName}</small>
              ) : null}
            </label>

            <div className="new-cell-field">
              <span id="new-cell-pins-label">
                Pins{" "}
                <small>
                  {locked ? "the Nets that leave the parts" : "optional"}
                </small>
              </span>
              <div
                className="pin-token-field"
                role="group"
                aria-labelledby="new-cell-pins-label"
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) {
                    event.preventDefault();
                    pinInputRef.current?.focus();
                  }
                }}
              >
                {ports.map((port, index) => (
                  <span
                    key={port.name}
                    className="pin-token"
                    data-direction={port.direction}
                  >
                    <button
                      type="button"
                      className="pin-token-main"
                      aria-label={`${port.name}: ${DIRECTION_LABEL[port.direction]}. Change direction`}
                      onClick={() => cycleDirection(index)}
                      onKeyDown={(event) => {
                        if (
                          !locked &&
                          (event.key === "Backspace" || event.key === "Delete")
                        ) {
                          event.preventDefault();
                          removePin(index);
                        }
                      }}
                    >
                      <i aria-hidden="true" />
                      {port.name}
                    </button>
                    {locked ? null : (
                      <button
                        type="button"
                        className="pin-token-remove"
                        aria-label={`Remove ${port.name}`}
                        onClick={() => removePin(index)}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                <input
                  hidden={locked}
                  ref={pinInputRef}
                  className="pin-token-input"
                  aria-label="Add Pins"
                  placeholder={ports.length ? "" : "in, out, vdd, vss…"}
                  spellCheck={false}
                  value={pinDraft}
                  onChange={(event) => setPinDraft(event.currentTarget.value)}
                  onPaste={(event) => {
                    // A pasted list becomes Pins at once; a single word
                    // pastes into the field like typing.
                    const text = event.clipboardData.getData("text");
                    if (!/[\s,;]/u.test(text.trim())) return;
                    event.preventDefault();
                    addPins(`${pinDraft}${text}`);
                    setPinDraft("");
                  }}
                  onBlur={() => {
                    if (!pinDraft.trim()) return;
                    addPins(pinDraft);
                    setPinDraft("");
                  }}
                  onKeyDown={(event) => {
                    if (
                      [",", ";", " "].includes(event.key) ||
                      (event.key === "Enter" && pinDraft.trim())
                    ) {
                      // Enter on an empty field still submits the form.
                      event.preventDefault();
                      addPins(pinDraft);
                      setPinDraft("");
                    } else if (
                      event.key === "Backspace" &&
                      !pinDraft &&
                      ports.length
                    ) {
                      event.preventDefault();
                      setPorts(ports.slice(0, -1));
                    }
                  }}
                />
              </div>
              <div className="pin-legend" aria-hidden="true">
                {DIRECTIONS.map((direction) => (
                  <span key={direction} data-direction={direction}>
                    <i />
                    {DIRECTION_LABEL[direction]}
                  </span>
                ))}
                <span className="pin-legend-tip">
                  Guessed from the name · click a Pin to change
                </span>
              </div>
              {notice ? (
                <small className="new-cell-issue">{notice}</small>
              ) : null}
            </div>
            {error ? (
              <p className="cell-props-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <footer className="new-cell-footer">
          <small>
            {wording.hint}
            {fromSelection?.note ? (
              <span className="new-cell-note">{fromSelection.note}</span>
            ) : null}
          </small>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!trimmed || Boolean(invalidName)}
          >
            {wording.submit}
          </button>
        </footer>
      </form>
    </div>
  );
}
