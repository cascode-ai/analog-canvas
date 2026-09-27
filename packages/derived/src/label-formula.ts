import { GREEK_LETTERS } from "@icm/model";

import { schematicTextAdvanceEm } from "./fraction-text-metrics.js";

/**
 * A LaTeX formula set in the labels' own type: the schematic label font, a
 * letter in italic, a subscript, digit or operator upright — V_{in} reads as
 * the label V_in does. Layout follows TeX's rules for fractions, scripts and
 * operator spacing, measured with the same advance tables as label text, so
 * a formula and a label beside it match glyph for glyph.
 *
 * Only a common subset of LaTeX is set this way. Anything else — large
 * operators, matrices, accents, special alphabets — returns null, and the
 * formula keeps its MathJax typesetting.
 */
export interface LabelFormulaGlyph {
  kind: "glyph";
  /** Left edge from the formula's left edge. */
  x: number;
  /** Baseline offset from the formula's baseline, positive downward. */
  y: number;
  text: string;
  size: number;
  italic: boolean;
  bold: boolean;
  /** The glyph's width by the label advance tables. */
  advance: number;
  /**
   * Glyphs sharing a flow are one run of text — symbols, operators and their
   * scripts — drawn as label text is, each after the last by the real font's
   * advance, so their spacing matches a label's in whatever font the viewer
   * has. Fractions, radicals and fences are placed by the layout.
   */
  flow?: number;
  /**
   * Where a run of flowing glyphs stands in the space the layout gave it, when
   * the real font is narrower than the tables. A run keeps against the box
   * beside it — the first in a row against what follows, the last against
   * what precedes, one inside fences or a radical against them — so the
   * spare width falls at the row's outer edges, where nothing touches it.
   * A run between two boxes, or alone in its row, centres.
   */
  anchor?: "start" | "middle" | "end";
  /**
   * The side a fence or radical sign keeps against what it encloses: an
   * opening fence or a radical sign its right, a closing fence its left.
   */
  hug?: "left" | "right";
  /** Vertical stretch of a sized delimiter or radical, about its baseline. */
  scaleY?: number;
}

export interface LabelFormulaRule {
  kind: "rule";
  x1: number;
  x2: number;
  y: number;
}

export interface LabelFormulaLayout {
  width: number;
  /** Extent above the baseline. */
  ascent: number;
  /** Extent below the baseline. */
  descent: number;
  items: (LabelFormulaGlyph | LabelFormulaRule)[];
}

export interface LabelFormulaOptions {
  fontSize: number;
  bold: boolean;
  display: "inline" | "block";
  subscriptScale: number;
  subscriptBaselineShiftEm: number;
  subscriptHorizontalGapEm: number;
}

type AtomClass = "ord" | "op" | "bin" | "rel" | "open" | "close" | "punct";
type Font = "italic" | "upright";
type Node =
  | { kind: "atom"; text: string; cls: AtomClass; font: Font; bold?: boolean }
  | { kind: "group"; children: Node[] }
  | { kind: "frac"; num: Node[]; den: Node[]; force?: "display" | "text" }
  | { kind: "scripts"; base: Node | null; sub?: Node[]; sup?: Node[] }
  | { kind: "radical"; body: Node[] }
  | { kind: "overline"; body: Node[] }
  | { kind: "underline"; body: Node[] }
  | {
      kind: "delimited";
      left: string | null;
      right: string | null;
      body: Node[];
    }
  | { kind: "space"; em: number };

class Unsupported extends Error {}

/**
 * Greek letters as the label editor spells them, so `\phi` is the same φ in
 * a formula as in a label. The variant commands have no label spelling of
 * their own; each takes its Unicode variant, or the label's letter where
 * that is the same letter.
 */
const GREEK: Record<string, string> = {
  ...Object.fromEntries(
    GREEK_LETTERS.filter(({ latex }) => latex).map(({ name, glyph }) => [
      name,
      glyph,
    ]),
  ),
  varepsilon: "ε",
  vartheta: "ϑ",
  varpi: "ϖ",
  varrho: "ϱ",
  varsigma: "ς",
  varphi: "φ",
};

