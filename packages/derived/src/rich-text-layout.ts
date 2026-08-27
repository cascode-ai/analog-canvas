import type { RichTextDocument, RichTextRun } from "@icm/model";

import type { SchematicStyleProfile } from "./style-profile.js";

export interface RichTextMetrics {
  fontSize: number;
  lineHeight: number;
  subscriptScale: number;
  subscriptBaselineShiftEm: number;
  subscriptHorizontalGapEm: number;
}

export interface RichTextLayout {
  width: number;
  height: number;
  lineWidths: number[];
  lineHeights: number[];
}

/**
 * Deterministic proportional advance used by explicitly positioned rich text.
 * Matching export bounds reserve at least the same width, so wide glyph runs
 * cannot outgrow their automatic crop.
 */
function richTextGlyphAdvanceEm(glyph: string): number {
  if (/\s/u.test(glyph)) return 0.32;
  if (/[ilI1|!.,:;'`]/u.test(glyph)) return 0.36;
  if (/[MW@%&Ω]/u.test(glyph)) return 0.9;
  if (/[mw]/u.test(glyph)) return 0.78;
  if (/[A-Z]/u.test(glyph)) return 0.67;
  if (/[a-zα-ω]/u.test(glyph)) return 0.56;
  if (/[0-9x]/u.test(glyph)) return 0.5;
  if (/[+≈≤≥=<>]/u.test(glyph)) return 0.57;
  if (/[-−]/u.test(glyph)) return 0.33;
  return 0.6;
}

export function richTextAdvanceEm(value: string): number {
  return [...value].reduce(
    (sum, glyph) => sum + richTextGlyphAdvanceEm(glyph),
    0,
  );
}

/**
 * Shared geometry of an inline stacked fraction. All offsets are in em of
 * the PART font (the fraction parts render at `fractionPartScale`), so the
 * block grows with the parts and the bar always lands where the metrics say.
 * At the reference subscript scale (0.76) these reproduce the original
 * base-font offsets (bar 0.3, numerator rise 0.6, denominator drop 0.42,
 * overhang 0.08, gap 0.26, ascent 0.12).
 */
export const fractionGeometry = {
  /** Fraction parts render three A+ levels (30%) above the profile subscript scale. */
  partScaleMultiplier: 1.3,
  /** Fraction bar height above the anchor baseline, em of the part font. */
  barRiseEm: 0.395,
  /** Numerator baseline above the anchor baseline, em of the part font. */
  numeratorBaselineRiseEm: 0.789,
  /** Denominator baseline below the anchor baseline, em of the part font. */
  denominatorBaselineDropEm: 0.553,
  /** Fraction bar overhang beyond the widest part, per side, em of the part font. */
  barOverhangEm: 0.105,
  /** Vertical allowance between the two part lines, em of the part font. */
  barGapEm: 0.342,
  /** Ascent a fraction adds beyond the plain first-line ascent heuristic, em of the part font. */
  extraAscentEm: 0.52,
} as const;

/**
 * Fraction part font scale relative to the base font: three A+ levels above
 * the profile subscript scale. The single knob behind every fraction render
 * and measure so the parts stay proportionally large.
 */
export function fractionPartScale(subscriptScale: number): number {
  return subscriptScale * fractionGeometry.partScaleMultiplier;
}

export function containsFractionRun(document: RichTextDocument): boolean {
  const visit = (runs: readonly RichTextRun[]): boolean =>
    runs.some(
      (run) =>
        run.kind === "fraction" || (run.kind === "span" && visit(run.children)),
    );
  return visit(document.runs);
}

type Line = { width: number; height: number };
export function typographyFontSize(
  token: "caption" | "body" | "label",
  profile: SchematicStyleProfile,
): number {
  return token === "caption"
    ? profile.typography.captionFontSize
    : profile.typography.annotationFontSize;
}

export function richTextMetrics(
  profile: SchematicStyleProfile,
  token: "caption" | "body" | "label" = "body",
  sizeScale = 1,
): RichTextMetrics {
  return {
    fontSize: typographyFontSize(token, profile) * sizeScale,
    lineHeight: profile.typography.lineHeight,
    subscriptScale: profile.typography.subscriptScale,
    subscriptBaselineShiftEm: profile.typography.subscriptBaselineShiftEm,
    subscriptHorizontalGapEm: profile.typography.subscriptHorizontalGapEm,
  };
}

/** Deterministic layout shared by editor hits, export bounds, and snapshots. */
export function measureRichTextDocument(
  document: RichTextDocument,
  metrics: RichTextMetrics,
): RichTextLayout {
  const lines = measureRuns(document.runs, metrics);
  return {
    width: Math.max(0, ...lines.map((line) => line.width)),
    height: lines.reduce((sum, line) => sum + line.height, 0),
    lineWidths: lines.map((line) => line.width),
    lineHeights: lines.map((line) => line.height),
  };
}

function measureRuns(runs: RichTextRun[], metrics: RichTextMetrics): Line[] {
  const baseHeight = metrics.fontSize * metrics.lineHeight;
  const lines: Line[] = [{ width: 0, height: baseHeight }];
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]!;
    if (run.kind === "line-break") {
      lines.push({ width: 0, height: baseHeight });
      continue;
    }
    const next = runs[index + 1];
    if (
      next &&
      isScriptRun(run) &&
      isScriptRun(next) &&
      run.style !== next.style
    ) {
      appendInline(lines, measureScriptStack(run, next, metrics));
      index += 1;
      continue;
    }
    appendInline(lines, measureRun(run, metrics));
  }
  return lines;
}

type ScriptRun = Extract<RichTextRun, { kind: "span" }> & {
  style: "subscript" | "superscript";
};

