import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { flattenRichText, soleRichTextMathRun } from "@icm/model";
import {
  ANALOG_CANVAS_MATH_PROFILE_ID,
  prepareFormula,
} from "@icm/math-typesetting/cache";
import type { RichTextDocument, RichTextRun } from "@icm/model";

import { boundFormulaPresentation } from "./bound-formula";
import {
  editableDocument,
  isElement,
  normalizeEditableMarkup,
  readChildren,
  toEditableHtml,
} from "./editable-dom";
import { fractionFromSelection } from "./fraction-selection";

export interface RichTextEditorProps {
  targetKey: string;
  content: RichTextDocument;
  disabled?: boolean;
  sizeScale: number;
  alignment: "start" | "middle" | "end";
  defaultBold?: boolean;
  defaultItalic?: boolean;
  /**
   * A plain-only display (for example Symbol body text) edits its source
   * field. It is deliberately a plain editing surface rather than a fake
   * RichText document with disabled formatting controls. Long source values
   * wrap visually, but Enter still commits instead of adding stored lines.
   */
  sourceOnly?: boolean;
  multiline?: boolean;
  compact?: boolean;
  deleteLabel?: string;
  showDelete?: boolean;
  onChange(content: RichTextDocument): void;
  onSizeChange(sizeScale: number): void;
  onAlignmentChange(alignment: "start" | "middle" | "end"): void;
  onCommit(): void;
  onCancel(): void;
  onEscape?(): void;
  onDelete(): void;
  /** Electrical name represented by this editor, when Formula is constrained. */
  formulaSemanticText?: string;
  displayAlias?: boolean;
  onDisplayAliasChange?(enabled: boolean): RichTextDocument | undefined;
  onLayoutHeightChange?(height: number): void;
}

function enclosingOverbar(node: Node): HTMLElement | null {
  const element = isElement(node) ? node : node.parentElement;
  const overbar = element?.closest<HTMLElement>(
    '[data-rich-text-style="overbar"]',
  );
  return overbar ?? null;
}

function selectionBold(range: Range): boolean {
  const node = range.commonAncestorContainer;
  const element = isElement(node) ? node : node.parentElement;
  return !!element && Number(getComputedStyle(element).fontWeight) >= 600;
}

function selectionItalic(range: Range): boolean {
  const node = range.commonAncestorContainer;
  const element = isElement(node) ? node : node.parentElement;
  return !!element && getComputedStyle(element).fontStyle !== "normal";
}

/** Whether the first text a selection covers is drawn italic. */
function selectionStartItalic(range: Range): boolean {
  let node: Node | null =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer
      : (range.startContainer.childNodes[range.startOffset] ??
        range.startContainer);
  while (node && node.nodeType !== Node.TEXT_NODE && node.firstChild)
    node = node.firstChild;
  const element = node && (isElement(node) ? node : node.parentElement);
  return !!element && getComputedStyle(element).fontStyle !== "normal";
}

function allTextBold(runs: RichTextRun[], bold = false): boolean {
  return runs.every((run) => {
    if (run.kind === "text") return !run.value.trim() || bold;
    if (run.kind === "span")
      return allTextBold(run.children, bold || run.style === "bold");
    if (run.kind === "fraction")
      return (
        allTextBold(run.numerator.runs, bold) &&
        allTextBold(run.denominator.runs, bold)
      );
    return true;
  });
}

function withoutItalic(runs: RichTextRun[]): RichTextRun[] {
  return runs.flatMap((run): RichTextRun[] => {
    if (run.kind === "span") {
      const children = withoutItalic(run.children);
      return run.style === "italic" ? children : [{ ...run, children }];
    }
    if (run.kind === "fraction")
      return [
        {
          ...run,
          numerator: { runs: withoutItalic(run.numerator.runs) },
          denominator: { runs: withoutItalic(run.denominator.runs) },
        },
      ];
    return [run];
  });
}

/** The subscript or superscript a node sits in, if any. */
function enclosingScript(node: Node): HTMLElement | null {
  const element = isElement(node) ? node : node.parentElement;
  return element?.closest<HTMLElement>("sub, sup") ?? null;
}