const SYMBOLS: Record<string, [string, AtomClass]> = {
  pm: ["±", "bin"],
  mp: ["∓", "bin"],
  times: ["×", "bin"],
  cdot: ["·", "bin"],
  div: ["÷", "bin"],
  ast: ["∗", "bin"],
  star: ["⋆", "bin"],
  circ: ["∘", "bin"],
  bullet: ["•", "bin"],
  oplus: ["⊕", "bin"],
  otimes: ["⊗", "bin"],
  cup: ["∪", "bin"],
  cap: ["∩", "bin"],
  wedge: ["∧", "bin"],
  vee: ["∨", "bin"],
  leq: ["≤", "rel"],
  le: ["≤", "rel"],
  geq: ["≥", "rel"],
  ge: ["≥", "rel"],
  neq: ["≠", "rel"],
  ne: ["≠", "rel"],
  approx: ["≈", "rel"],
  equiv: ["≡", "rel"],
  sim: ["∼", "rel"],
  simeq: ["≃", "rel"],
  cong: ["≅", "rel"],
  propto: ["∝", "rel"],
  // The label fonts lack ∥ and ∣; the double and single bars they have read
  // the same.
  parallel: ["‖", "rel"],
  to: ["→", "rel"],
  rightarrow: ["→", "rel"],
  leftarrow: ["←", "rel"],
  gets: ["←", "rel"],
  leftrightarrow: ["↔", "rel"],
  Rightarrow: ["⇒", "rel"],
  Leftarrow: ["⇐", "rel"],
  Leftrightarrow: ["⇔", "rel"],
  ll: ["≪", "rel"],
  gg: ["≫", "rel"],
  in: ["∈", "rel"],
  notin: ["∉", "rel"],
  subset: ["⊂", "rel"],
  supset: ["⊃", "rel"],
  subseteq: ["⊆", "rel"],
  supseteq: ["⊇", "rel"],
  perp: ["⊥", "rel"],
  mid: ["|", "rel"],
  infty: ["∞", "ord"],
  partial: ["∂", "ord"],
  nabla: ["∇", "ord"],
  degree: ["°", "ord"],
  circledast: ["⊛", "ord"],
  prime: ["′", "ord"],
  ldots: ["…", "ord"],
  cdots: ["⋯", "ord"],
  dots: ["…", "ord"],
  forall: ["∀", "ord"],
  exists: ["∃", "ord"],
  emptyset: ["∅", "ord"],
  angle: ["∠", "ord"],
  hbar: ["ℏ", "ord"],
  ell: ["ℓ", "ord"],
  langle: ["⟨", "open"],
  rangle: ["⟩", "close"],
  lceil: ["⌈", "open"],
  rceil: ["⌉", "close"],
  lfloor: ["⌊", "open"],
  rfloor: ["⌋", "close"],
  lvert: ["|", "open"],
  rvert: ["|", "close"],
  lbrace: ["{", "open"],
  rbrace: ["}", "close"],
};

const FUNCTIONS = new Set([
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "sinh",
  "cosh",
  "tanh",
  "arcsin",
  "arccos",
  "arctan",
  "log",
  "ln",
  "lg",
  "exp",
  "det",
  "dim",
  "ker",
  "max",
  "min",
  "sup",
  "inf",
  "arg",
  "deg",
  "gcd",
  "lim",
]);

const SPACES: Record<string, number> = {
  ",": 1 / 6,
  ":": 2 / 9,
  ">": 2 / 9,
  ";": 5 / 18,
  "!": -1 / 6,
  quad: 1,
  qquad: 2,
  enspace: 0.5,
  thinspace: 1 / 6,
  " ": 0.318,
};

const IGNORED = new Set([
  "big",
  "Big",
  "bigg",
  "Bigg",
  "bigl",
  "bigr",
  "Bigl",
  "Bigr",
  "biggl",
  "biggr",
  "Biggl",
  "Biggr",
  "bigm",
  "Bigm",
  "displaystyle",
  "textstyle",
  "limits",
  "nolimits",
]);

