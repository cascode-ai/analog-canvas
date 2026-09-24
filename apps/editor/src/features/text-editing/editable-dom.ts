import { normalizeRichText } from "@icm/model";
import type { RichTextDocument, RichTextRun } from "@icm/model";

/** The browser-only adapter between canonical RichText and the editable DOM. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function toEditableHtml(
  document: RichTextDocument,
  disabled = false,
): string {
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
        return `<span data-rich-text-fraction contenteditable="false"><span data-fraction-part="numerator" contenteditable="${!disabled}" aria-label="Numerator">${renderRuns(run.numerator.runs)}</span><span data-fraction-part="denominator" contenteditable="${!disabled}" aria-label="Denominator">${renderRuns(run.denominator.runs)}</span></span>`;
      case "span": {
        const children = renderRuns(run.children);
        if (run.style === "overbar") {
          return `<span data-rich-text-style="overbar">${children}</span>`;
        }
        if (run.style === "lowercase" || run.style === "uppercase") {
          return `<span data-rich-text-style="${run.style}">${children}</span>`;
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

export function isElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE;
}

function elementBold(element: Element, inherited: boolean): boolean {
  const weight = (element as HTMLElement).style?.fontWeight;
  if (weight === "normal" || weight === "400") return false;
  if (weight === "bold" || Number(weight) >= 600) return true;
  return /^(strong|b)$/i.test(element.tagName) || inherited;
}

function elementItalic(element: Element, inherited: boolean): boolean {
  const style = (element as HTMLElement).style?.fontStyle;
  if (style === "normal") return false;
  if (style === "italic" || style === "oblique") return true;
  return /^(em|i)$/i.test(element.tagName) || inherited;
}

export function readChildren(
  element: Element,
  inheritedBold = false,
  inheritedItalic = false,
): RichTextRun[] {
  const runs: RichTextRun[] = [];
  const bold = elementBold(element, inheritedBold);
  const italic = elementItalic(element, inheritedItalic);
  for (const child of element.childNodes)
    runs.push(...readNode(child, bold, italic));
  return runs;
}

function readNode(node: Node, bold = false, italic = false): RichTextRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    if (!node.textContent) return [];
    // The editable wraps as `pre-wrap`, so a newline inside a text node is a
    // line the author can see — whether the browser put it there for a
    // line-break command or it arrived in pasted text. Rich text carries
    // breaks as their own run, and SVG text has no newline of its own, so a
    // literal one left in a value would silently flatten the line.
    const wrap = (value: string): RichTextRun => {
      let text: RichTextRun = { kind: "text", value };
      if (bold) text = { kind: "span", style: "bold", children: [text] };
      if (italic) text = { kind: "span", style: "italic", children: [text] };
      return text;
    };
    const segments = node.textContent.split("\n");
    return segments.flatMap((segment, index) => [
      ...(index === 0 ? [] : [{ kind: "line-break" as const }]),
      ...(segment ? [wrap(segment)] : []),
    ]);
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
  if (node.hasAttribute("data-rich-text-fraction")) {
    const numerator = node.querySelector(
      ':scope > [data-fraction-part="numerator"]',
    );
    const denominator = node.querySelector(
      ':scope > [data-fraction-part="denominator"]',
    );
    if (!numerator || !denominator) return [];
    const part = (element: Element): RichTextDocument => {
      const runs = readChildren(
        element,
        elementBold(node, bold),
        elementItalic(node, italic),
      );
      return normalizeRichText({
        runs: runs.length ? runs : [{ kind: "text", value: " " }],
      });
    };
    return [
      {
        kind: "fraction",
        numerator: part(numerator),
        denominator: part(denominator),
      },
    ];
  }
  // A script is upright by default: it does not take the surrounding italic,
  // but an italic set inside it is the author's choice and is kept.
  const children = readChildren(
    node,
    bold,
    tag === "sub" || tag === "sup" ? false : italic,
  );
  if (children.length === 0 && tag !== "div" && tag !== "p") return [];
  if (tag === "strong" || tag === "b") {
    return children;
  }
  if (tag === "em" || tag === "i") {
    return children;
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
  if (node.getAttribute("data-rich-text-style") === "lowercase") {
    return [{ kind: "span", style: "lowercase", children }];
  }
  if (node.getAttribute("data-rich-text-style") === "uppercase") {
    return [{ kind: "span", style: "uppercase", children }];
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
export function normalizeEditableMarkup(editable: HTMLElement): void {
  const formattingElements = [
    ...editable.querySelectorAll<HTMLElement>(
      "sub, sup, strong, em, b, i, span",
    ),
  ].reverse();
  formattingElements.forEach((element) => {
    if (
      element.hasAttribute("data-rich-text-fraction") ||
      element.hasAttribute("data-fraction-part")
    )
      return;
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

export function editableDocument(
  element: HTMLElement,
  defaultBold = false,
  defaultItalic = false,
): RichTextDocument {
  const document: RichTextDocument = {
    runs: readChildren(element, defaultBold, defaultItalic),
  };
  if (document.runs.length === 0) {
    return { runs: [{ kind: "text", value: " " }] };
  }
  return normalizeRichText(document);
}
