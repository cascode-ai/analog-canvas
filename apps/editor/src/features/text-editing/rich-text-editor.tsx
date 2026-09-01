import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  flattenRichText,
  normalizeRichText,
  soleRichTextMathRun,
} from "@icm/model";
import {
  ANALOG_CANVAS_MATH_PROFILE_ID,
  prepareFormula,
} from "@icm/math-typesetting/cache";
import type { RichTextDocument, RichTextRun } from "@icm/model";

import { boundFormulaPresentation } from "./bound-formula";

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
  compact?: boolean;
  deleteLabel?: string;
  onChange(content: RichTextDocument): void;
  onSizeChange(sizeScale: number): void;
  onAlignmentChange(alignment: "start" | "middle" | "end"): void;
  onCommit(): void;
  onCancel(): void;
  onDelete(): void;
  onReverseCurrentArrow?(): void;
  /** Electrical name represented by this editor, when Formula is constrained. */
  formulaSemanticText?: string;
  /** Convert a non-equivalent Formula into literal attached text. */
  onConvertFormulaToLiteral?(formula: RichTextDocument): boolean;
  onLayoutHeightChange?(height: number): void;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toEditableHtml(document: RichTextDocument): string {
  const isScriptRun = (
    run: RichTextRun,
  ): run is Extract<RichTextRun, { kind: "span" }> & {
    style: "subscript" | "superscript";
  } =>
    run.kind === "span" &&
    (run.style === "subscript" || run.style === "superscript");

  const renderRuns = (runs: RichTextRun[]): string => {
    let output = "";
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index]!;
      const next = runs[index + 1];
      if (
        next &&
        isScriptRun(run) &&
        isScriptRun(next) &&
        run.style !== next.style
      ) {
        output += `<span data-rich-text-script-stack>${render(run)}${render(next)}</span>`;
        index += 1;
        continue;
      }
      output += render(run);
    }
    return output;
  };

  const render = (run: RichTextRun): string => {
    switch (run.kind) {
      case "text":
        return escapeHtml(run.value);
      case "line-break":
        return "<br>";
      case "math":
        return `<span data-rich-text-math data-display="${run.display}" data-latex="${escapeHtml(run.latex)}" contenteditable="false">${escapeHtml(run.latex)}</span>`;
      case "fraction":
        // Editing surfaces a fraction in its slash form; committing that
        // text replaces the fraction with plain runs, which the value
        // refresh deliberately treats as hand-edited content.
        return `${renderRuns(run.numerator.runs)}/${renderRuns(run.denominator.runs)}`;
      case "span": {
        const children = renderRuns(run.children);
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
  return renderRuns(document.runs);
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
  if (node.hasAttribute("data-rich-text-math")) {
    const latex = node.getAttribute("data-latex")?.trim();
    if (!latex) return [];
    return [
      {
        kind: "math",
        latex,
        display:
          node.getAttribute("data-display") === "block" ? "block" : "inline",
      },
    ];
  }
  const children = readChildren(node);
  if (children.length === 0 && tag !== "div" && tag !== "p") return [];
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

function isScriptElement(node: Node): node is HTMLElement {
  return (
    isElement(node) &&
    (node.tagName.toLowerCase() === "sub" ||
      node.tagName.toLowerCase() === "sup")
  );
}

/** Keep the browser's editable DOM aligned with the canonical script layout. */
function normalizeEditableMarkup(editable: HTMLElement): void {
  const formattingElements = [
    ...editable.querySelectorAll<HTMLElement>(
      "sub, sup, strong, em, b, i, span",
    ),
  ].reverse();
  formattingElements.forEach((element) => {
    if (!element.textContent && !element.querySelector("br")) element.remove();
  });

  const containers: HTMLElement[] = [
    editable,
    ...editable.querySelectorAll<HTMLElement>("*"),
  ];
  for (const container of containers) {
    if (container.hasAttribute("data-rich-text-script-stack")) continue;
    const children = [...container.childNodes];
    for (let index = 0; index < children.length - 1; index += 1) {
      const first = children[index]!;
      const second = children[index + 1]!;
      if (
        !isScriptElement(first) ||
        !isScriptElement(second) ||
        first.tagName === second.tagName
      ) {
        continue;
      }
      const stack = globalThis.document.createElement("span");
      stack.setAttribute("data-rich-text-script-stack", "");
      container.insertBefore(stack, first);
      stack.append(first, second);
      index += 1;
    }
  }
}

function editableDocument(element: HTMLElement): RichTextDocument {
  const document: RichTextDocument = { runs: readChildren(element) };
  if (document.runs.length === 0) {
    return { runs: [{ kind: "text", value: " " }] };
  }
  return normalizeRichText(document);
}

interface FormulaMathfieldHandle {
  insert(latex: string): void;
}

const FormulaMathfield = forwardRef<
  FormulaMathfieldHandle,
  {
    value: string;
    onChange(value: string): void;
  }
>(function FormulaMathfield({ value, onChange }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<import("mathlive").MathfieldElement | null>(null);
  const changeRef = useRef(onChange);
  const valueRef = useRef(value);
  changeRef.current = onChange;
  valueRef.current = value;

  useImperativeHandle(ref, () => ({
    insert(latex: string): void {
      const field = fieldRef.current;
      if (!field) return;
      field.insert(latex, {
        format: "latex",
        selectionMode: "placeholder",
        focus: true,
        feedback: false,
      });
      changeRef.current(field.value);
    },
  }));

  useEffect(() => {
    let disposed = false;
    let field: import("mathlive").MathfieldElement | undefined;
    let keyboard: Window["mathVirtualKeyboard"] | undefined;
    const suppressVirtualKeyboard = (event: Event): void => {
      event.preventDefault();
    };
    const mount = async () => {
      const [{ MathfieldElement }] = await Promise.all([
        import("mathlive"),
        import("mathlive/fonts.css"),
      ]);
      if (disposed || !hostRef.current) return;
      // Vite owns the font URLs emitted by the CSS import above. Disable
      // MathLive's fallback loader, whose module-relative `/fonts` guess does
      // not exist in a bundled application.
      MathfieldElement.fontsDirectory = null;
      MathfieldElement.soundsDirectory = null;
      field = new MathfieldElement();
      field.value = valueRef.current;
      field.setAttribute("aria-label", "Formula editor");
      // The stock virtual keyboard is appended to the page, outside this SVG
      // foreignObject. Keep physical-keyboard input and provide a local,
      // product-styled formula structure palette instead.
      field.setAttribute("math-virtual-keyboard-policy", "manual");
      field.popoverPolicy = "off";
      field.environmentPopoverPolicy = "off";
      field.addEventListener("input", () => changeRef.current(field!.value));
      hostRef.current.replaceChildren(field);
      fieldRef.current = field;
      keyboard = window.mathVirtualKeyboard;
      if (keyboard.visible) keyboard.hide({ animate: false });
      keyboard.addEventListener(
        "before-virtual-keyboard-toggle",
        suppressVirtualKeyboard,
      );
      field.focus();
    };
    void mount();
    return () => {
      disposed = true;
      fieldRef.current = null;
      field?.remove();
      keyboard?.removeEventListener(
        "before-virtual-keyboard-toggle",
        suppressVirtualKeyboard,
      );
      if (keyboard?.visible) keyboard.hide({ animate: false });
    };
  }, []);

  useEffect(() => {
    if (fieldRef.current && fieldRef.current.value !== value) {
      fieldRef.current.value = value;
    }
  }, [value]);

  return <div className="rich-text-formula-mathfield" ref={hostRef} />;
});

const FORMULA_KEYCAPS = [
  { label: "xₙ", title: "Subscript", latex: "_{#0}" },
  { label: "xⁿ", title: "Superscript", latex: "^{#0}" },
  { label: "a⁄b", title: "Fraction", latex: "\\frac{#0}{#0}" },
  { label: "√x", title: "Square root", latex: "\\sqrt{#0}" },
  { label: "ⁿ√x", title: "Nth root", latex: "\\sqrt[#0]{#0}" },
  { label: "x̅", title: "Overbar", latex: "\\overline{#0}" },
  { label: "x̂", title: "Hat", latex: "\\hat{#0}" },
  { label: "x⃗", title: "Vector", latex: "\\vec{#0}" },
  { label: "|x|", title: "Absolute value", latex: "\\left|#0\\right|" },
  { label: "{x}", title: "Braces", latex: "\\left\\{#0\\right\\}" },
  {
    label: "dy⁄dx",
    title: "Derivative",
    latex: "\\frac{\\mathrm{d}#0}{\\mathrm{d}#0}",
  },
  {
    label: "∂y⁄∂x",
    title: "Partial derivative",
    latex: "\\frac{\\partial #0}{\\partial #0}",
  },
  { label: "Σ", title: "Summation", latex: "\\sum_{#0}^{#0}" },
  { label: "Π", title: "Product", latex: "\\prod_{#0}^{#0}" },
  { label: "∫", title: "Integral", latex: "\\int_{#0}^{#0}" },
  { label: "∬", title: "Double integral", latex: "\\iint_{#0}" },
  { label: "lim", title: "Limit", latex: "\\lim_{#0 \\to #0}" },
  {
    label: "[ ]₂×₂",
    title: "Two by two matrix",
    latex: "\\begin{bmatrix}#0&#0\\\\#0&#0\\end{bmatrix}",
  },
  {
    label: "{⋯",
    title: "Cases",
    latex: "\\begin{cases}#0&#0\\\\#0&#0\\end{cases}",
  },
  { label: "∞", title: "Infinity", latex: "\\infty" },
] as const;

const FORMULA_MORE_GROUPS = [
  {
    title: "Greek",
    items: [
      ["α", "Alpha", "\\alpha"],
      ["β", "Beta", "\\beta"],
      ["γ", "Gamma", "\\gamma"],
      ["δ", "Delta lowercase", "\\delta"],
      ["ε", "Epsilon", "\\epsilon"],
      ["θ", "Theta", "\\theta"],
      ["λ", "Lambda", "\\lambda"],
      ["μ", "Mu", "\\mu"],
      ["π", "Pi", "\\pi"],
      ["ρ", "Rho", "\\rho"],
      ["σ", "Sigma lowercase", "\\sigma"],
      ["τ", "Tau", "\\tau"],
      ["φ", "Phi", "\\phi"],
      ["ω", "Omega lowercase", "\\omega"],
      ["Δ", "Delta", "\\Delta"],
      ["Ω", "Omega", "\\Omega"],
    ],
  },
  {
    title: "Relations & operators",
    items: [
      ["±", "Plus or minus", "\\pm"],
      ["∓", "Minus or plus", "\\mp"],
      ["×", "Multiply", "\\times"],
      ["÷", "Divide", "\\div"],
      ["·", "Centered dot", "\\cdot"],
      ["≠", "Not equal", "\\neq"],
      ["≈", "Approximately equal", "\\approx"],
      ["≤", "Less than or equal", "\\leq"],
      ["≥", "Greater than or equal", "\\geq"],
      ["∝", "Proportional to", "\\propto"],
      ["∠", "Angle", "\\angle"],
      ["∥", "Parallel", "\\parallel"],
      ["⊥", "Perpendicular", "\\perp"],
      ["→", "Right arrow", "\\rightarrow"],
      ["↔", "Left right arrow", "\\leftrightarrow"],
      ["⇒", "Implies", "\\Rightarrow"],
    ],
  },
  {
    title: "Functions & accents",
    items: [
      ["sin", "Sine", "\\sin(#0)"],
      ["cos", "Cosine", "\\cos(#0)"],
      ["tan", "Tangent", "\\tan(#0)"],
      ["ln", "Natural logarithm", "\\ln(#0)"],
      ["log", "Logarithm", "\\log_{#0}(#0)"],
      ["exp", "Exponential", "\\exp(#0)"],
      ["Re", "Real part", "\\operatorname{Re}(#0)"],
      ["Im", "Imaginary part", "\\operatorname{Im}(#0)"],
      ["ẋ", "Dot accent", "\\dot{#0}"],
      ["ẍ", "Double dot accent", "\\ddot{#0}"],
      ["x̃", "Tilde accent", "\\tilde{#0}"],
      ["⟨x⟩", "Angle brackets", "\\left\\langle#0\\right\\rangle"],
    ],
  },
] as const;

export function RichTextEditor({
  targetKey,
  content,
  disabled = false,
  sizeScale,
  alignment,
  sourceOnly = false,
  multiline = true,
  compact = false,
  deleteLabel = "Delete",
  onChange,
  onSizeChange,
  onAlignmentChange,
  onCommit,
  onCancel,
  onDelete,
  onReverseCurrentArrow,
  formulaSemanticText,
  onConvertFormulaToLiteral,
  onLayoutHeightChange,
}: RichTextEditorProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const formulaMathfieldRef = useRef<FormulaMathfieldHandle>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const existingFormula = soleRichTextMathRun(content);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formulaDraft, setFormulaDraft] = useState(
    existingFormula?.latex ?? "",
  );
  const [formulaDisplay, setFormulaDisplay] = useState<"inline" | "block">(
    existingFormula?.display ?? "inline",
  );
  const [formulaError, setFormulaError] = useState<string | null>(null);
  const [pendingFormulaConversion, setPendingFormulaConversion] =
    useState<RichTextDocument | null>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || !onLayoutHeightChange) return;
    const report = (): void => {
      onLayoutHeightChange(Math.ceil(shell.offsetHeight));
    };
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [onLayoutHeightChange, targetKey]);

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
        normalizeEditableMarkup(editableRef.current);
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
    normalizeEditableMarkup(editableRef.current);
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

  const openFormulaEditor = (): void => {
    if (disabled) return;
    const selection = window.getSelection()?.toString().trim();
    const formula = soleRichTextMathRun(content);
    setFormulaDraft(formula?.latex ?? (selection || "V_{OUT}"));
    setFormulaDisplay(formula?.display ?? "inline");
    setFormulaError(null);
    setPendingFormulaConversion(null);
    setFormulaOpen(true);
  };

  const closeFormulaEditor = (): void => {
    setFormulaOpen(false);
    setFormulaError(null);
    setPendingFormulaConversion(null);
  };

  const updateFormulaDraft = (value: string): void => {
    setFormulaDraft(value);
    setFormulaError(null);
    setPendingFormulaConversion(null);
  };

  const applyFormula = async (): Promise<void> => {
    const latex = formulaDraft.trim();
    if (!latex) return;
    const validation = await prepareFormula({
      latex,
      display: formulaDisplay,
      profileId: ANALOG_CANVAS_MATH_PROFILE_ID,
    });
    if (!validation.ok) {
      setFormulaError(validation.diagnostic.message);
      return;
    }
    const next: RichTextDocument = {
      runs: [{ kind: "math", latex, display: formulaDisplay }],
    };
    const boundPresentation =
      formulaSemanticText === undefined
        ? null
        : boundFormulaPresentation(latex, formulaSemanticText);
    if (formulaSemanticText !== undefined && !boundPresentation) {
      if (!onConvertFormulaToLiteral) {
        setFormulaError(
          `A bound electrical name formula must preserve “${formulaSemanticText}”`,
        );
        return;
      }
      setFormulaError(null);
      setPendingFormulaConversion(next);
      return;
    }
    const inserted = boundPresentation ?? next;
    onChange(inserted);
    if (editableRef.current) {
      editableRef.current.innerHTML = toEditableHtml(inserted);
    }
    closeFormulaEditor();
  };

  const confirmFormulaConversion = (): void => {
    if (!pendingFormulaConversion || !onConvertFormulaToLiteral) return;
    if (!onConvertFormulaToLiteral(pendingFormulaConversion)) {
      setFormulaError("This formula could not be attached to the component");
      setPendingFormulaConversion(null);
      return;
    }
    closeFormulaEditor();
  };

  return (
    <div
      ref={shellRef}
      className={`rich-text-editor-shell${compact ? " compact" : ""}`}
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
        {!compact
          ? (
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
            ))
          : null}
        {!sourceOnly && !compact ? (
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
            <button
              type="button"
              aria-label="Insert formula"
              aria-pressed={formulaOpen}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openFormulaEditor}
            >
              ƒx
            </button>
            <span className="rich-text-toolbar-separator" />
          </>
        ) : null}
        {!compact ? (
          <>
            <button
              type="button"
              aria-label="Decrease text size"
              disabled={disabled || sizeScale <= 0.5}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                onSizeChange(
                  Math.max(0.5, Math.round((sizeScale - 0.1) * 10) / 10),
                )
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
                onSizeChange(
                  Math.min(3, Math.round((sizeScale + 0.1) * 10) / 10),
                )
              }
            >
              A+
            </button>
          </>
        ) : null}
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
          aria-label="Cancel text changes"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          aria-label={`${deleteLabel} text`}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onDelete}
        >
          {deleteLabel}
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
      {formulaOpen && !sourceOnly ? (
        <div
          className="rich-text-formula-popover"
          role="dialog"
          aria-label="Formula"
        >
          <div className="rich-text-formula-header">
            <div>
              <strong>Formula</strong>
              <span>LaTeX with live preview</span>
            </div>
            <button
              type="button"
              aria-label="Close formula editor"
              onClick={closeFormulaEditor}
            >
              ×
            </button>
          </div>
          <div
            className="rich-text-formula-scroll-region"
            data-testid="formula-scroll-region"
          >
            <section className="rich-text-formula-preview">
              <span>Preview</span>
              <FormulaMathfield
                ref={formulaMathfieldRef}
                value={formulaDraft}
                onChange={updateFormulaDraft}
              />
            </section>
            <div
              className="rich-text-formula-keyboard"
              role="toolbar"
              aria-label="Formula keyboard"
            >
              {FORMULA_KEYCAPS.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  aria-label={`Insert ${item.title}`}
                  title={item.title}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() =>
                    formulaMathfieldRef.current?.insert(item.latex)
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
            <details className="rich-text-formula-more">
              <summary>More symbols</summary>
              <div className="rich-text-formula-more-groups">
                {FORMULA_MORE_GROUPS.map((group) => (
                  <section key={group.title}>
                    <h4>{group.title}</h4>
                    <div
                      className="rich-text-formula-more-grid"
                      role="toolbar"
                      aria-label={group.title}
                    >
                      {group.items.map(([label, title, latex]) => (
                        <button
                          key={title}
                          type="button"
                          aria-label={`Insert ${title}`}
                          title={title}
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() =>
                            formulaMathfieldRef.current?.insert(latex)
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </details>
            <label className="rich-text-formula-source">
              <span>LaTeX source</span>
              <textarea
                value={formulaDraft}
                aria-label="Formula LaTeX source"
                spellCheck={false}
                rows={3}
                onChange={(event) => updateFormulaDraft(event.target.value)}
              />
            </label>
            {formulaError ? (
              <div className="rich-text-formula-error" role="alert">
                {formulaError}
              </div>
            ) : null}
          </div>
          {pendingFormulaConversion && formulaSemanticText !== undefined ? (
            <div
              className="rich-text-formula-conversion"
              data-testid="formula-conversion-confirmation"
              role="alert"
            >
              <div>
                <strong>Formula does not match the electrical name</strong>
                <span>
                  Reference “{formulaSemanticText}” will remain unchanged. Add
                  this expression as a component formula note?
                </span>
              </div>
              <div className="rich-text-formula-conversion-actions">
                <button
                  type="button"
                  onClick={() => setPendingFormulaConversion(null)}
                >
                  Keep editing
                </button>
                <button
                  className="rich-text-formula-primary-action"
                  type="button"
                  onClick={confirmFormulaConversion}
                >
                  Add as formula note
                </button>
              </div>
            </div>
          ) : (
            <div className="rich-text-formula-actions">
              <div className="rich-text-formula-display-toggle">
                <button
                  type="button"
                  aria-pressed={formulaDisplay === "inline"}
                  onClick={() => {
                    setFormulaDisplay("inline");
                    setPendingFormulaConversion(null);
                  }}
                >
                  Inline
                </button>
                <button
                  type="button"
                  aria-pressed={formulaDisplay === "block"}
                  onClick={() => {
                    setFormulaDisplay("block");
                    setPendingFormulaConversion(null);
                  }}
                >
                  Display
                </button>
              </div>
              <button
                className="rich-text-formula-primary-action"
                type="button"
                onClick={() => void applyFormula()}
              >
                Insert
              </button>
            </div>
          )}
        </div>
      ) : null}
      {sourceOnly ? (
        <input
          ref={sourceInputRef}
          className="rich-text-editable rich-text-source-input"
          type="text"
          dir="auto"
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
          // Follow the content's script: RTL text edits right-to-left.
          dir="auto"
          aria-label="Canvas text editor"
          aria-multiline={multiline}
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