interface ParseContext {
  /** Letters upright: inside a subscript or an upright font command. */
  upright?: boolean;
  /** An explicit font command, over the subscript rule. */
  font?: Font;
  bold?: boolean;
  /** \text: spaces are kept as written. */
  text?: boolean;
}

function tokenize(latex: string): string[] {
  const tokens: string[] = [];
  const chars = [...latex];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!;
    if (char !== "\\") {
      tokens.push(char);
      continue;
    }
    let name = "";
    while (index + 1 < chars.length && /[A-Za-z]/u.test(chars[index + 1]!))
      name += chars[++index];
    if (!name && index + 1 < chars.length) name = chars[++index]!;
    tokens.push(`\\${name}`);
  }
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: string[]) {}

  parse(): Node[] {
    const nodes = this.list({}, null);
    if (this.index < this.tokens.length) throw new Unsupported("stray }");
    return nodes;
  }

  private peek() {
    return this.tokens[this.index];
  }

  private list(context: ParseContext, closer: string | null): Node[] {
    const nodes: Node[] = [];
    while (this.index < this.tokens.length) {
      const token = this.peek()!;
      if (token === closer) return nodes;
      if (token === "}") return nodes;
      if (closer === "\\right" && token === "\\right") return nodes;
      if (token === "^" || token === "_" || token === "'") {
        this.index += 1;
        this.script(nodes, token, context);
        continue;
      }
      this.index += 1;
      nodes.push(...this.node(token, context));
    }
    if (closer && closer !== "\\right") throw new Unsupported("unclosed group");
    return nodes;
  }

  /** One argument: a braced group, or the next single token. */
  private argument(context: ParseContext): Node[] {
    while (this.peek() === " ") this.index += 1;
    const next = this.peek();
    if (next === undefined) throw new Unsupported("missing argument");
    this.index += 1;
    if (next === "{") {
      const nodes = this.list(context, "}");
      if (this.peek() !== "}") throw new Unsupported("unclosed argument");
      this.index += 1;
      return nodes;
    }
    return this.node(next, context);
  }

  private script(nodes: Node[], token: string, context: ParseContext) {
    const last = nodes.at(-1);
    const target: Extract<Node, { kind: "scripts" }> =
      last?.kind === "scripts" &&
      (token === "_" ? !last.sub : !last.sup || token === "'")
        ? last
        : { kind: "scripts", base: nodes.pop() ?? null };
    if (target !== last) nodes.push(target);
    if (token === "'") {
      target.sup = [
        ...(target.sup ?? []),
        { kind: "atom", text: "′", cls: "ord", font: "upright" },
      ];
      return;
    }
    // A subscript names, so its letters stand upright as a label's do.
    const nested = this.argument(
      token === "_" ? { ...context, upright: true } : context,
    );
    if (token === "_") target.sub = nested;
    else target.sup = [...(target.sup ?? []), ...nested];
  }

  private delimiter(): string | null {
    while (this.peek() === " ") this.index += 1;
    const token = this.peek();
    if (token === undefined) throw new Unsupported("missing delimiter");
    this.index += 1;
    if (token === ".") return null;
    if (token === "\\{") return "{";
    if (token === "\\}") return "}";
    if (token === "\\|") return "‖";
    if (token.startsWith("\\")) {
      const symbol = SYMBOLS[token.slice(1)];
      if (!symbol) throw new Unsupported(token);
      return symbol[0];
    }
    return token;
  }

  private node(token: string, context: ParseContext): Node[] {
    if (token === "{") {
      const children = this.list(context, "}");
      if (this.peek() !== "}") throw new Unsupported("unclosed group");
      this.index += 1;
      return [{ kind: "group", children }];
    }
    if (token.startsWith("\\")) return this.command(token.slice(1), context);
    return atomsOf(token, context);
  }

  private command(name: string, context: ParseContext): Node[] {
    if (name in SPACES) return [{ kind: "space", em: SPACES[name]! }];
    if (IGNORED.has(name)) return [];
    if (name in GREEK) {
      const text = GREEK[name]!;
      const upper = text === text.toUpperCase();
      return [
        {
          kind: "atom",
          text,
          cls: "ord",
          font:
            context.font ?? (upper || context.upright ? "upright" : "italic"),
          ...(context.bold ? { bold: true } : {}),
        },
      ];
    }
    if (name in SYMBOLS) {
      const [text, cls] = SYMBOLS[name]!;
      return [{ kind: "atom", text, cls, font: "upright" }];
    }
    if (name === "|")
      return [{ kind: "atom", text: "‖", cls: "rel", font: "upright" }];
    if (name === "{" || name === "}")
      return [
        {
          kind: "atom",
          text: name,
          cls: name === "{" ? "open" : "close",
          font: "upright",
        },
      ];
    if (name === "%" || name === "&" || name === "#" || name === "$")
      return [{ kind: "atom", text: name, cls: "ord", font: "upright" }];
    if (FUNCTIONS.has(name))
      return [{ kind: "atom", text: name, cls: "op", font: "upright" }];
    switch (name) {
      case "frac":
      case "dfrac":
      case "tfrac":
      case "cfrac": {
        const num = this.argument({ ...context, text: false });
        const den = this.argument({ ...context, text: false });
        return [
          {
            kind: "frac",
            num,
            den,
            ...(name === "dfrac" || name === "cfrac"
              ? { force: "display" as const }
              : name === "tfrac"
                ? { force: "text" as const }
                : {}),
          },
        ];
      }
      case "sqrt":
        if (this.peek() === "[") throw new Unsupported("root index");
        return [{ kind: "radical", body: this.argument(context) }];
      case "overline":
      case "bar":
        return [{ kind: "overline", body: this.argument(context) }];
      case "underline":
        return [{ kind: "underline", body: this.argument(context) }];
      case "mathrm":
      case "mathup":
      case "mathsf":
      case "operatorname":
        return [
          {
            kind: "group",
            children: this.argument({ ...context, font: "upright" }),
          },
        ];
      case "text":
      case "textrm":
      case "textnormal":
      case "textsf":
      case "textup":
        return [
          {
            kind: "group",
            children: this.argument({
              ...context,
              font: "upright",
              text: true,
            }),
          },
        ];
      case "mathit":
      case "textit":
        return [
          {
            kind: "group",
            children: this.argument({ ...context, font: "italic" }),
          },
        ];
      case "mathbf":
      case "textbf":
      case "boldsymbol":
      case "bm":
        return [
          {
            kind: "group",
            children: this.argument({ ...context, bold: true }),
          },
        ];
      case "left": {
        const left = this.delimiter();
        const body = this.list(context, "\\right");
        if (this.peek() !== "\\right") throw new Unsupported("\\left alone");
        this.index += 1;
        const right = this.delimiter();
        return [{ kind: "delimited", left, right, body }];
      }
      case "right":
        throw new Unsupported("\\right alone");
      default:
        throw new Unsupported(`\\${name}`);
    }
  }
}

