import { useEffect, useRef } from "react";

import { flattenRichText, normalizeRichText } from "@icm/model";
import type { RichTextDocument, RichTextRun } from "@icm/model";

export interface RichTextEditorProps {
  targetKey: string;
  content: RichTextDocument;
  disabled?: boolean;
  sizeScale: number;
  alignment: "start" | "middle" | "end";
  /**
   * A semantic display (for example an instance reference) edits its source
   * field. It is deliberately a plain, single-line input rather than a fake
   * RichText document with disabled formatting controls.
   */
  sourceOnly?: boolean;
  multiline?: boolean;
  onChange(content: RichTextDocument): void;
  onSizeChange(sizeScale: number): void;
  onAlignmentChange(alignment: "start" | "middle" | "end"): void;
  onCommit(): void;
  onDelete(): void;
  onReverseCurrentArrow?(): void;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toEditableHtml(document: RichTextDocument): string {
  const render = (run: RichTextRun): string => {
    switch (run.kind) {
      case "text":
        return escapeHtml(run.value);
      case "line-break":
        return "<br>";
      case "fraction":
        // Editing surfaces a fraction in its slash form; committing that
        // text replaces the fraction with plain runs, which the value
        // refresh deliberately treats as hand-edited content.
        return `${run.numerator.runs.map(render).join("")}/${run.denominator.runs.map(render).join("")}`;
      case "span": {
        const children = run.children.map(render).join("");
        if (run.style === "overbar") {
          return `<span data-rich-text-style="overbar">${children}</span>`;
        }
        const tag =
          run.style === "italic"
            ? "em"
            : run.style === "bold"
              ? "strong"
              : run.style === "subscript"
                ? "sub"
                : "sup";
        return `<${tag}>${children}</${tag}>`;
      }
    }
  };
  return document.runs.map(render).join("");
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE;
}

function enclosingOverbar(node: Node): HTMLElement | null {
  const element = isElement(node) ? node : node.parentElement;
  const overbar = element?.closest<HTMLElement>(
    '[data-rich-text-style="overbar"]',
  );
  return overbar ?? null;
}

function readChildren(element: Element): RichTextRun[] {
  const runs: RichTextRun[] = [];
  for (const child of element.childNodes) runs.push(...readNode(child));
  return runs;
}

function readNode(node: Node): RichTextRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ? [{ kind: "text", value: node.textContent }] : [];
  }
  if (!isElement(node)) return [];
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return [{ kind: "line-break" }];
  const children = readChildren(node);
  if (tag === "strong" || tag === "b") {
    return [{ kind: "span", style: "bold", children }];
  }
  if (tag === "em" || tag === "i") {
    return [{ kind: "span", style: "italic", children }];
  }
  if (tag === "sub") {
    return [{ kind: "span", style: "subscript", children }];
  }
  if (tag === "sup") {
    return [{ kind: "span", style: "superscript", children }];
  }
  if (node.getAttribute("data-rich-text-style") === "overbar") {
    return [{ kind: "span", style: "overbar", children }];
  }
  if (tag === "div" || tag === "p") {
    return [...children, { kind: "line-break" }];
  }
  return children;
}

function editableDocument(element: HTMLElement): RichTextDocument {
  const document: RichTextDocument = { runs: readChildren(element) };
  if (document.runs.length === 0) {
    return { runs: [{ kind: "text", value: " " }] };
  }
  return normalizeRichText(document);
}

