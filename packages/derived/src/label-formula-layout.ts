// The formula tree set in label type: TeX's spacing, fractions, scripts,
// radicals, fences and arrays, measured with the label advance tables.
import { schematicTextAdvanceEm } from "./fraction-text-metrics.js";
import type {
  LabelFormulaGlyph,
  LabelFormulaLayout,
  LabelFormulaOptions,
} from "./label-formula.js";
import type {
  Align,
  AtomClass,
  AtomNode,
  Node,
  Style,
} from "./label-formula-nodes.js";

const THIN = 1 / 6;
const MEDIUM = 2 / 9;
const THICK = 5 / 18;
/** Fraction bar and overline thickness, em. */
const RULE_EM = 0.065;
/** Height of the math axis the fraction bar sits on, em. */
const AXIS_EM = 0.3;

const TALL =
  /[A-Z0-9bdfhijkltβδζθλξ∂()[\]{}|/√∫∑∏ΓΔΘΛΞΠΣΥΦΨΩ!?′'"‖⟨⟩⌈⌉⌊⌋ℂℍℕℙℚℝℤℬℰℱℋℐℒℳℛℭℌℑℜℨ\u{1D400}-\u{1D7FF}]/u;
const DESCENDING = /[gjpqyβγζημξρφϕχψς,;()[\]{}|/√⟨⟩⌈⌉⌊⌋‖]/u;

function spaceBetween(left: AtomClass, right: AtomClass): number {
  if (left === "punct") return THIN;
  if (left === "open" || right === "close" || right === "punct") return 0;
  if (left === "rel" || right === "rel") return THICK;
  if (left === "bin" || right === "bin") return MEDIUM;
  if (left === "op" && right === "open") return 0;
  if (left === "op" || right === "op") return THIN;
  return 0;
}

const scriptStyleOf = (style: Style): Style => (style <= 1 ? 2 : 3);

/** An operator whose scripts stand above and below it in this style. */
function limitsHere(base: Node, style: Style): boolean {
  return (
    style === 0 &&
    (base.kind === "atom" || base.kind === "group") &&
    classOf(base) === "op" &&
    base.limits === true
  );
}

class Layout {
  private nextFlow = 0;

  constructor(private readonly options: LabelFormulaOptions) {}

  size(style: Style): number {
    const scale = this.options.subscriptScale;
    return (
      this.options.fontSize *
      (style <= 1 ? 1 : style === 2 ? scale : Math.max(0.5, scale * scale))
    );
  }

  private glyph(
    text: string,
    size: number,
    italic: boolean,
    bold: boolean,
  ): LabelFormulaLayout {
    // Oblique faces keep the upright advances, as label text measures them.
    const width = schematicTextAdvanceEm(text, bold ? "bold" : "plain") * size;
    const chars = [...text];
    const ascent = chars.some((char) => TALL.test(char))
      ? 0.74 * size
      : 0.55 * size;
    const descent = chars.some((char) => DESCENDING.test(char))
      ? 0.22 * size
      : 0;
    return {
      width,
      ascent,
      descent,
      items: [
        { kind: "glyph", x: 0, y: 0, text, size, italic, bold, advance: width },
      ],
    };
  }

  /**
   * Children in a row, with TeX's inter-atom spacing in text styles. `edges`
   * marks a fence or radical sign standing just outside the row's start or
   * end, which a run there keeps against.
   */
  list(
    nodes: Node[],
    rowStyle: Style,
    edges: { start?: boolean; end?: boolean } = {},
  ): LabelFormulaLayout {
    let style = rowStyle;
    let size = this.size(style);
    const row: LabelFormulaLayout = {
      width: 0,
      ascent: 0,
      descent: 0,
      items: [],
    };
    let previous: AtomClass | null = null;
    // The run the next flowing node joins; a fraction, radical or fence ends
    // it.
    let flow: number | null = null;
    // The row's visible parts in order: a run by its flow, a box as null.
    const parts: (number | null)[] = [];
    for (const node of nodes) {
      // \displaystyle and its kin set the rest of the row.
      if (node.kind === "style") {
        style = node.style;
        size = this.size(style);
        continue;
      }
      // Explicit space neither takes nor moves operator spacing.
      const visible = node.kind !== "space";
      let cls = classOf(node);
      // A sign that opens an expression, or follows another operator, is
      // unary and takes no space of its own.
      if (
        cls === "bin" &&
        (previous === null ||
          previous === "bin" ||
          previous === "rel" ||
          previous === "open" ||
          previous === "punct" ||
          previous === "op")
      )
        cls = "ord";
      if (visible && previous !== null && style <= 1)
        row.width += spaceBetween(previous, cls) * size;
      const box = this.node(node, style);
      if (flowable(node, style)) {
        flow ??= this.nextFlow++;
        for (const item of box.items)
          if (item.kind === "glyph") item.flow = flow;
      } else flow = null;
      if (visible && (flow === null || parts.at(-1) !== flow)) parts.push(flow);
      append(row, box, row.width, 0);
      row.width += box.width;
      if (visible) previous = cls;
    }
    parts.forEach((run, index) => {
      if (run === null) return;
      const first = index === 0;
      const last = index === parts.length - 1;
      const anchor =
        first && last
          ? edges.start && !edges.end
            ? "start"
            : edges.end && !edges.start
              ? "end"
              : "middle"
          : first
            ? edges.start
              ? "start"
              : "end"
            : last
              ? edges.end
                ? "end"
                : "start"
              : "middle";
      for (const item of row.items)
        if (item.kind === "glyph" && item.flow === run) item.anchor = anchor;
    });
    return row;
  }

  /**
   * A large operator, bigger in display style, its middle on the math axis:
   * both reach a little below the baseline (ink measured in DejaVu Sans and
   * Arial Bold: a sum -0.21..0.73 em, an integral -0.23..0.91 em).
   */
  private largeOperator(node: AtomNode, style: Style): LabelFormulaLayout {
    const size = this.size(style);
    const integral = node.large === "integral";
    const factor = style === 0 ? (integral ? 1.9 : 1.6) : integral ? 1.3 : 1.1;
    const opSize = size * factor;
    const glyph = this.glyph(
      node.text,
      opSize,
      false,
      node.bold ?? this.options.bold,
    );
    const [inkBottom, inkTop] = integral ? [-0.23, 0.91] : [-0.21, 0.73];
    const y = ((inkBottom + inkTop) / 2) * opSize - AXIS_EM * size;
    return {
      width: glyph.width,
      ascent: inkTop * opSize - y,
      descent: y - inkBottom * opSize,
      items: [{ ...(glyph.items[0] as LabelFormulaGlyph), y }],
    };
  }

  /** A delimiter drawn to a set height, centred on the math axis. */
  private sizedDelimiter(node: AtomNode, style: Style): LabelFormulaLayout {
    const size = this.size(style);
    const glyph = this.glyph(
      node.text,
      size,
      false,
      node.bold ?? this.options.bold,
    );
    const scale = node.stretch! / 0.96;
    const y = 0.26 * size * scale - AXIS_EM * size;
    return {
      width: glyph.width,
      ascent: 0.74 * size * scale - y,
      descent: 0.22 * size * scale + y,
      items: [
        {
          ...(glyph.items[0] as LabelFormulaGlyph),
          y,
          scaleY: scale,
          ...(node.cls === "open"
            ? { hug: "right" as const }
            : node.cls === "close"
              ? { hug: "left" as const }
              : {}),
        },
      ],
    };
  }

  /** A base with parts centred above and below it, in script size. */
  private stacked(
    base: LabelFormulaLayout,
    over: LabelFormulaLayout | null,
    under: LabelFormulaLayout | null,
    size: number,
  ): LabelFormulaLayout {
    const width = Math.max(base.width, over?.width ?? 0, under?.width ?? 0);
    const gap = 0.12 * size;
    const box: LabelFormulaLayout = {
      width,
      ascent: base.ascent,
      descent: base.descent,
      items: [],
    };
    append(box, base, (width - base.width) / 2, 0);
    if (over)
      append(
        box,
        over,
        (width - over.width) / 2,
        -(base.ascent + gap + over.descent),
      );
    if (under)
      append(
        box,
        under,
        (width - under.width) / 2,
        base.descent + gap + under.ascent,
      );
    return box;
  }

  node(node: Node, style: Style): LabelFormulaLayout {
    const size = this.size(style);
    const bold = this.options.bold;
    switch (node.kind) {
      case "atom": {
        if (node.large) return this.largeOperator(node, style);
        if (node.stretch) return this.sizedDelimiter(node, style);
        const glyph = this.glyph(
          node.text,
          size,
          node.font === "italic",
          node.bold ?? bold,
        );
        // A \middle fence is found again once its fences are sized.
        if (node.middle) middleFences.add(glyph.items[0] as LabelFormulaGlyph);
        return glyph;
      }
      case "space":
        return { width: node.em * size, ascent: 0, descent: 0, items: [] };
      case "style":
        return { width: 0, ascent: 0, descent: 0, items: [] };
      case "group":
        return this.list(node.children, style);
      case "phantom": {
        const body = this.list(node.body, style);
        return {
          width: node.width ? body.width : 0,
          ascent: node.height ? body.ascent : 0,
          descent: node.height ? body.descent : 0,
          items: [],
        };
      }
      case "frac": {
        const own: Style =
          node.force === "display" ? 0 : node.force === "text" ? 1 : style;
        const part: Style = own === 0 ? 1 : own === 1 ? 2 : 3;
        const fracSize = this.size(own);
        const num = this.list(node.num, part);
        const den = this.list(node.den, part);
        const axis = AXIS_EM * fracSize;
        const rule = RULE_EM * fracSize;
        const gap = (own === 0 ? 0.16 : 0.1) * fracSize;
        const pad = 0.12 * fracSize;
        const inner = Math.max(num.width, den.width);
        const width = inner + 2 * pad;
        const numY = -(axis + rule / 2 + gap + num.descent);
        const denY = -axis + rule / 2 + gap + den.ascent;
        const box: LabelFormulaLayout = {
          width,
          ascent: -numY + num.ascent,
          descent: denY + den.descent,
          items:
            node.bar === false
              ? []
              : [
                  {
                    kind: "rule",
                    x1: pad / 2,
                    x2: width - pad / 2,
                    y: -axis,
                    thickness: rule,
                  },
                ],
        };
        append(box, num, pad + (inner - num.width) / 2, numY);
        append(box, den, pad + (inner - den.width) / 2, denY);
        return box;
      }
      case "scripts": {
        const scriptStyle = scriptStyleOf(style);
        const scriptSize = this.size(scriptStyle);
        if (node.base && limitsHere(node.base, style))
          return this.stacked(
            this.node(node.base, style),
            node.sup ? this.list(node.sup, scriptStyle) : null,
            node.sub ? this.list(node.sub, scriptStyle) : null,
            size,
          );
        const base = node.base
          ? this.node(node.base, style)
          : { width: 0, ascent: 0, descent: 0, items: [] };
        const italicBase =
          node.base?.kind === "atom" && node.base.font === "italic";
        const integral =
          node.base?.kind === "atom" && node.base.large === "integral";
        // As a label sets it: a subscript follows by the profile gap in its
        // own size; a superscript clears an italic letter's or an
        // integral's slant.
        const gap =
          this.options.subscriptHorizontalGapEm * scriptSize -
          (integral ? 0.12 * size : 0);
        const slant = integral ? 0.1 * size : italicBase ? 0.04 * size : 0;
        const box: LabelFormulaLayout = {
          width: base.width,
          ascent: base.ascent,
          descent: base.descent,
          items: [],
        };
        append(box, base, 0, 0);
        let scriptWidth = 0;
        // A script keeps against its base; on a flowing base its glyphs join
        // the base's run instead.
        const sup = node.sup
          ? this.list(node.sup, scriptStyle, { start: true })
          : null;
        const sub = node.sub
          ? this.list(node.sub, scriptStyle, { start: true })
          : null;
        // As a label sets it: the subscript drops by its own shift.
        let subY = sub
          ? Math.max(
              scriptSize * this.options.subscriptBaselineShiftEm,
              base.descent + sub.ascent - 0.8 * base.ascent,
            )
          : 0;
        let supY = sup
          ? -Math.max(0.42 * size, base.ascent - 0.3 * scriptSize)
          : 0;
        if (sub && sup) {
          const clearance = subY - sub.ascent - (supY + sup.descent);
          if (clearance < 0.12 * size) {
            const push = 0.12 * size - clearance;
            subY += push / 2;
            supY -= push / 2;
          }
        }
        // The script that reaches further goes last, so text flowing on from
        // it starts after both.
        const scripts = [
          ...(sup ? [{ box: sup, x: slant, y: supY }] : []),
          ...(sub ? [{ box: sub, x: gap, y: subY }] : []),
        ].sort((a, b) => a.x + a.box.width - (b.x + b.box.width));
        for (const script of scripts) {
          append(box, script.box, base.width + script.x, script.y);
          scriptWidth = Math.max(scriptWidth, script.x + script.box.width);
        }
        box.width = base.width + Math.max(0, scriptWidth);
        return box;
      }
      case "stack": {
        const scriptStyle = scriptStyleOf(style);
        return this.stacked(
          this.list(node.base, style),
          node.over ? this.list(node.over, scriptStyle) : null,
          node.under ? this.list(node.under, scriptStyle) : null,
          size,
        );
      }
      case "xarrow": {
        const scriptStyle = scriptStyleOf(style);
        const over = this.list(node.over, scriptStyle);
        const under = node.under ? this.list(node.under, scriptStyle) : null;
        const arrow = this.glyph(node.arrow, size, false, bold);
        const reach = Math.max(over.width, under?.width ?? 0) + 0.6 * size;
        const scaleX = Math.max(1, reach / arrow.width);
        const width = arrow.width * scaleX;
        const box: LabelFormulaLayout = {
          width,
          ascent: 0.55 * size,
          descent: 0,
          items: [
            {
              ...(arrow.items[0] as LabelFormulaGlyph),
              x: (width - arrow.width) / 2,
              ...(scaleX > 1 ? { scaleX } : {}),
            },
          ],
        };
        // The arrow sits on the math axis; its text clears it above and
        // below.
        append(
          box,
          over,
          (width - over.width) / 2,
          -(0.6 * size + over.descent),
        );
        if (under)
          append(
            box,
            under,
            (width - under.width) / 2,
            under.ascent + 0.02 * size,
          );
        return box;
      }
      case "accent": {
        const body = this.list(node.body, style);
        const markSize = node.arrow ? 0.75 * size : size;
        const mark = this.glyph(node.mark, markSize, false, bold);
        // A single slanted letter carries its mark a little to the right.
        const letter = node.body.length === 1 ? node.body[0] : undefined;
        const skew =
          letter?.kind === "atom" && letter.font === "italic" ? 0.08 * size : 0;
        const scaleX =
          node.wide && body.width > mark.width
            ? Math.min(8, body.width / mark.width)
            : 1;
        const width = Math.max(body.width, mark.width * scaleX);
        // Marks sit above the x-height: over a taller body they rise with
        // it. An arrow's own ink is lower in its em, so it rises further.
        const y = node.arrow
          ? -(body.ascent + 0.06 * size - 0.14 * markSize)
          : -Math.max(0, body.ascent - 0.55 * size);
        const box: LabelFormulaLayout = {
          width,
          ascent: Math.max(
            body.ascent,
            (node.arrow ? 0.5 * markSize : 0.8 * markSize) - y,
          ),
          descent: body.descent,
          items: [],
        };
        append(box, body, (width - body.width) / 2, 0);
        box.items.push({
          ...(mark.items[0] as LabelFormulaGlyph),
          x: (width - mark.width) / 2 + skew,
          y,
          ...(scaleX > 1 ? { scaleX } : {}),
        });
        return box;
      }
      case "radical": {
        const body = this.list(node.body, style, { start: true });
        const rule = RULE_EM * size;
        // The overbar clears the body; the sign reaches just below it.
        const top = Math.max(body.ascent, 0.7 * size) + 0.12 * size;
        const bottom = Math.max(body.descent, 0.08 * size);
        const height = top + bottom;
        // The sign is drawn, not typed: a short hook, a stroke down to a
        // vertex under the body, and a long stroke up into the overbar, as
        // one line. A font's √ is a different height in every face, and
        // never met its overbar exactly.
        const signWidth = Math.min(0.9 * size, 0.42 * size + 0.12 * height);
        const bodyX = signWidth + 0.06 * size;
        const end = bodyX + body.width + 0.06 * size;
        const up = (share: number) => bottom - share * height;
        const radical: LabelFormulaLayout = {
          width: end,
          ascent: top + rule / 2,
          descent: bottom + rule / 2,
          items: [
            {
              kind: "path",
              points: [
                { x: 0, y: up(0.42) },
                { x: 0.16 * signWidth, y: up(0.5) },
                { x: 0.45 * signWidth, y: up(0) },
                { x: signWidth, y: -top },
                { x: end, y: -top },
              ],
              thickness: rule,
            },
          ],
        };
        append(radical, body, bodyX, 0);
        if (!node.index) return radical;
        // The index stands small above the hook, in the crook of the sign.
        const index = this.list(node.index, 3, { end: true });
        const crook = 0.4 * signWidth;
        const shift = Math.max(0, index.width - crook);
        const box: LabelFormulaLayout = {
          width: shift + radical.width,
          ascent: radical.ascent,
          descent: radical.descent,
          items: [],
        };
        append(box, radical, shift, 0);
        append(
          box,
          index,
          shift + crook - index.width,
          up(0.58) - index.descent,
        );
        return box;
      }
      case "overline":
      case "underline": {
        const body = this.list(node.body, style);
        const clearance = 0.1 * size;
        const rule = RULE_EM * size;
        const over = node.kind === "overline";
        const box: LabelFormulaLayout = {
          width: body.width,
          ascent: over ? body.ascent + clearance + rule : body.ascent,
          descent: over ? body.descent : body.descent + clearance + rule,
          items: [
            {
              kind: "rule",
              x1: 0,
              x2: body.width,
              y: over ? -(body.ascent + clearance) : body.descent + clearance,
              thickness: rule,
            },
          ],
        };
        append(box, body, 0, 0);
        return box;
      }
      case "array":
        return this.array(node, style);
      case "delimited": {
        const body = this.list(node.body, style, {
          start: node.left !== null,
          end: node.right !== null,
        });
        const height =
          Math.max(body.ascent, 0.74 * size) +
          Math.max(body.descent, 0.22 * size);
        const scale = Math.max(1, height / (0.96 * size));
        const middle = (body.descent - body.ascent) / 2;
        // A fence taller than a line stretches about its baseline and is
        // centred on the body; a short one stands on the baseline.
        const fenceY = scale > 1 ? middle + 0.26 * size * scale : 0;
        const box: LabelFormulaLayout = {
          width: 0,
          ascent: Math.max(body.ascent, 0.74 * size),
          descent: Math.max(body.descent, 0.22 * size),
          items: [],
        };
        const fence = (text: string, hug: "left" | "right") => {
          const glyph = this.glyph(text, size, false, bold);
          const item = glyph.items[0] as LabelFormulaGlyph;
          box.items.push({
            ...item,
            x: box.width,
            y: fenceY,
            hug,
            ...(scale > 1 ? { scaleY: scale } : {}),
          });
          box.ascent = Math.max(box.ascent, 0.76 * size * scale - fenceY);
          box.descent = Math.max(box.descent, 0.24 * size * scale + fenceY);
          box.width += glyph.width;
        };
        if (node.left) fence(node.left, "right");
        const start = box.items.length;
        append(box, body, box.width, 0);
        // A \middle fence stretches with the outer ones.
        for (const item of box.items.slice(start))
          if (item.kind === "glyph" && middleFences.has(item) && scale > 1) {
            item.y = fenceY;
            item.scaleY = scale;
          }
        box.width += body.width;
        if (node.right) fence(node.right, "left");
        return box;
      }
    }
  }

  /** Rows and columns: a matrix, cases or aligned equations. */
  private array(
    node: Extract<Node, { kind: "array" }>,
    style: Style,
  ): LabelFormulaLayout {
    const size = this.size(style);
    const cellStyle =
      node.cellStyle === 1 && style >= 2 ? style : node.cellStyle;
    const alignOf = (column: number): Align =>
      node.align === "rl"
        ? column % 2 === 0
          ? "r"
          : "l"
        : (node.align[column] ?? node.align.at(-1) ?? "c");
    const cells = node.rows.map((row) =>
      row.map((cell, column) => {
        const align = alignOf(column);
        // Aligned rows join at the relation that starts a right-hand cell,
        // which spaces as though something stood before it.
        const nodes: Node[] =
          node.gaps === "aligned" && column % 2 === 1
            ? [{ kind: "group", children: [] }, ...cell]
            : cell;
        return this.list(
          nodes,
          cellStyle,
          align === "l" ? { start: true } : align === "r" ? { end: true } : {},
        );
      }),
    );
    const columns = Math.max(...cells.map((row) => row.length));
    const widths = Array.from({ length: columns }, (_, column) =>
      Math.max(0, ...cells.map((row) => row[column]?.width ?? 0)),
    );
    const gapAfter = (column: number) =>
      node.gaps === "aligned"
        ? column % 2 === 0
          ? 0
          : 2 * size
        : node.gaps === "cases"
          ? 1 * size
          : 0.9 * size;
    const starts: number[] = [];
    let x = 0;
    for (let column = 0; column < columns; column += 1) {
      starts.push(x);
      x += widths[column]! + (column < columns - 1 ? gapAfter(column) : 0);
    }
    const width = x;
    const ascents = cells.map((row) =>
      Math.max(0.74 * size, ...row.map((cell) => cell.ascent)),
    );
    const descents = cells.map((row) =>
      Math.max(0.22 * size, ...row.map((cell) => cell.descent)),
    );
    const cellSize = this.size(cellStyle);
    const baselines: number[] = [0];
    for (let row = 1; row < cells.length; row += 1)
      baselines.push(
        baselines[row - 1]! +
          Math.max(
            1.2 * cellSize + (node.gaps === "aligned" ? 0.3 * size : 0),
            descents[row - 1]! + ascents[row]! + 0.2 * size,
          ),
      );
    const top = -ascents[0]!;
    const bottom = baselines.at(-1)! + descents.at(-1)!;
    // The whole block centres on the math axis.
    const shift = -AXIS_EM * size - (top + bottom) / 2;
    const box: LabelFormulaLayout = {
      width,
      ascent: -(top + shift),
      descent: bottom + shift,
      items: [],
    };
    cells.forEach((row, rowIndex) =>
      row.forEach((cell, column) => {
        const align = alignOf(column);
        const slack = widths[column]! - cell.width;
        append(
          box,
          cell,
          starts[column]! +
            (align === "l" ? 0 : align === "r" ? slack : slack / 2),
          baselines[rowIndex]! + shift,
        );
      }),
    );
    return box;
  }
}

/** Glyph items laid out from \middle atoms, found again by their fences. */
const middleFences = new WeakSet<LabelFormulaGlyph>();

/**
 * Symbols, spaces and scripted symbols flow as text; a fraction, radical,
 * accent, stack, array or fence is placed as a box.
 */
function flowable(node: Node, style: Style): boolean {
  switch (node.kind) {
    case "atom":
      return !node.stretch && !node.middle;
    case "space":
    case "style":
    case "phantom":
      return true;
    case "group":
      return node.children.every((child) => flowable(child, style));
    case "scripts":
      return (
        !(node.base && limitsHere(node.base, style)) &&
        (node.base === null || flowable(node.base, style)) &&
        (node.sub ?? []).every((child) =>
          flowable(child, scriptStyleOf(style)),
        ) &&
        (node.sup ?? []).every((child) => flowable(child, scriptStyleOf(style)))
      );
    case "frac":
    case "radical":
    case "accent":
    case "overline":
    case "underline":
    case "stack":
    case "xarrow":
    case "array":
    case "delimited":
      return false;
  }
}

function classOf(node: Node): AtomClass {
  switch (node.kind) {
    case "atom":
      return node.cls;
    case "group":
      return node.cls ?? "ord";
    case "scripts":
      return node.base ? classOf(node.base) : "ord";
    case "stack":
      return node.base.length === 1 ? classOf(node.base[0]!) : "ord";
    case "xarrow":
      return "rel";
    case "space":
    case "style":
    case "phantom":
    case "frac":
    case "radical":
    case "accent":
    case "overline":
    case "underline":
    case "array":
    case "delimited":
      return "ord";
  }
}

/** Place `child` in `box` at an offset, growing the box's vertical extent. */
function append(
  box: LabelFormulaLayout,
  child: LabelFormulaLayout,
  x: number,
  y: number,
): void {
  for (const item of child.items) {
    if (item.kind === "glyph") {
      const moved = { ...item, x: item.x + x, y: item.y + y };
      if (middleFences.has(item)) middleFences.add(moved);
      box.items.push(moved);
    } else if (item.kind === "path")
      box.items.push({
        ...item,
        points: item.points.map((point) => ({
          x: point.x + x,
          y: point.y + y,
        })),
      });
    else
      box.items.push({
        ...item,
        x1: item.x1 + x,
        x2: item.x2 + x,
        y: item.y + y,
      });
  }
  box.ascent = Math.max(box.ascent, child.ascent - y);
  box.descent = Math.max(box.descent, child.descent + y);
}

export function layout(
  nodes: Node[],
  options: LabelFormulaOptions,
): LabelFormulaLayout {
  return new Layout(options).list(nodes, options.display === "block" ? 0 : 1);
}