function atomsOf(char: string, context: ParseContext): Node[] {
  if (/\s/u.test(char))
    return context.text ? [{ kind: "space", em: 0.318 }] : [];
  if (char === "~") return [{ kind: "space", em: 0.318 }];
  const bold = context.bold ? { bold: true } : {};
  if (/\p{L}/u.test(char)) {
    const upperGreek = /[Α-Ω]/u.test(char);
    return [
      {
        kind: "atom",
        text: char,
        cls: "ord",
        font:
          context.font ??
          (context.upright || upperGreek ? "upright" : "italic"),
        ...bold,
      },
    ];
  }
  const upright = { font: "upright" as const, ...bold };
  if (/[0-9.]/u.test(char))
    return [{ kind: "atom", text: char, cls: "ord", ...upright }];
  if (context.text)
    return [{ kind: "atom", text: char, cls: "ord", ...upright }];
  if (char === "-")
    return [{ kind: "atom", text: "−", cls: "bin", ...upright }];
  if (char === "*")
    return [{ kind: "atom", text: "∗", cls: "bin", ...upright }];
  if ("+±×·÷∓".includes(char))
    return [{ kind: "atom", text: char, cls: "bin", ...upright }];
  if (char === "∥")
    return [{ kind: "atom", text: "‖", cls: "rel", ...upright }];
  if ("=<>≤≥≈≠→←↔∝∼≃≡:".includes(char))
    return [{ kind: "atom", text: char, cls: "rel", ...upright }];
  if (",;".includes(char))
    return [{ kind: "atom", text: char, cls: "punct", ...upright }];
  if ("([".includes(char))
    return [{ kind: "atom", text: char, cls: "open", ...upright }];
  if (")]!?".includes(char))
    return [{ kind: "atom", text: char, cls: "close", ...upright }];
  if ("&#$%^_\\".includes(char)) throw new Unsupported(char);
  return [{ kind: "atom", text: char, cls: "ord", ...upright }];
}