export function RichTextEditor({
  targetKey,
  content,
  disabled = false,
  sizeScale,
  alignment,
  sourceOnly = false,
  multiline = true,
  onChange,
  onSizeChange,
  onAlignmentChange,
  onCommit,
  onDelete,
  onReverseCurrentArrow,
}: RichTextEditorProps) {
  const editableRef = useRef<HTMLDivElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const selectionRangeRef = useRef<Range | null>(null);

  useEffect(() => {
    if (sourceOnly && sourceInputRef.current) {
      sourceInputRef.current.focus();
      sourceInputRef.current.select();
      return;
    }
    if (editableRef.current) {
      editableRef.current.innerHTML = toEditableHtml(content);
      editableRef.current.focus();
    }
  }, [sourceOnly, targetKey]);

  const sync = (): void => {
    if (editableRef.current) onChange(editableDocument(editableRef.current));
  };

  const rememberSelection = (): void => {
    const editable = editableRef.current;
    const selection = window.getSelection();
    if (
      !editable ||
      !selection ||
      selection.rangeCount === 0 ||
      !editable.contains(selection.anchorNode) ||
      !editable.contains(selection.focusNode)
    ) {
      return;
    }
    selectionRangeRef.current = selection.getRangeAt(0).cloneRange();
  };

  const restoreSelection = (): void => {
    const range = selectionRangeRef.current;
    const selection = window.getSelection();
    if (!range || !selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const command = (
    name: "bold" | "italic" | "subscript" | "superscript" | "overbar",
  ) => {
    if (disabled || !editableRef.current) return;
    editableRef.current.focus();
    restoreSelection();
    if (name === "overbar") {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range || range.collapsed) return;
      const startOverbar = enclosingOverbar(range.startContainer);
      const endOverbar = enclosingOverbar(range.endContainer);
      if (
        startOverbar &&
        startOverbar === endOverbar &&
        editableRef.current.contains(startOverbar)
      ) {
        // The canonical editor writes an overbar as one span. A second action
        // on any selected part of that span removes the same decoration from
        // the whole selected formatting run, including a multi-character name.
        const parent = startOverbar.parentNode;
        if (!parent) return;
        const contents = globalThis.document.createDocumentFragment();
        while (startOverbar.firstChild)
          contents.append(startOverbar.firstChild);
        parent.replaceChild(contents, startOverbar);
        rememberSelection();
        sync();
        return;
      }
      const wrapper = globalThis.document.createElement("span");
      wrapper.dataset.richTextStyle = "overbar";
      try {
        range.surroundContents(wrapper);
      } catch {
        wrapper.append(range.extractContents());
        range.insertNode(wrapper);
      }
      const next = globalThis.document.createRange();
      next.selectNodeContents(wrapper);
      selection?.removeAllRanges();
      selection?.addRange(next);
    } else {
      document.execCommand(name);
    }
    rememberSelection();
    sync();
  };

  const insertLineBreak = (): void => {
    if (disabled || !editableRef.current) return;
    editableRef.current.focus();
    restoreSelection();
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editableRef.current.contains(range.commonAncestorContainer))
      return;
    range.deleteContents();
    const lineBreak = globalThis.document.createElement("br");
    range.insertNode(lineBreak);
    const next = globalThis.document.createRange();
    next.setStartAfter(lineBreak);
    next.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(next);
    rememberSelection();
    sync();
  };

  const insertSymbol = (symbol: string): void => {
    if (disabled || !editableRef.current) return;
    editableRef.current.focus();
    restoreSelection();
    document.execCommand("insertText", false, symbol);
    rememberSelection();
    sync();
  };

  return (
    <div
      className="rich-text-editor-shell"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="rich-text-floating-toolbar"
        role="toolbar"
        aria-label="Text formatting"
      >
        {!sourceOnly ? (
          <>
            <button
              type="button"
              aria-label="Bold"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command("bold")}
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              aria-label="Italic"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command("italic")}
            >
              <em>I</em>
            </button>
            <button
              type="button"
              aria-label="Subscript"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command("subscript")}
            >
              x<sub>2</sub>
            </button>
            <button
              type="button"
              aria-label="Superscript"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command("superscript")}
            >
              x<sup>2</sup>
            </button>
            <button
              type="button"
              aria-label="Overbar"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command("overbar")}
            >
              <span className="rich-text-overbar-button">x</span>
            </button>
            <span className="rich-text-toolbar-separator" />
          </>
        ) : null}
        {(
          [
            ["start", "Align left"],
            ["middle", "Align center"],
            ["end", "Align right"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={alignment === value}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAlignmentChange(value)}
          >
            <svg
              className="rich-text-align-icon"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path
                d={
                  value === "start"
                    ? "M1 3h14M1 6h9M1 9h14M1 12h7"
                    : value === "middle"
                      ? "M1 3h14M3.5 6h9M1 9h14M4.5 12h7"
                      : "M1 3h14M6 6h9M1 9h14M8 12h7"
                }
              />
            </svg>
          </button>
        ))}
        {!sourceOnly ? (
          <>
            <details className="rich-text-symbol-menu">
              <summary aria-label="Insert circuit symbol">Ω</summary>
              <div role="menu" aria-label="Circuit symbols">
                {[
                  "α",
                  "β",
                  "γ",
                  "δ",
                  "θ",
                  "λ",
                  "μ",
                  "π",
                  "φ",
                  "ω",
                  "Δ",
                  "Ω",
                  "±",
                  "≈",
                  "≤",
                  "≥",
                  "∞",
                  "°",
                  "·",
                  "→",
                ].map((symbol) => (
                  <button
                    key={symbol}
                    type="button"
                    role="menuitem"
                    aria-label={`Insert ${symbol}`}
                    disabled={disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertSymbol(symbol)}
                  >
                    {symbol}
                  </button>
                ))}
              </div>
            </details>
            <span className="rich-text-toolbar-separator" />
          </>
        ) : null}
        <button
          type="button"
          aria-label="Decrease text size"
          disabled={disabled || sizeScale <= 0.5}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            onSizeChange(Math.max(0.5, Math.round((sizeScale - 0.1) * 10) / 10))
          }
        >
          A-
        </button>
        <button
          type="button"
          aria-label="Increase text size"
          disabled={disabled || sizeScale >= 3}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            onSizeChange(Math.min(3, Math.round((sizeScale + 0.1) * 10) / 10))
          }
        >
          A+
        </button>
        <button
          type="button"
          aria-label="Apply text changes"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCommit}
        >
          Apply
        </button>
        <button
          type="button"
          aria-label="Delete text"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onDelete}
        >
          Delete
        </button>
        {onReverseCurrentArrow ? (
          <button
            type="button"
            aria-label="Reverse current arrow"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onReverseCurrentArrow}
          >
            Reverse arrow
          </button>
        ) : null}
      </div>
      {sourceOnly ? (
        <input
          ref={sourceInputRef}
          className="rich-text-editable rich-text-source-input"
          type="text"
          value={flattenRichText(content)}
          disabled={disabled}
          aria-label="Canvas text editor"
          aria-description="Edit the bound schematic label"
          style={{ fontSize: `${15.116 * sizeScale}px` }}
          onChange={(event) =>
            onChange({ runs: [{ kind: "text", value: event.target.value }] })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              onCommit();
            }
          }}
        />
      ) : (
        <div
          ref={editableRef}
          className="rich-text-editable"
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-label="Canvas text editor"
          aria-multiline="true"
          style={{
            fontSize: `${15.116 * sizeScale}px`,
            // Mirror the committed alignment so centered labels edit centered.
            textAlign:
              alignment === "middle"
                ? "center"
                : alignment === "end"
                  ? "right"
                  : "left",
          }}
          onInput={sync}
          onSelect={rememberSelection}
          onKeyUp={rememberSelection}
          onPointerUp={rememberSelection}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              // Escape saves the session, matching click-away and Enter.
              onCommit();
            } else if (event.key === "Enter" && event.shiftKey && multiline) {
              // Enter finishes the text everywhere; a deliberate modifier is
              // what asks for another line.
              event.preventDefault();
              insertLineBreak();
            } else if (event.key === "Enter") {
              event.preventDefault();
              onCommit();
            } else if (event.ctrlKey && event.key.toLowerCase() === "b") {
              event.preventDefault();
              command("bold");
            } else if (event.ctrlKey && event.key.toLowerCase() === "i") {
              event.preventDefault();
              command("italic");
            }
          }}
        />
      )}
    </div>
  );
}