function isScriptRun(run: RichTextRun | undefined): run is ScriptRun {
  return (
    run?.kind === "span" &&
    (run.style === "subscript" || run.style === "superscript")
  );
}

function unwrapWholeTextStyleRuns(initialRuns: RichTextRun[]): RichTextRun[] {
  let runs = initialRuns;
  while (
    runs.length === 1 &&
    runs[0]!.kind === "span" &&
    (runs[0]!.style === "italic" || runs[0]!.style === "bold")
  ) {
    runs = runs[0]!.children;
  }
  return runs;
}

function plainStyledText(runs: RichTextRun[]): string | null {
  let text = "";
  const visit = (run: RichTextRun): boolean => {
    if (run.kind === "text") {
      text += run.value;
      return true;
    }
    if (
      run.kind === "span" &&
      (run.style === "italic" || run.style === "bold")
    ) {
      return run.children.every(visit);
    }
    return false;
  };
  return runs.every(visit) && text.length > 0 ? text : null;
}

function positionedOverbarScriptWidth(
  initialRuns: RichTextRun[],
  metrics: RichTextMetrics,
): number | null {
  const runs = unwrapWholeTextStyleRuns(initialRuns);
  if (runs.length < 3) return null;
  const firstScript = runs.at(-2);
  const secondScript = runs.at(-1);
  if (
    !isScriptRun(firstScript) ||
    !isScriptRun(secondScript) ||
    firstScript.style === secondScript.style
  ) {
    return null;
  }
  const base = plainStyledText(runs.slice(0, -2));
  const firstText = plainStyledText(firstScript.children);
  const secondText = plainStyledText(secondScript.children);
  if (!base || !firstText || !secondText) return null;
  return (
    metrics.fontSize *
    (richTextAdvanceEm(base) +
      metrics.subscriptHorizontalGapEm +
      metrics.subscriptScale *
        Math.max(richTextAdvanceEm(firstText), richTextAdvanceEm(secondText)))
  );
}

/** Adjacent complementary scripts share one attachment column. */
function measureScriptStack(
  first: ScriptRun,
  second: ScriptRun,
  metrics: RichTextMetrics,
): Line[] {
  const firstLines = measureRun(first, metrics);
  const secondLines = measureRun(second, metrics);
  const lineCount = Math.max(firstLines.length, secondLines.length);
  const lines: Line[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    const firstLine = firstLines[index];
    const secondLine = secondLines[index];
    lines.push({
      width: Math.max(firstLine?.width ?? 0, secondLine?.width ?? 0),
      height: Math.max(firstLine?.height ?? 0, secondLine?.height ?? 0),
    });
  }
  if (lines[0]) {
    lines[0].width += metrics.fontSize * metrics.subscriptHorizontalGapEm;
    lines[0].height = Math.max(
      lines[0].height,
      metrics.fontSize *
        (metrics.subscriptScale * metrics.lineHeight +
          2 * metrics.subscriptBaselineShiftEm),
    );
  }
  return lines;
}

function measureRun(run: RichTextRun, metrics: RichTextMetrics): Line[] {
  if (run.kind === "text") {
    return [
      {
        width: [...run.value].length * metrics.fontSize * 0.6,
        height: metrics.fontSize * metrics.lineHeight,
      },
    ];
  }
  if (run.kind === "line-break") {
    return [
      { width: 0, height: metrics.fontSize * metrics.lineHeight },
      { width: 0, height: metrics.fontSize * metrics.lineHeight },
    ];
  }
  if (run.kind === "span") {
    const scale =
      run.style === "subscript" || run.style === "superscript"
        ? metrics.subscriptScale
        : 1;
    const child = measureRuns(run.children, {
      ...metrics,
      fontSize: metrics.fontSize * scale,
    });
    if (run.style === "overbar" && child[0]) {
      const positionedWidth = positionedOverbarScriptWidth(
        run.children,
        metrics,
      );
      if (positionedWidth !== null) {
        child[0].width = Math.max(child[0].width, positionedWidth);
      }
    }
    if (scale < 1) {
      const shift = metrics.fontSize * metrics.subscriptBaselineShiftEm;
      child.forEach((line) => {
        line.height += shift;
      });
    }
    return child;
  }
  if (run.kind === "fraction") {
    // The parts straddle the anchor baseline, so the whole block is one
    // taller inline line: both part stacks plus the bar allowance. Geometry
    // offsets are in em of the part font, so the spacing scales with them.
    const partScale = fractionPartScale(metrics.subscriptScale);
    const partMetrics = {
      ...metrics,
      fontSize: metrics.fontSize * partScale,
    };
    const numerator = measureRuns(run.numerator.runs, partMetrics);
    const denominator = measureRuns(run.denominator.runs, partMetrics);
    const numeratorHeight = numerator.reduce(
      (sum, line) => sum + line.height,
      0,
    );
    const denominatorHeight = denominator.reduce(
      (sum, line) => sum + line.height,
      0,
    );
    return [
      {
        width:
          Math.max(
            ...numerator.map((line) => line.width),
            ...denominator.map((line) => line.width),
          ) +
          metrics.fontSize * partScale * fractionGeometry.barOverhangEm * 2,
        height:
          numeratorHeight +
          denominatorHeight +
          metrics.fontSize * partScale * fractionGeometry.barGapEm,
      },
    ];
  }
  const exhaustive: never = run;
  return exhaustive;
}

function appendInline(target: Line[], addition: Line[]): void {
  const current = target.at(-1)!;
  current.width += addition[0]?.width ?? 0;
  current.height = Math.max(current.height, addition[0]?.height ?? 0);
  for (const line of addition.slice(1)) target.push({ ...line });
}