/** Display, text, script and scriptscript style, as TeX numbers them. */
type Style = 0 | 1 | 2 | 3;
const THIN = 1 / 6;
const MEDIUM = 2 / 9;
const THICK = 5 / 18;
/** Fraction bar and overline thickness, em. */
const RULE_EM = 0.065;
/** Height of the math axis the fraction bar sits on, em. */
const AXIS_EM = 0.3;

const TALL = /[A-Z0-9bdfhijkltβδζθλξ∂()[\]{}|/√∫∑∏ΓΔΘΛΞΠΣΥΦΨΩ!?′'"‖⟨⟩⌈⌉⌊⌋]/u;
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
    style: Style,
    edges: { start?: boolean; end?: boolean } = {},
  ): LabelFormulaLayout {
    const size = this.size(style);
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
      if (previous !== null && style <= 1)
        row.width += spaceBetween(previous, cls) * size;
      const box = this.node(node, style);
      if (flowable(node)) {
        flow ??= this.nextFlow++;
        for (const item of box.items)
          if (item.kind === "glyph") item.flow = flow;
      } else flow = null;
      if (node.kind !== "space" && (flow === null || parts.at(-1) !== flow))
        parts.push(flow);
      append(row, box, row.width, 0);
      row.width += box.width;
      if (node.kind !== "space") previous = cls;
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

  node(node: Node, style: Style): LabelFormulaLayout {
    const size = this.size(style);
    const bold = this.options.bold;
    switch (node.kind) {
      case "atom":
        return this.glyph(
          node.text,
          size,
          node.font === "italic",
          node.bold ?? bold,
        );
      case "space":
        return { width: node.em * size, ascent: 0, descent: 0, items: [] };
      case "group":
        return this.list(node.children, style);
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
          items: [{ kind: "rule", x1: pad / 2, x2: width - pad / 2, y: -axis }],
        };
        append(box, num, pad + (inner - num.width) / 2, numY);
        append(box, den, pad + (inner - den.width) / 2, denY);
        return box;
      }
      case "scripts": {
        const base = node.base
          ? this.node(node.base, style)
          : { width: 0, ascent: 0, descent: 0, items: [] };
        const scriptStyle: Style = style <= 1 ? 2 : 3;
        const scriptSize = this.size(scriptStyle);
        const italicBase =
          node.base?.kind === "atom" && node.base.font === "italic";
        // As a label sets it: a subscript follows by the profile gap in its
        // own size; a superscript clears an italic letter's slant.
        const gap = this.options.subscriptHorizontalGapEm * scriptSize;
        const slant = italicBase ? 0.04 * size : 0;
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
        box.width = base.width + scriptWidth;
        return box;
      }
      case "radical": {
        const body = this.list(node.body, style, { start: true });
        const clearance = 0.12 * size;
        const rule = RULE_EM * size;
        const top = Math.max(body.ascent, 0.7 * size) + clearance;
        const bottom = Math.max(body.descent, 0.1 * size);
        const sign = this.glyph("√", size, false, bold);
        const natural = 0.95 * size;
        const scale = Math.max(1, (top + rule + bottom) / natural);
        const signItem = sign.items[0] as LabelFormulaGlyph;
        // The sign spans 0.8 em above its baseline and 0.15 em below.
        const signY = bottom - 0.15 * size * scale;
        const box: LabelFormulaLayout = {
          width: sign.width + body.width + 0.08 * size,
          ascent: top + rule,
          descent: bottom,
          items: [
            {
              ...signItem,
              y: signY,
              hug: "right",
              ...(scale > 1 ? { scaleY: scale } : {}),
            },
            {
              kind: "rule",
              x1: sign.width * 0.92,
              x2: sign.width + body.width + 0.08 * size,
              y: -top,
            },
          ],
        };
        append(box, body, sign.width + 0.04 * size, 0);
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
            },
          ],
        };
        append(box, body, 0, 0);
        return box;
      }
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
        const box: LabelFormulaLayout = {
          width: 0,
          ascent: Math.max(body.ascent, 0.74 * size),
          descent: Math.max(body.descent, 0.22 * size),
          items: [],
        };
        const fence = (text: string, hug: "left" | "right") => {
          const glyph = this.glyph(text, size, false, bold);
          const item = glyph.items[0] as LabelFormulaGlyph;
          // A fence taller than a line stretches about its baseline and is
          // centred on the body; a short one stands on the baseline.
          const y = scale > 1 ? middle + 0.26 * size * scale : 0;
          box.items.push({
            ...item,
            x: box.width,
            y,
            hug,
            ...(scale > 1 ? { scaleY: scale } : {}),
          });
          box.ascent = Math.max(box.ascent, 0.76 * size * scale - y);
          box.descent = Math.max(box.descent, 0.24 * size * scale + y);
          box.width += glyph.width;
        };
        if (node.left) fence(node.left, "right");
        append(box, body, box.width, 0);
        box.width += body.width;
        if (node.right) fence(node.right, "left");
        return box;
      }
    }
  }
}

