import { measureRichTextDocument, schematicTextAdvanceEm } from "@icm/derived";
import type { SchematicStyleProfile } from "@icm/derived";
import type { RichTextDocument, RichTextRun } from "@icm/model";

import { renderRichTextDocument } from "./rich-text.js";

interface TextStyle {
  italic: boolean;
  bold: boolean;
}

interface TextSegment extends TextStyle {
  text: string;
}

type ScriptRun = Extract<RichTextRun, { kind: "span" }> & {
  style: "subscript" | "superscript";
};

export interface PositionedOverbarScript {
  tspans: string;
  decorations: string;
  width: number;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function number(value: number): string {
  return String(Number(value.toFixed(6)));
}

function isScriptRun(run: RichTextRun | undefined): run is ScriptRun {
  return (
    run?.kind === "span" &&
    (run.style === "subscript" || run.style === "superscript")
  );
}

function unwrapWholeTextStyles(
  initialRuns: RichTextRun[],
  initialStyle: TextStyle,
): { runs: RichTextRun[]; style: TextStyle } {
  let runs = initialRuns;
  let style = initialStyle;
  while (
    runs.length === 1 &&
    runs[0]!.kind === "span" &&
    (runs[0]!.style === "italic" || runs[0]!.style === "bold")
  ) {
    const span = runs[0] as Extract<RichTextRun, { kind: "span" }>;
    style = {
      italic: style.italic || span.style === "italic",
      bold: style.bold || span.style === "bold",
    };
    runs = span.children;
  }
  return { runs, style };
}

function plainSegments(
  runs: RichTextRun[],
  inherited: TextStyle,
): TextSegment[] | null {
  const segments: TextSegment[] = [];
  const visit = (run: RichTextRun, style: TextStyle): boolean => {
    if (run.kind === "text") {
      const previous = segments.at(-1);
      if (
        previous &&
        previous.italic === style.italic &&
        previous.bold === style.bold
      ) {
        previous.text += run.value;
      } else {
        segments.push({ text: run.value, ...style });
      }
      return true;
    }
    if (
      run.kind === "span" &&
      (run.style === "italic" || run.style === "bold")
    ) {
      return run.children.every((child) =>
        visit(child, {
          italic: style.italic || run.style === "italic",
          bold: style.bold || run.style === "bold",
        }),
      );
    }
    return false;
  };
  return runs.every((run) => visit(run, inherited)) && segments.length > 0
    ? segments
    : null;
}

function segmentWidth(
  segment: TextSegment,
  fontSize: number,
  scale: number,
): number {
  return (
    schematicTextAdvanceEm(
      segment.text,
      segment.bold ? "bold" : "plain",
      segment.italic,
    ) *
    fontSize *
    scale
  );
}

function segmentsWidth(
  segments: TextSegment[],
  fontSize: number,
  scale: number,
): number {
  return segments.reduce(
    (sum, segment) => sum + segmentWidth(segment, fontSize, scale),
    0,
  );
}

function styleAttribute(
  segment: TextSegment,
  profile: SchematicStyleProfile,
): string {
  return `font-style:${segment.italic ? "italic" : "normal"};font-weight:${segment.bold ? profile.typography.mathWeight : profile.typography.plainWeight}`;
}

function renderSegments(
  segments: TextSegment[],
  options: {
    x: number;
    y: number;
    fontSize: number;
    scale: number;
    run: "base" | "subscript" | "superscript";
    profile: SchematicStyleProfile;
  },
): string {
  let x = options.x;
  let output = "";
  for (const segment of segments) {
    const width = segmentWidth(segment, options.fontSize, options.scale);
    output += `<tspan data-text-run="${options.run}" data-text-advance="${number(width)}" x="${number(x)}" y="${number(options.y)}" text-anchor="start" font-size="${number(options.fontSize * options.scale)}" style="${styleAttribute(segment, options.profile)}">${escapeXml(segment.text)}</tspan>`;
    x += width;
  }
  return output;
}

/** One barred name, measured, ready to be placed at any x on the line. */
interface OverbarLayout {
  width: number;
  place(x: number): { tspans: string; decoration: string };
}

/**
 * A barred name: a base with the scripts that attach to it, under one bar.
 * Null for anything the positioned path cannot draw exactly.
 */
function overbarLayout(
  overbar: Extract<RichTextRun, { kind: "span" }>,
  outerStyle: TextStyle,
  profile: SchematicStyleProfile,
  options: { y: number; fontSize: number; color?: string },
): OverbarLayout | null {
  const expression = unwrapWholeTextStyles(overbar.children, outerStyle);
  if (expression.runs.length === 0) return null;

  // Take the trailing scripts, however many there are. An overbar over plain
  // text and an overbar over a base with one script are the common shapes;
  // they used to fall through to CSS text-decoration, which draws the line at
  // the font's ascender rather than over the glyphs and inherits into every
  // nested tspan — so a base with a subscript and a superscript came out with
  // three separate bars floating at three different heights.
  const trailing: Extract<RichTextRun, { kind: "span" }>[] = [];
  for (const run of [expression.runs.at(-2), expression.runs.at(-1)]) {
    if (isScriptRun(run)) trailing.push(run);
    else trailing.length = 0;
  }
  const scripts =
    trailing.length === 2 && trailing[0]!.style !== trailing[1]!.style
      ? trailing
      : isScriptRun(expression.runs.at(-1))
        ? [expression.runs.at(-1) as Extract<RichTextRun, { kind: "span" }>]
        : [];

  const baseRuns = expression.runs.slice(
    0,
    expression.runs.length - scripts.length,
  );
  if (baseRuns.length === 0) return null;
  const base = plainSegments(baseRuns, expression.style);
  const scriptStyle = { italic: false, bold: expression.style.bold };
  const subscriptRun = scripts.find((run) => run.style === "subscript");
  const superscriptRun = scripts.find((run) => run.style === "superscript");
  const subscript = subscriptRun
    ? plainSegments(subscriptRun.children, scriptStyle)
    : [];
  const superscript = superscriptRun
    ? plainSegments(superscriptRun.children, scriptStyle)
    : [];
  if (!base || !subscript || !superscript) return null;

  const scale = profile.typography.subscriptScale;
  const baseWidth = segmentsWidth(base, options.fontSize, 1);
  const subscriptWidth = segmentsWidth(subscript, options.fontSize, scale);
  const superscriptWidth = segmentsWidth(superscript, options.fontSize, scale);
  const attachmentGap =
    scripts.length > 0
      ? options.fontSize * profile.typography.subscriptHorizontalGapEm
      : 0;
  const nameWidth =
    baseWidth + attachmentGap + Math.max(subscriptWidth, superscriptWidth);
  const shift =
    options.fontSize * scale * profile.typography.subscriptBaselineShiftEm;
  const superscriptY = options.y - shift;
  const subscriptY = options.y + shift;
  const glyphAscent = 0.78;
  const overbarGap = options.fontSize * 0.08;
  const baseTop = options.y - options.fontSize * glyphAscent;
  // Only a superscript can reach above the base, and only when there is one:
  // clearing a superscript that is not there would float the bar.
  const superscriptTop = superscriptRun
    ? superscriptY - options.fontSize * scale * glyphAscent
    : baseTop;
  const lineY = Math.min(baseTop, superscriptTop) - overbarGap;
  const strokeWidth = Math.max(1, profile.strokes.annotation);

  return {
    width: nameWidth,
    place(nameStartX) {
      const scriptX = nameStartX + baseWidth + attachmentGap;
      const baseTspans = renderSegments(base, {
        x: nameStartX,
        y: options.y,
        fontSize: options.fontSize,
        scale: 1,
        run: "base",
        profile,
      });
      const subscriptTspans = renderSegments(subscript, {
        x: scriptX,
        y: subscriptY,
        fontSize: options.fontSize,
        scale,
        run: "subscript",
        profile,
      });
      const superscriptTspans = renderSegments(superscript, {
        x: scriptX,
        y: superscriptY,
        fontSize: options.fontSize,
        scale,
        run: "superscript",
        profile,
      });
      const orderedScripts = scripts
        .map((run) =>
          run.style === "subscript" ? subscriptTspans : superscriptTspans,
        )
        .join("");
      // The bar belongs to the name: it spans the base and its scripts,
      // one line from where the name starts to where it ends.
      return {
        tspans: `<tspan data-text-run="overbar">${baseTspans}<tspan data-text-run="script-stack">${orderedScripts}</tspan></tspan>`,
        decoration: `<line data-text-decoration="overbar" x1="${number(nameStartX)}" y1="${number(lineY)}" x2="${number(nameStartX + nameWidth)}" y2="${number(lineY)}" stroke="${options.color ?? profile.foreground}" stroke-width="${number(strokeWidth)}"/>`,
      };
    },
  };
}

/**
 * Position the expression shape that SVG inline text cannot represent: a
 * barred name whose bar spans a base with attached sub/superscripts, and
 * every such name on the line (I_N & EV, each under its own single bar).
 * Each proportional-font segment receives an explicit deterministic width,
 * so Chromium and Resvg share the same attachment column and line endpoints.
 */
export function renderPositionedOverbarScriptDocument(
  document: RichTextDocument,
  profile: SchematicStyleProfile,
  options: {
    x: number;
    y: number;
    fontSize: number;
    alignment: "start" | "middle" | "end";
    /** Paint for explicit decorations that cannot inherit from SVG text. */
    color?: string;
    defaultItalic?: boolean;
    defaultBold?: boolean;
  },
): PositionedOverbarScript | null {
  const outer = unwrapWholeTextStyles(document.runs, {
    italic: options.defaultItalic ?? false,
    bold: options.defaultBold ?? false,
  });
  // Ordinary text may precede, separate or follow the barred names. It has
  // to be rendered here rather than left to the generic path, because the
  // generic path draws a bar with CSS `text-decoration: overline`, which SVG
  // inherits into every nested tspan: a subscript and a superscript each
  // grow a bar of their own, at their own size and height. That is the
  // defect in issue #495, and it came back for any second barred name on a
  // line (I̅_N & E̅V̅): the whole line fell to the generic path.
  const chunks: (
    | { kind: "text"; runs: RichTextRun[] }
    | { kind: "bar"; layout: OverbarLayout }
  )[] = [];
  for (const run of outer.runs) {
    if (run.kind === "span" && run.style === "overbar") {
      const layout = overbarLayout(run, outer.style, profile, options);
      if (!layout) return null;
      chunks.push({ kind: "bar", layout });
      continue;
    }
    const last = chunks.at(-1);
    if (last?.kind === "text") last.runs.push(run);
    else chunks.push({ kind: "text", runs: [run] });
  }
  if (!chunks.some((chunk) => chunk.kind === "bar")) return null;

  const metrics = {
    fontSize: options.fontSize,
    lineHeight: profile.typography.lineHeight,
    subscriptScale: profile.typography.subscriptScale,
    subscriptBaselineShiftEm: profile.typography.subscriptBaselineShiftEm,
    subscriptHorizontalGapEm: profile.typography.subscriptHorizontalGapEm,
  };
  const widths = chunks.map((chunk) =>
    chunk.kind === "bar"
      ? chunk.layout.width
      : measureRichTextDocument({ runs: chunk.runs }, metrics).width,
  );
  const width = widths.reduce((sum, value) => sum + value, 0);
  const startX =
    options.alignment === "start"
      ? options.x
      : options.alignment === "end"
        ? options.x - width
        : options.x - width / 2;
  // Alignment belongs to the complete line; each piece starts where the one
  // before it ends.
  let x = startX;
  let tspans = "";
  let decorations = "";
  chunks.forEach((chunk, index) => {
    if (chunk.kind === "bar") {
      const placed = chunk.layout.place(x);
      tspans += placed.tspans;
      decorations += placed.decoration;
    } else {
      tspans += `<tspan x="${number(x)}" y="${number(options.y)}">${renderRichTextDocument(
        { runs: chunk.runs },
        profile,
        {
          lineOriginX: x,
          fontSize: options.fontSize,
          defaultBold: outer.style.bold,
          defaultItalic: outer.style.italic,
        },
      )}</tspan>`;
    }
    x += widths[index]!;
  });
  return { width, tspans, decorations };
}
