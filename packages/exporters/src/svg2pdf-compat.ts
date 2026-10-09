const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function renderedTextNode(root: Node): Text | undefined {
  if (root.nodeType === Node.TEXT_NODE) {
    const text = root as Text;
    return text.data.trim().length > 0 ? text : undefined;
  }
  for (const child of root.childNodes) {
    const match = renderedTextNode(child);
    if (match) return match;
  }
  return undefined;
}

function nextNodeAfterSubtree(node: Node, boundary: Node): Node | undefined {
  let cursor: Node | null = node;
  while (cursor && cursor !== boundary) {
    if (cursor.nextSibling) return cursor.nextSibling;
    cursor = cursor.parentNode;
  }
  return undefined;
}

function nextRenderedTextNode(
  node: Node,
  boundary: SVGTextElement,
): Text | undefined {
  let cursor: Node = node;
  while (true) {
    const candidate = nextNodeAfterSubtree(cursor, boundary);
    if (!candidate) return undefined;
    const match = renderedTextNode(candidate);
    if (match) return match;
    cursor = candidate;
  }
}

function cssLengthInPixels(value: string | null, element: Element): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  const fontSize = Number.parseFloat(getComputedStyle(element).fontSize) || 16;
  if (value.trim().endsWith("em")) return parsed * fontSize;
  if (value.trim().endsWith("%")) return (parsed / 100) * fontSize;
  return parsed;
}

function relativePositionCarrier(text: Text): SVGTSpanElement {
  const parent = text.parentElement;
  if (parent instanceof SVGTSpanElement && renderedTextNode(parent) === text) {
    return parent;
  }
  const wrapper = document.createElementNS(SVG_NAMESPACE, "tspan");
  text.before(wrapper);
  wrapper.append(text);
  return wrapper;
}

function addRelativePosition(
  text: Text,
  attribute: "dx" | "dy",
  delta: number,
): void {
  if (Math.abs(delta) < 1e-9) return;
  const carrier = relativePositionCarrier(text);
  const current = cssLengthInPixels(carrier.getAttribute(attribute), carrier);
  carrier.setAttribute(attribute, `${current + delta}px`);
}

function materializeTextDecorations(svg: SVGSVGElement): void {
  for (const span of svg.querySelectorAll<SVGTSpanElement>(
    'tspan[data-text-run="overbar"][style*="text-decoration:overline"]',
  )) {
    const text = span.closest<SVGTextElement>("text");
    if (!text?.parentElement) continue;
    const bounds = span.getBBox();
    const style = getComputedStyle(span);
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    const line = document.createElementNS(SVG_NAMESPACE, "line");
    line.setAttribute("data-text-decoration", "overbar");
    line.setAttribute("x1", String(bounds.x));
    line.setAttribute("x2", String(bounds.x + bounds.width));
    line.setAttribute("y1", String(bounds.y - fontSize * 0.08));
    line.setAttribute("y2", String(bounds.y - fontSize * 0.08));
    line.setAttribute("stroke", style.fill || "#111111");
    line.setAttribute("stroke-width", String(Math.max(1, fontSize * 0.06)));
    const transform = text.getAttribute("transform");
    if (transform) line.setAttribute("transform", transform);
    text.after(line);
    span.style.textDecoration = "none";
  }

  // jsPDF's Base-14 font mapping turns U+2212 into an underscore. Formal
  // polarity marks have fixed geometry, so preserve the SVG mark as a path.
  for (const minus of svg.querySelectorAll<SVGTextElement>(
    'text[data-role="polarity-negative"]',
  )) {
    const x = Number(minus.getAttribute("x"));
    const y = Number(minus.getAttribute("y"));
    const style = getComputedStyle(minus);
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const line = document.createElementNS(SVG_NAMESPACE, "line");
    line.setAttribute("data-role", "polarity-negative");
    line.setAttribute("x1", String(x - fontSize * 0.3));
    line.setAttribute("x2", String(x + fontSize * 0.3));
    line.setAttribute("y1", String(y - fontSize * 0.3));
    line.setAttribute("y2", String(y - fontSize * 0.3));
    line.setAttribute("stroke", style.fill || "#111111");
    line.setAttribute("stroke-width", String(Math.max(1, fontSize * 0.08)));
    minus.replaceWith(line);
  }
}

