import type { SchematicStyleProfile } from "@icm/derived";
import { fractionGeometry, fractionPartScale } from "@icm/derived";
import { flattenRichText } from "@icm/model";
import type { RichTextDocument, RichTextRun } from "@icm/model";

interface RenderContext {
  profile: SchematicStyleProfile;
  italic: boolean;
  bold: boolean;
  lineOriginX: number;
  fontSize: number;
  baselineOffset: number;
}

interface RenderState {
  currentBaselineOffset: number;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function styleAttribute(ctx: RenderContext): string {
  return `font-style:${ctx.italic ? "italic" : "normal"};font-weight:${ctx.bold ? ctx.profile.typography.mathWeight : ctx.profile.typography.plainWeight}`;
}

function number(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** Render only canonical RichText AST runs. */
export function renderRichTextDocument(
  document: RichTextDocument,
  profile: SchematicStyleProfile,
  options: {
    lineOriginX?: number;
    fontSize?: number;
    defaultItalic?: boolean;
    defaultBold?: boolean;
  } = {},
): string {
  const context: RenderContext = {
    profile,
    italic: options.defaultItalic ?? false,
    bold: options.defaultBold ?? false,
    lineOriginX: options.lineOriginX ?? 0,
    fontSize: options.fontSize ?? profile.typography.annotationFontSize,
    baselineOffset: 0,
  };
  return renderRuns(document.runs, context, { currentBaselineOffset: 0 });
}

function renderRuns(
  runs: RichTextRun[],
  ctx: RenderContext,
  state: RenderState,
): string {
  let output = "";
  let lineOpen = false;
  for (const run of runs) {
    if (run.kind === "line-break") {
      if (lineOpen) output += "</tspan>";
      const dy =
        ctx.fontSize * ctx.profile.typography.lineHeight +
        ctx.baselineOffset -
        state.currentBaselineOffset;
      state.currentBaselineOffset = ctx.baselineOffset;
      output += `<tspan data-text-run="line-break" x="${ctx.lineOriginX}" dy="${number(dy)}">`;
      lineOpen = true;
      continue;
    }
    output += renderRun(run, ctx, state);
  }
  if (lineOpen) output += "</tspan>";
  return output;
}

function renderRun(
  node: RichTextRun,
  ctx: RenderContext,
  state: RenderState,
): string {
  switch (node.kind) {
    case "text": {
      const text = escapeXml(node.value);
      const dy = ctx.baselineOffset - state.currentBaselineOffset;
      if (Math.abs(dy) < 1e-9) return text;
      state.currentBaselineOffset = ctx.baselineOffset;
      return `<tspan data-text-run="baseline-reset" dy="${number(dy)}">${text}</tspan>`;
    }
    case "line-break":
      return "";
    case "span":
      return renderSpan(node, ctx, state);
    case "fraction":
      return renderInlineFraction(node, ctx, state);
  }
}

/**
 * Inline stacked fraction for mixed rich text. The parts are centered on the
 * block through deterministic dx compensation (0.6 em per code point, the
 * same model as the shared layout). The fraction bar itself needs a line
 * element, which a <text> cannot host; annotation-level fractions render
 * through the structured bar path in render.ts instead.
 */
function renderInlineFraction(
  node: Extract<RichTextRun, { kind: "fraction" }>,
  ctx: RenderContext,
  state: RenderState,
): string {
  const typography = ctx.profile.typography;
  const scale = fractionPartScale(typography.subscriptScale);
  const partFontSize = ctx.fontSize * scale;
  const partContext = { ...ctx, fontSize: partFontSize, baselineOffset: 0 };
  const renderPart = (runs: RichTextRun[]): string => {
    const partState = { currentBaselineOffset: 0 };
    let rendered = renderRuns(runs, partContext, partState);
    const reset = -partState.currentBaselineOffset;
    if (Math.abs(reset) >= 1e-9) {
      rendered += `<tspan data-text-run="baseline-reset" dy="${number(reset)}">&#8203;</tspan>`;
    }
    return rendered;
  };
  const numerator = renderPart(node.numerator.runs);
  const denominator = renderPart(node.denominator.runs);
  // Part widths are measured in base em (char count × 0.6 × part scale); the
  // overhang is in em of the part font, so scale it back to base em too. The
  // dx compensation then converts base-em offsets to the part tspans' own em.
  const numeratorWidthEm =
    [...flattenRichText(node.numerator)].length * 0.6 * scale;
  const denominatorWidthEm =
    [...flattenRichText(node.denominator)].length * 0.6 * scale;
  const blockWidthEm =
    Math.max(numeratorWidthEm, denominatorWidthEm) +
    fractionGeometry.barOverhangEm * scale * 2;
  const numeratorDx = (blockWidthEm - numeratorWidthEm) / 2 / scale;
  const denominatorDx =
    ((blockWidthEm - denominatorWidthEm) / 2 - numeratorWidthEm) / scale;
  const resetDx = (blockWidthEm - denominatorWidthEm) / 2;
  const baselineReset = ctx.baselineOffset - state.currentBaselineOffset;
  state.currentBaselineOffset = ctx.baselineOffset;
  const fractionDy =
    Math.abs(baselineReset) < 1e-9 ? "" : ` dy="${number(baselineReset)}"`;
  return `<tspan data-text-run="fraction"${fractionDy}><tspan data-text-run="numerator" font-size="${number(partFontSize)}px" dx="${number(numeratorDx * partFontSize)}" dy="${number(-fractionGeometry.numeratorBaselineRiseEm * partFontSize)}">${numerator}</tspan><tspan data-text-run="denominator" font-size="${number(partFontSize)}px" dx="${number(denominatorDx * partFontSize)}" dy="${number((fractionGeometry.numeratorBaselineRiseEm + fractionGeometry.denominatorBaselineDropEm) * partFontSize)}">${denominator}</tspan><tspan data-text-run="fraction-reset" dx="${number(resetDx * ctx.fontSize)}" dy="${number(-fractionGeometry.denominatorBaselineDropEm * partFontSize)}">&#8203;</tspan></tspan>`;
}

function renderSpan(
  node: Extract<RichTextRun, { kind: "span" }>,
  ctx: RenderContext,
  state: RenderState,
): string {
  if (
    node.style === "italic" ||
    node.style === "bold" ||
    node.style === "overbar"
  ) {
    const childCtx: RenderContext = {
      ...ctx,
      italic: ctx.italic || node.style === "italic",
      bold: ctx.bold || node.style === "bold",
    };
    const decoration =
      node.style === "overbar" ? ";text-decoration:overline" : "";
    return `<tspan data-text-run="${node.style === "overbar" ? "overbar" : "span"}" style="${styleAttribute(childCtx)}${decoration}">${renderRuns(node.children, childCtx, state)}</tspan>`;
  }

  const typography = ctx.profile.typography;
  const scriptFontSize = ctx.fontSize * typography.subscriptScale;
  const targetOffset =
    ctx.baselineOffset +
    (node.style === "subscript"
      ? scriptFontSize * typography.subscriptBaselineShiftEm
      : -scriptFontSize * typography.subscriptBaselineShiftEm);
  const dy = targetOffset - state.currentBaselineOffset;
  state.currentBaselineOffset = targetOffset;
  const dx =
    node.style === "subscript"
      ? scriptFontSize * typography.subscriptHorizontalGapEm
      : 0;
  // Scripts in the Razavi profile are upright by default. They retain the
  // surrounding weight so a bold math base has a bold upright subscript; an
  // explicit nested italic span remains an intentional user override.
  const scriptCtx: RenderContext = {
    ...ctx,
    italic: false,
    fontSize: scriptFontSize,
    baselineOffset: targetOffset,
  };
  return `<tspan data-text-run="${node.style}" dx="${number(dx)}" dy="${number(dy)}" font-size="${number(scriptFontSize)}px" style="${styleAttribute(scriptCtx)}">${renderRuns(node.children, scriptCtx, state)}</tspan>`;
}