/**
 * Symbols, spaces and scripted symbols flow as text; a fraction, radical,
 * over- or underline, or fence is placed as a box.
 */
function flowable(node: Node): boolean {
  switch (node.kind) {
    case "atom":
    case "space":
      return true;
    case "group":
      return node.children.every(flowable);
    case "scripts":
      return (
        (node.base === null || flowable(node.base)) &&
        (node.sub ?? []).every(flowable) &&
        (node.sup ?? []).every(flowable)
      );
    default:
      return false;
  }
}

function classOf(node: Node): AtomClass {
  if (node.kind === "atom") return node.cls;
  if (node.kind === "scripts" && node.base) return classOf(node.base);
  if (node.kind === "delimited") return "ord";
  return "ord";
}

/** Place `child` in `box` at an offset, growing the box's vertical extent. */
function append(
  box: LabelFormulaLayout,
  child: LabelFormulaLayout,
  x: number,
  y: number,
): void {
  for (const item of child.items)
    box.items.push(
      item.kind === "glyph"
        ? { ...item, x: item.x + x, y: item.y + y }
        : { ...item, x1: item.x1 + x, x2: item.x2 + x, y: item.y + y },
    );
  box.ascent = Math.max(box.ascent, child.ascent - y);
  box.descent = Math.max(box.descent, child.descent + y);
}

/**
 * Lay out `latex` in label type, or null when it uses LaTeX this layout does
 * not set — then MathJax typesets it as before.
 */
export function layoutLabelFormula(
  latex: string,
  options: LabelFormulaOptions,
): LabelFormulaLayout | null {
  try {
    const nodes = new Parser(tokenize(latex.trim())).parse();
    if (nodes.length === 0) return null;
    return new Layout(options).list(nodes, options.display === "block" ? 0 : 1);
  } catch {
    // Unsupported LaTeX, or anything this layout cannot place: MathJax
    // typesets the formula as before.
    return null;
  }
}