/** A jsPDF font style: the weight and slant a run of text is set in. */
export type PdfFontStyle = "normal" | "bold" | "italic" | "bolditalic";

/**
 * Resolve each glyph to an embedded face, preserving contiguous runs of
 * that face. PDF has no CSS font fallback: Greek/math and the round period
 * must explicitly name the face the browser selects for them. Return only
 * the family/style pairs actually used, for the caller to embed.
 */
export function setTextInFamilies(
  svg: SVGSVGElement,
  familyForGlyph: (glyph: string) => string,
): Map<string, Set<PdfFontStyle>> {
  const families = new Map<string, Set<PdfFontStyle>>();
  const walker = document.createTreeWalker(svg, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    // Spaces too: their advance is the face's as well.
    if (text.parentElement?.closest("text") && text.data) nodes.push(text);
  }
  for (const node of nodes) {
    const computed = getComputedStyle(node.parentElement!);
    const bold =
      computed.fontWeight === "bold" ||
      Number.parseInt(computed.fontWeight, 10) >= 600;
    const italic = /^(?:italic|oblique)/u.test(computed.fontStyle);
    const style = bold
      ? italic
        ? "bolditalic"
        : "bold"
      : italic
        ? "italic"
        : "normal";
    const fragment = document.createDocumentFragment();
    let span: SVGTSpanElement | undefined;
    for (const glyph of node.data) {
      const family = familyForGlyph(glyph);
      const styles = families.get(family) ?? new Set<PdfFontStyle>();
      styles.add(style);
      families.set(family, styles);
      if (span?.getAttribute("font-family") !== family) {
        span = document.createElementNS(SVG_NAMESPACE, "tspan");
        span.setAttribute("font-family", family);
        fragment.append(span);
      }
      span.textContent += glyph;
    }
    node.replaceWith(fragment);
  }
  return families;
}

/**
 * Expand renderer constructs that svg2pdf does not implement. This mutates
 * only the temporary, live-DOM clone used for PDF conversion; canonical SVG
 * bytes remain unchanged.
 */
export function normalizeFormalSvgForSvg2Pdf(svg: SVGSVGElement): void {
  materializeTextDecorations(svg);

  // svg2pdf accepts px/em font sizes but resolves percentages to zero. Capture
  // the browser-computed size before translating baseline offsets.
  for (const span of svg.querySelectorAll<SVGTSpanElement>(
    'tspan[font-size$="%"]',
  )) {
    const fontSize = Number.parseFloat(getComputedStyle(span).fontSize);
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
      throw new Error("Vector PDF could not resolve a rich-text font size");
    }
    span.setAttribute("font-size", `${fontSize}px`);
  }

  for (const script of svg.querySelectorAll<SVGTSpanElement>(
    "tspan[baseline-shift]",
  )) {
    const text = script.closest<SVGTextElement>("text");
    const first = renderedTextNode(script);
    if (!text || !first) continue;
    const shift = cssLengthInPixels(
      script.getAttribute("baseline-shift"),
      script,
    );
    // SVG baseline-shift raises positive values; SVG dy lowers them.
    addRelativePosition(first, "dy", -shift);
    const next = nextRenderedTextNode(script, text);
    if (next) addRelativePosition(next, "dy", shift);
    script.removeAttribute("baseline-shift");
  }

  const emptyPositioningSpans = [
    ...svg.querySelectorAll<SVGTSpanElement>("tspan[dx], tspan[dy]"),
  ].filter((span) => !renderedTextNode(span));
  for (const reset of emptyPositioningSpans) {
    const text = reset.closest<SVGTextElement>("text");
    if (text) {
      const next = nextRenderedTextNode(reset, text);
      if (next) {
        addRelativePosition(
          next,
          "dx",
          cssLengthInPixels(reset.getAttribute("dx"), reset),
        );
        addRelativePosition(
          next,
          "dy",
          cssLengthInPixels(reset.getAttribute("dy"), reset),
        );
      }
    }
    reset.remove();
  }

  if (svg.querySelector('tspan[font-size$="%"], tspan[baseline-shift]')) {
    throw new Error("Vector PDF contains unsupported rich-text positioning");
  }
}