function withoutBold(runs: RichTextRun[]): RichTextRun[] {
  return runs.flatMap((run): RichTextRun[] => {
    if (run.kind === "span") {
      const children = withoutBold(run.children);
      return run.style === "bold" ? children : [{ ...run, children }];
    }
    if (run.kind === "fraction")
      return [
        {
          ...run,
          numerator: { runs: withoutBold(run.numerator.runs) },
          denominator: { runs: withoutBold(run.denominator.runs) },
        },
      ];
    return [run];
  });
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
  defaultBold = false,
  defaultItalic = false,
  sourceOnly = false,
  multiline = true,
  compact = false,
  deleteLabel = "Delete",
  showDelete = true,
  onChange,
  onSizeChange,
  onAlignmentChange,
  onCommit,
  onCancel,
  onEscape,
  onDelete,
  formulaSemanticText,
  displayAlias,
  onDisplayAliasChange,
  onLayoutHeightChange,
}: RichTextEditorProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);
  const sourceInputRef = useRef<HTMLTextAreaElement>(null);
  const formulaSourceRef = useRef<HTMLTextAreaElement>(null);
  const formulaMathfieldRef = useRef<FormulaMathfieldHandle>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const editableInsertionSequenceRef = useRef(0);
  const existingFormula = soleRichTextMathRun(content);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formulaDraft, setFormulaDraft] = useState(
    existingFormula?.latex ?? flattenRichText(content),
  );
  const [formulaDisplay, setFormulaDisplay] = useState<"inline" | "block">(
    existingFormula?.display ?? "inline",
  );
  const [formulaError, setFormulaError] = useState<string | null>(null);

  useEffect(() => {
    if (!formulaOpen) return;
    const frame = requestAnimationFrame(() => {
      formulaSourceRef.current?.focus();
      formulaSourceRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [formulaOpen]);

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
      editableRef.current.innerHTML = toEditableHtml(content, disabled);
      editableRef.current.focus();
    }
  }, [sourceOnly, targetKey, disabled]);

  const sync = (): void => {
    if (editableRef.current)
      onChange(
        editableDocument(editableRef.current, defaultBold, defaultItalic),
      );
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

  const insertEditableContent = (
    content: RichTextDocument,
  ): HTMLElement | null => {
    const editable = editableRef.current;
    if (!editable) return null;
    const marker = String(++editableInsertionSequenceRef.current);
    // Insert one atomic node into native undo, then populate it ourselves.
    // Chromium otherwise repairs nested editable parts while inheriting nearby
    // bold/italic markup and can move a denominator outside its fraction.
    document.execCommand(
      "insertHTML",
      false,
      `<span data-rich-text-insertion="${marker}" contenteditable="false">&#xfffc;</span>`,
    );
    const inserted = editable.querySelector<HTMLElement>(
      `[data-rich-text-insertion="${marker}"]`,
    );
    if (!inserted) return null;
    inserted.innerHTML = toEditableHtml(content);
    inserted.removeAttribute("data-rich-text-insertion");
    inserted.removeAttribute("contenteditable");
    return inserted;
  };

  const command = (
    name: "bold" | "italic" | "subscript" | "superscript" | "overbar",
  ) => {
    if (disabled || !editableRef.current) return;
    editableRef.current.focus();
    restoreSelection();
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const fragment = range?.cloneContents();
    const fractions = fragment
      ? [...fragment.querySelectorAll("[data-rich-text-fraction]")]
      : [];
    if (
      range &&
      !range.collapsed &&
      fractions.length &&
      fractions.every(
        (fraction) =>
          fraction.querySelector(':scope > [data-fraction-part="numerator"]') &&
          fraction.querySelector(':scope > [data-fraction-part="denominator"]'),
      )
    ) {
      // Native formatting skips contenteditable islands. Format their canonical
      // structure together with the selected companions, retaining local undo.
      const selected = document.createElement("div");
      selected.append(fragment!);
      const current = editableDocument(
        selected,
        selectionBold(range),
        selectionItalic(range),
      );
      const sole = current.runs.length === 1 ? current.runs[0] : undefined;
      const unbold = name === "bold" && allTextBold(current.runs);
      const next: RichTextDocument = unbold
        ? { runs: withoutBold(current.runs) }
        : sole?.kind === "span" && sole.style === name
          ? { runs: sole.children }
          : { runs: [{ kind: "span", style: name, children: current.runs }] };
      const inserted = insertEditableContent(next);
      if (inserted) {
        if (unbold) inserted.style.fontWeight = "normal";
        const nextRange = document.createRange();
        nextRange.selectNodeContents(inserted);
        selection?.removeAllRanges();
        selection?.addRange(nextRange);
      }
      rememberSelection();
      sync();
      return;
    }
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
    } else if (
      name === "italic" &&
      range &&
      !range.collapsed &&
      selectionStartItalic(range) &&
      !enclosingScript(range.commonAncestorContainer)
    ) {
      // Scripts are upright, so italic text with its subscript is only partly
      // italic, which native editing toggles differently on each platform
      // (macOS by the start of the selection, others by all of it). Remove
      // italic from a selection that starts italic directly, the same way
      // everywhere. Every run carries its own weight and slant, so the
      // insertion, which may land outside the selection's own wrapper,
      // cancels whatever it would inherit.
      const selected = document.createElement("div");
      selected.append(range.cloneContents());
      const current = editableDocument(
        selected,
        selectionBold(range),
        selectionItalic(range),
      );
      const inserted = insertEditableContent({
        runs: withoutItalic(current.runs),
      });
      if (inserted) {
        inserted.style.fontStyle = "normal";
        inserted.style.fontWeight = "normal";
        const nextRange = document.createRange();
        nextRange.selectNodeContents(inserted);
        selection?.removeAllRanges();
        selection?.addRange(nextRange);
      }
      rememberSelection();
      sync();
      return;
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
    // Let the browser break the line. Placing the <br> by hand leaves the
    // caret on the empty text node after it, which Chromium treats as having
    // no visual position of its own: the next character is then typed back
    // onto the previous line and the break slides to the end of the text.
    // The browser also keeps its own trailing placeholder and native undo.
    if (globalThis.document.execCommand("insertLineBreak")) {
      rememberSelection();
      sync();
      return;
    }
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

  const selectFractionPart = (part: Element): void => {
    (part as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(part);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    rememberSelection();
  };

  const insertFraction = (): void => {
    const editable = editableRef.current;
    if (disabled || !editable || existingFormula) return;
    editable.focus();
    restoreSelection();
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editable.contains(range.commonAncestorContainer)) return;
    const selected = document.createElement("div");
    selected.append(range.cloneContents());
    let selectedContent: RichTextDocument = {
      runs: readChildren(selected, selectionBold(range)),
    };
    // cloneContents omits styles on the common ancestor itself. Carry those
    // styles into both parts when converting a selection inside a styled label.
    let ancestor = isElement(range.commonAncestorContainer)
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    while (ancestor && ancestor !== editable) {
      const tag = ancestor.tagName.toLowerCase();
      const style =
        tag === "strong" || tag === "b"
          ? "bold"
          : tag === "em" || tag === "i"
            ? "italic"
            : tag === "sub"
              ? "subscript"
              : tag === "sup"
                ? "superscript"
                : ancestor.dataset.richTextStyle === "overbar"
                  ? "overbar"
                  : null;
      if (style && selectedContent.runs.length)
        selectedContent = {
          runs: [{ kind: "span", style, children: selectedContent.runs }],
        };
      ancestor = ancestor.parentElement;
    }
    const fraction = fractionFromSelection(selectedContent);
    const inserted = insertEditableContent({ runs: [fraction] });
    const numerator = inserted?.querySelector(
      '[data-fraction-part="numerator"]',
    );
    if (numerator) selectFractionPart(numerator);
    sync();
  };

  const moveThroughFraction = (backward: boolean): boolean => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const element =
      anchor && (isElement(anchor) ? anchor : anchor.parentElement);
    const part = element?.closest<HTMLElement>("[data-fraction-part]");
    const fraction = part?.parentElement;
    if (
      !part ||
      !fraction?.hasAttribute("data-rich-text-fraction") ||
      !editableRef.current?.contains(fraction)
    )
      return false;
    const sibling = backward
      ? part.previousElementSibling
      : part.nextElementSibling;
    if (sibling) selectFractionPart(sibling);
    else {
      editableRef.current.focus();
      const range = document.createRange();
      if (backward) range.setStartBefore(fraction);
      else range.setStartAfter(fraction);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      rememberSelection();
    }
    return true;
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
    setFormulaDraft(formula?.latex ?? (selection || flattenRichText(content)));
    setFormulaDisplay(formula?.display ?? "inline");
    setFormulaError(null);
    setFormulaOpen(true);
  };

  const closeFormulaEditor = (): void => {
    setFormulaOpen(false);
    setFormulaError(null);
  };

  const updateFormulaDraft = (value: string): void => {
    setFormulaDraft(value);
    setFormulaError(null);
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
      setFormulaError(
        `A bound electrical name formula must preserve “${formulaSemanticText}”`,
      );
      return;
    }
    const inserted = boundPresentation ?? next;
    onChange(inserted);
    if (editableRef.current) {
      editableRef.current.innerHTML = toEditableHtml(inserted);
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
            <button
              type="button"
              aria-label="Insert fraction"
              title="Insert fraction · Tab moves through numerator, denominator, and back to text"
              disabled={
                disabled ||
                Boolean(existingFormula) ||
                formulaSemanticText !== undefined
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={insertFraction}
            >
              <span className="rich-text-fraction-button" aria-hidden="true">
                <span>a</span>
                <span>b</span>
              </span>
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
              className="rich-text-latex-button"
              type="button"
              aria-label="Insert formula"
              title="Edit the complete label as LaTeX"
              aria-pressed={formulaOpen}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openFormulaEditor}
            >
              LaTeX
            </button>
            <span className="rich-text-toolbar-separator" />
          </>
        ) : null}
        {!compact ? (
          <span className="rich-text-toolbar-size-controls">
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
          </span>
        ) : null}
        {!compact ? (
          <span className="rich-text-toolbar-action-break" aria-hidden="true" />
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
        {showDelete ? (
          <button
            type="button"
            aria-label={`${deleteLabel} text`}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onDelete}
          >
            {deleteLabel}
          </button>
        ) : null}
        {onDisplayAliasChange ? (
          <label className="rich-text-display-alias">
            <input
              type="checkbox"
              checked={displayAlias ?? false}
              disabled={disabled}
              onChange={(event) => {
                const restored = onDisplayAliasChange(
                  event.currentTarget.checked,
                );
                if (restored && editableRef.current) {
                  editableRef.current.innerHTML = toEditableHtml(restored);
                  selectionRangeRef.current = null;
                }
                closeFormulaEditor();
              }}
            />
            Use display alias
          </label>
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
              <strong>LaTeX</strong>
              <span>Type the source directly; preview updates below</span>
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
            <label className="rich-text-formula-source">
              <span>LaTeX source</span>
              <textarea
                ref={formulaSourceRef}
                autoFocus
                value={formulaDraft}
                aria-label="Formula LaTeX source"
                spellCheck={false}
                rows={3}
                onChange={(event) => updateFormulaDraft(event.target.value)}
              />
            </label>
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
            {formulaError ? (
              <div className="rich-text-formula-error" role="alert">
                {formulaError}
              </div>
            ) : null}
          </div>
          <div className="rich-text-formula-actions">
            <div className="rich-text-formula-display-toggle">
              <button
                type="button"
                aria-pressed={formulaDisplay === "inline"}
                onClick={() => {
                  setFormulaDisplay("inline");
                }}
              >
                Inline
              </button>
              <button
                type="button"
                aria-pressed={formulaDisplay === "block"}
                onClick={() => {
                  setFormulaDisplay("block");
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
        </div>
      ) : null}
      {sourceOnly ? (
        <textarea
          ref={sourceInputRef}
          className="rich-text-editable rich-text-source-input"
          dir="auto"
          value={flattenRichText(content)}
          disabled={disabled}
          rows={2}
          wrap="soft"
          aria-label="Canvas text editor"
          aria-description="Edit the bound schematic label"
          style={{ fontSize: `${15.116 * sizeScale}px` }}
          onChange={(event) =>
            onChange({ runs: [{ kind: "text", value: event.target.value }] })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Escape") (onEscape ?? onCommit)();
              else onCommit();
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
            fontWeight: defaultBold ? 700 : 400,
            fontStyle: defaultItalic ? "italic" : "normal",
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
            if (event.key === "Tab" && moveThroughFraction(event.shiftKey)) {
              event.preventDefault();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              (onEscape ?? onCommit)();
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
