import {
  containsFractionRun,
  fractionGeometry,
  fractionPartScale,
  measureRichTextDocument,
  richTextMetrics,
} from "@icm/derived";
import type { SchematicStyleProfile } from "@icm/derived";
import type { RichTextDocument, RichTextRun } from "@icm/model";
import { renderRichTextDocument } from "./rich-text.js";
import { renderPositionedOverbarScriptDocument } from "./positioned-rich-text.js";

interface FractionTextOptions {
  x: number;
  y: number;
  fontSize: number;
  alignment: "start" | "middle" | "end";
  color: string;
  bold?: boolean;
  italic?: boolean;
}

/** Mixed text needs sibling SVG text and line elements to keep every fraction bar. */
export function renderFractionText(
  content: RichTextDocument,
  profile: SchematicStyleProfile,
  options: FractionTextOptions,
): string | null {
  if (!containsFractionRun(content)) return null;
  const measure = (runs: RichTextRun[], fontSize: number) =>
    measureRichTextDocument(
      { runs },
      { ...richTextMetrics(profile), fontSize, fractionText: true },
    );
  const hasFraction = (run: RichTextRun) =>
    containsFractionRun({ runs: [run] });
  const number = (value: number) => String(Number(value.toFixed(6)));
  const line = (x1: number, x2: number, y: number, role: string) =>
    `<line data-role="${role}" x1="${number(x1)}" x2="${number(x2)}" y1="${number(y)}" y2="${number(y)}" stroke="${options.color}" stroke-width="${profile.strokes.annotation}"/>`;

  const render = (runs: RichTextRun[], at: FractionTextOptions): string => {
    const lines: RichTextRun[][] = [[]];
    // Reopen styling on each line, including a multiline bold selection.
    const append = (
      run: RichTextRun,
      wrappers: Extract<RichTextRun, { kind: "span" }>[] = [],
    ): void => {
      if (run.kind === "line-break") {
        lines.push([]);
        return;
      }
      if (
        run.kind === "span" &&
        run.children.some((child) => child.kind === "line-break")
      ) {
        run.children.forEach((child) => append(child, [...wrappers, run]));
        return;
      }
      lines
        .at(-1)!
        .push(
          wrappers.reduceRight<RichTextRun>(
            (child, wrapper) => ({ ...wrapper, children: [child] }),
            run,
          ),
        );
    };
    runs.forEach((run) => append(run));
    let baseline = at.y;
    let previousHeight = 0;
    return lines
      .map((lineRuns, index) => {
        const layout = measure(lineRuns, at.fontSize);
        if (index) baseline += (previousHeight + layout.height) / 2;
        previousHeight = layout.height;
        let x =
          at.alignment === "start"
            ? at.x
            : at.alignment === "end"
              ? at.x - layout.width
              : at.x - layout.width / 2;
        let output = "";
        let ordinary: RichTextRun[] = [];
        const flush = () => {
          if (!ordinary.length) return;
          const document = { runs: ordinary };
          const width = measure(ordinary, at.fontSize).width;
          const positioned = renderPositionedOverbarScriptDocument(
            document,
            profile,
            {
              x,
              y: baseline,
              fontSize: at.fontSize,
              alignment: "start",
              color: at.color,
              defaultBold: at.bold ?? false,
              defaultItalic: at.italic ?? false,
            },
          );
          const text =
            positioned?.tspans ??
            renderRichTextDocument(document, profile, {
              lineOriginX: x,
              fontSize: at.fontSize,
              defaultBold: at.bold ?? false,
              defaultItalic: at.italic ?? false,
            });
          // A standalone plain numerator or denominator can use the browser's
          // native glyph advances for alignment. This keeps wide glyphs such
          // as W/M centered without reintroducing textLength glyph scaling.
          const standalonePlain =
            !positioned && ordinary.length === lineRuns.length && !output;
          const textAnchor = standalonePlain ? at.alignment : "start";
          const textX = standalonePlain ? at.x : x;
          const markup = `<text x="${number(textX)}" y="${number(baseline)}" text-anchor="${textAnchor}" font-size="${number(at.fontSize)}" font-weight="${at.bold ? "bold" : "normal"}" font-style="${at.italic ? "italic" : "normal"}" fill="${at.color}" color="${at.color}" xml:space="preserve">${text}</text>${positioned?.decorations ?? ""}`;
          // A deterministic advance may position the independent bar and
          // scripts, but it must not scale the glyph outlines. In particular,
          // narrow letters such as `f` were visibly widened when this group
          // was forced back to the generic fraction measurement.
          output += markup;
          x += positioned?.width ?? width;
          ordinary = [];
        };
        for (const run of lineRuns) {
          if (!hasFraction(run)) {
            ordinary.push(run);
            continue;
          }
          flush();
          const width = measure([run], at.fontSize).width;
          if (run.kind === "fraction") {
            const partFont =
              at.fontSize *
              fractionPartScale(profile.typography.subscriptScale);
            const center = x + width / 2;
            const barY = baseline - partFont * fractionGeometry.barRiseEm;
            const numeratorY =
              baseline - partFont * fractionGeometry.numeratorBaselineRiseEm;
            const denominatorY =
              baseline + partFont * fractionGeometry.denominatorBaselineDropEm;
            output += `<g data-role="fraction-numerator">${render(run.numerator.runs, { ...at, x: center, y: numeratorY, fontSize: partFont, alignment: "middle" })}</g>`;
            output += line(x, x + width, barY, "fraction-bar");
            output += `<g data-role="fraction-denominator">${render(run.denominator.runs, { ...at, x: center, y: denominatorY, fontSize: partFont, alignment: "middle" })}</g>`;
          } else if (run.kind === "span") {
            const script =
              run.style === "subscript" || run.style === "superscript";
            const fontSize = script
              ? at.fontSize * profile.typography.subscriptScale
              : at.fontSize;
            const offset = script
              ? fontSize *
                profile.typography.subscriptBaselineShiftEm *
                (run.style === "subscript" ? 1 : -1)
              : 0;
            output += render(run.children, {
              ...at,
              x,
              y: baseline + offset,
              fontSize,
              alignment: "start",
              bold: at.bold || run.style === "bold",
              italic: at.italic || run.style === "italic",
            });
            if (run.style === "overbar")
              output += line(
                x,
                x + width,
                baseline - measure(run.children, fontSize).height / 2,
                "overbar",
              );
          }
          x += width;
        }
        flush();
        return output;
      })
      .join("");
  };
  return render(content.runs, options);
}
