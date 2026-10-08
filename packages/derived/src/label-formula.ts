import { GREEK_LETTERS } from "@icm/model";

import { schematicTextAdvanceEm } from "./fraction-text-metrics.js";

/**
 * A LaTeX formula set in the labels' own type: the schematic label font, a
 * letter in italic, a subscript, digit or operator upright — V_{in} reads as
 * the label V_in does. Layout follows TeX's rules for fractions, scripts,
 * large operators and operator spacing, measured with the same advance
 * tables as label text, so a formula and a label beside it match glyph for
 * glyph.
 *
 * Everything the formula editor offers is set this way: fractions, roots,
 * scripts and limits, sums, products and integrals, accents, fences,
 * matrices, cases and aligned rows, and the symbol and font commands. LaTeX
 * outside that set returns null (`labelFormulaProblem` names what), and the
 * editor refuses it; a formula saved before then keeps its old typesetting.
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
  /** Horizontal stretch of a wide accent or arrow, about its centre. */
  scaleX?: number;
}

export interface LabelFormulaRule {
  kind: "rule";
  x1: number;
  x2: number;
  y: number;
  /** Line weight, in the text's own proportion, as TeX's rules are. */
  thickness: number;
}

/**
 * A stroke drawn rather than typed: a radical sign and its overbar as one
 * line, so they meet exactly whatever font the viewer has.
 */
export interface LabelFormulaPath {
  kind: "path";
  points: { x: number; y: number }[];
  thickness: number;
}

export interface LabelFormulaLayout {
  width: number;
  /** Extent above the baseline. */
  ascent: number;
  /** Extent below the baseline. */
  descent: number;
  items: (LabelFormulaGlyph | LabelFormulaRule | LabelFormulaPath)[];
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
type Alphabet = "double" | "script" | "fraktur" | "mono";
type Align = "l" | "c" | "r";
/** Display, text, script and scriptscript style, as TeX numbers them. */
type Style = 0 | 1 | 2 | 3;
type AtomNode = {
  kind: "atom";
  text: string;
  cls: AtomClass;
  font: Font;
  bold?: boolean;
  /** A large operator, set bigger than the text around it. */
  large?: "sum" | "integral";
  /** Its scripts stand above and below it in display style. */
  limits?: boolean;
  /** A delimiter drawn this many em tall (\big and its kin). */
  stretch?: number;
  /** A \middle delimiter, stretched with the fences around it. */
  middle?: boolean;
};
type ScriptsNode = {
  kind: "scripts";
  base: Node | null;
  sub?: Node[];
  sup?: Node[];
};
type Node =
  | AtomNode
  | { kind: "group"; children: Node[]; cls?: AtomClass; limits?: boolean }
  | {
      kind: "frac";
      num: Node[];
      den: Node[];
      force?: "display" | "text";
      /** False for a binomial: the parts stack without a bar. */
      bar?: boolean;
    }
  | ScriptsNode
  | { kind: "radical"; body: Node[]; index?: Node[] }
  | { kind: "overline"; body: Node[] }
  | { kind: "underline"; body: Node[] }
  | {
      kind: "accent";
      mark: string;
      body: Node[];
      /** Stretched across its body: \widehat, \overrightarrow. */
      wide?: boolean;
      /** An arrow, set small above its body: \vec. */
      arrow?: boolean;
    }
  | { kind: "stack"; base: Node[]; over?: Node[]; under?: Node[] }
  | { kind: "xarrow"; arrow: string; over: Node[]; under?: Node[] }
  | {
      kind: "delimited";
      left: string | null;
      right: string | null;
      body: Node[];
    }
  | {
      kind: "array";
      rows: Node[][][];
      /** Each column's alignment; "rl" alternates as aligned does. */
      align: Align[] | "rl";
      cellStyle: Style;
      gaps: "matrix" | "cases" | "aligned";
    }
  | { kind: "phantom"; body: Node[]; width: boolean; height: boolean }
  | { kind: "style"; style: Style }
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
  varkappa: "ϰ",
  digamma: "ϝ",
};

const SYMBOLS: Record<string, [string, AtomClass]> = {
  pm: ["±", "bin"],
  mp: ["∓", "bin"],
  times: ["×", "bin"],
  cdot: ["·", "bin"],
  cdotp: ["·", "punct"],
  div: ["÷", "bin"],
  ast: ["∗", "bin"],
  star: ["⋆", "bin"],
  circ: ["∘", "bin"],
  bullet: ["•", "bin"],
  oplus: ["⊕", "bin"],
  ominus: ["⊖", "bin"],
  otimes: ["⊗", "bin"],
  oslash: ["⊘", "bin"],
  odot: ["⊙", "bin"],
  cup: ["∪", "bin"],
  cap: ["∩", "bin"],
  sqcup: ["⊔", "bin"],
  sqcap: ["⊓", "bin"],
  uplus: ["⊎", "bin"],
  amalg: ["⨿", "bin"],
  wedge: ["∧", "bin"],
  land: ["∧", "bin"],
  vee: ["∨", "bin"],
  lor: ["∨", "bin"],
  setminus: ["∖", "bin"],
  wr: ["≀", "bin"],
  diamond: ["⋄", "bin"],
  bigtriangleup: ["△", "bin"],
  bigtriangledown: ["▽", "bin"],
  triangleleft: ["◁", "bin"],
  triangleright: ["▷", "bin"],
  dagger: ["†", "bin"],
  ddagger: ["‡", "bin"],
  leq: ["≤", "rel"],
  le: ["≤", "rel"],
  leqslant: ["⩽", "rel"],
  geq: ["≥", "rel"],
  ge: ["≥", "rel"],
  geqslant: ["⩾", "rel"],
  neq: ["≠", "rel"],
  ne: ["≠", "rel"],
  approx: ["≈", "rel"],
  approxeq: ["≊", "rel"],
  equiv: ["≡", "rel"],
  sim: ["∼", "rel"],
  simeq: ["≃", "rel"],
  cong: ["≅", "rel"],
  asymp: ["≍", "rel"],
  doteq: ["≐", "rel"],
  triangleq: ["≜", "rel"],
  coloneqq: ["≔", "rel"],
  lesssim: ["≲", "rel"],
  gtrsim: ["≳", "rel"],
  prec: ["≺", "rel"],
  succ: ["≻", "rel"],
  preceq: ["⪯", "rel"],
  succeq: ["⪰", "rel"],
  propto: ["∝", "rel"],
  varpropto: ["∝", "rel"],
  // The label fonts lack ∥ and ∣; the double and single bars they have read
  // the same.
  parallel: ["‖", "rel"],
  nparallel: ["∦", "rel"],
  to: ["→", "rel"],
  rightarrow: ["→", "rel"],
  leftarrow: ["←", "rel"],
  gets: ["←", "rel"],
  leftrightarrow: ["↔", "rel"],
  longrightarrow: ["⟶", "rel"],
  longleftarrow: ["⟵", "rel"],
  longleftrightarrow: ["⟷", "rel"],
  Rightarrow: ["⇒", "rel"],
  Leftarrow: ["⇐", "rel"],
  Leftrightarrow: ["⇔", "rel"],
  Longrightarrow: ["⟹", "rel"],
  Longleftarrow: ["⟸", "rel"],
  Longleftrightarrow: ["⟺", "rel"],
  implies: ["⟹", "rel"],
  impliedby: ["⟸", "rel"],
  iff: ["⟺", "rel"],
  mapsto: ["↦", "rel"],
  longmapsto: ["⟼", "rel"],
  hookrightarrow: ["↪", "rel"],
  hookleftarrow: ["↩", "rel"],
  uparrow: ["↑", "rel"],
  downarrow: ["↓", "rel"],
  updownarrow: ["↕", "rel"],
  Uparrow: ["⇑", "rel"],
  Downarrow: ["⇓", "rel"],
  Updownarrow: ["⇕", "rel"],
  nearrow: ["↗", "rel"],
  searrow: ["↘", "rel"],
  swarrow: ["↙", "rel"],
  nwarrow: ["↖", "rel"],
  rightleftharpoons: ["⇌", "rel"],
  leftrightharpoons: ["⇋", "rel"],
  rightharpoonup: ["⇀", "rel"],
  leftharpoonup: ["↼", "rel"],
  ll: ["≪", "rel"],
  gg: ["≫", "rel"],
  in: ["∈", "rel"],
  notin: ["∉", "rel"],
  ni: ["∋", "rel"],
  owns: ["∋", "rel"],
  subset: ["⊂", "rel"],
  supset: ["⊃", "rel"],
  subseteq: ["⊆", "rel"],
  supseteq: ["⊇", "rel"],
  subsetneq: ["⊊", "rel"],
  supsetneq: ["⊋", "rel"],
  sqsubseteq: ["⊑", "rel"],
  sqsupseteq: ["⊒", "rel"],
  perp: ["⊥", "rel"],
  mid: ["|", "rel"],
  nmid: ["∤", "rel"],
  vdash: ["⊢", "rel"],
  dashv: ["⊣", "rel"],
  models: ["⊨", "rel"],
  bowtie: ["⋈", "rel"],
  Join: ["⋈", "rel"],
  smile: ["⌣", "rel"],
  frown: ["⌢", "rel"],
  nleq: ["≰", "rel"],
  ngeq: ["≱", "rel"],
  nless: ["≮", "rel"],
  ngtr: ["≯", "rel"],
  nsim: ["≁", "rel"],
  ncong: ["≇", "rel"],
  nequiv: ["≢", "rel"],
  colon: [":", "punct"],
  infty: ["∞", "ord"],
  partial: ["∂", "ord"],
  nabla: ["∇", "ord"],
  degree: ["°", "ord"],
  circledast: ["⊛", "ord"],
  prime: ["′", "ord"],
  ldots: ["…", "ord"],
  cdots: ["⋯", "ord"],
  dots: ["…", "ord"],
  dotsc: ["…", "ord"],
  dotsb: ["⋯", "ord"],
  vdots: ["⋮", "ord"],
  ddots: ["⋱", "ord"],
  forall: ["∀", "ord"],
  exists: ["∃", "ord"],
  nexists: ["∄", "ord"],
  emptyset: ["∅", "ord"],
  varnothing: ["∅", "ord"],
  neg: ["¬", "ord"],
  lnot: ["¬", "ord"],
  angle: ["∠", "ord"],
  measuredangle: ["∡", "ord"],
  sphericalangle: ["∢", "ord"],
  triangle: ["△", "ord"],
  square: ["□", "ord"],
  Box: ["□", "ord"],
  blacksquare: ["■", "ord"],
  Diamond: ["◇", "ord"],
  bigstar: ["★", "ord"],
  checkmark: ["✓", "ord"],
  top: ["⊤", "ord"],
  bot: ["⊥", "ord"],
  therefore: ["∴", "rel"],
  because: ["∵", "rel"],
  hbar: ["ℏ", "ord"],
  hslash: ["ℏ", "ord"],
  ell: ["ℓ", "ord"],
  wp: ["℘", "ord"],
  Re: ["ℜ", "ord"],
  Im: ["ℑ", "ord"],
  aleph: ["ℵ", "ord"],
  beth: ["ℶ", "ord"],
  mho: ["℧", "ord"],
  imath: ["ı", "ord"],
  jmath: ["ȷ", "ord"],
  sharp: ["♯", "ord"],
  flat: ["♭", "ord"],
  natural: ["♮", "ord"],
  S: ["§", "ord"],
  P: ["¶", "ord"],
  dag: ["†", "ord"],
  ddag: ["‡", "ord"],
  pounds: ["£", "ord"],
  copyright: ["©", "ord"],
  backslash: ["\\", "ord"],
  vert: ["|", "ord"],
  Vert: ["‖", "ord"],
  langle: ["⟨", "open"],
  rangle: ["⟩", "close"],
  lceil: ["⌈", "open"],
  rceil: ["⌉", "close"],
  lfloor: ["⌊", "open"],
  rfloor: ["⌋", "close"],
  lvert: ["|", "open"],
  rvert: ["|", "close"],
  lVert: ["‖", "open"],
  rVert: ["‖", "close"],
  lbrace: ["{", "open"],
  rbrace: ["}", "close"],
  lbrack: ["[", "open"],
  rbrack: ["]", "close"],
};

/** A relation struck through by \not, as its own Unicode character. */
const NEGATIONS: Record<string, string> = {
  "=": "≠",
  "<": "≮",
  ">": "≯",
  "\\in": "∉",
  "\\ni": "∌",
  "\\subset": "⊄",
  "\\supset": "⊅",
  "\\subseteq": "⊈",
  "\\supseteq": "⊉",
  "\\equiv": "≢",
  "\\sim": "≁",
  "\\approx": "≉",
  "\\cong": "≇",
  "\\simeq": "≄",
  "\\leq": "≰",
  "\\le": "≰",
  "\\geq": "≱",
  "\\ge": "≱",
  "\\parallel": "∦",
  "\\mid": "∤",
  "\\prec": "⊀",
  "\\succ": "⊁",
};

/** Operator names, upright; the second marks limits above and below. */
const FUNCTIONS: Record<string, [string, boolean]> = {
  sin: ["sin", false],
  cos: ["cos", false],
  tan: ["tan", false],
  cot: ["cot", false],
  sec: ["sec", false],
  csc: ["csc", false],
  sinh: ["sinh", false],
  cosh: ["cosh", false],
  tanh: ["tanh", false],
  coth: ["coth", false],
  arcsin: ["arcsin", false],
  arccos: ["arccos", false],
  arctan: ["arctan", false],
  log: ["log", false],
  ln: ["ln", false],
  lg: ["lg", false],
  exp: ["exp", false],
  dim: ["dim", false],
  ker: ["ker", false],
  hom: ["hom", false],
  arg: ["arg", false],
  deg: ["deg", false],
  det: ["det", true],
  gcd: ["gcd", true],
  max: ["max", true],
  min: ["min", true],
  sup: ["sup", true],
  inf: ["inf", true],
  lim: ["lim", true],
  liminf: ["lim inf", true],
  limsup: ["lim sup", true],
  Pr: ["Pr", true],
};

/** Large operators: a sum's limits stack in display style, an integral's do not. */
const LARGE_OPERATORS: Record<string, [string, "sum" | "integral"]> = {
  sum: ["∑", "sum"],
  prod: ["∏", "sum"],
  coprod: ["∐", "sum"],
  bigcup: ["⋃", "sum"],
  bigcap: ["⋂", "sum"],
  bigoplus: ["⨁", "sum"],
  bigotimes: ["⨂", "sum"],
  bigodot: ["⨀", "sum"],
  biguplus: ["⨄", "sum"],
  bigsqcup: ["⨆", "sum"],
  bigvee: ["⋁", "sum"],
  bigwedge: ["⋀", "sum"],
  int: ["∫", "integral"],
  iint: ["∬", "integral"],
  iiint: ["∭", "integral"],
  oint: ["∮", "integral"],
  oiint: ["∯", "integral"],
};

const ACCENTS: Record<
  string,
  { mark: string; wide?: boolean; arrow?: boolean }
> = {
  hat: { mark: "ˆ" },
  check: { mark: "ˇ" },
  tilde: { mark: "˜" },
  acute: { mark: "´" },
  grave: { mark: "`" },
  dot: { mark: "˙" },
  ddot: { mark: "¨" },
  breve: { mark: "˘" },
  mathring: { mark: "˚" },
  vec: { mark: "→", arrow: true },
  widehat: { mark: "ˆ", wide: true },
  widetilde: { mark: "˜", wide: true },
  widecheck: { mark: "ˇ", wide: true },
  overrightarrow: { mark: "→", wide: true, arrow: true },
  overleftarrow: { mark: "←", wide: true, arrow: true },
  overleftrightarrow: { mark: "↔", wide: true, arrow: true },
};

/** \big and its kin: height in em, and the class a suffix gives. */
const BIG_DELIMITERS: Record<string, [number, AtomClass | null]> = {
  big: [1.2, null],
  Big: [1.8, null],
  bigg: [2.4, null],
  Bigg: [3, null],
  bigl: [1.2, "open"],
  Bigl: [1.8, "open"],
  biggl: [2.4, "open"],
  Biggl: [3, "open"],
  bigr: [1.2, "close"],
  Bigr: [1.8, "close"],
  biggr: [2.4, "close"],
  Biggr: [3, "close"],
  bigm: [1.2, "rel"],
  Bigm: [1.8, "rel"],
  biggm: [2.4, "rel"],
  Biggm: [3, "rel"],
};

const ENVIRONMENTS: Record<
  string,
  {
    left?: string;
    right?: string;
    align: Align | "rl" | "spec";
    cellStyle: Style;
    gaps: "matrix" | "cases" | "aligned";
  }
> = {
  matrix: { align: "c", cellStyle: 1, gaps: "matrix" },
  pmatrix: { left: "(", right: ")", align: "c", cellStyle: 1, gaps: "matrix" },
  bmatrix: { left: "[", right: "]", align: "c", cellStyle: 1, gaps: "matrix" },
  Bmatrix: { left: "{", right: "}", align: "c", cellStyle: 1, gaps: "matrix" },
  vmatrix: { left: "|", right: "|", align: "c", cellStyle: 1, gaps: "matrix" },
  Vmatrix: { left: "‖", right: "‖", align: "c", cellStyle: 1, gaps: "matrix" },
  smallmatrix: { align: "c", cellStyle: 2, gaps: "matrix" },
  cases: { left: "{", align: "l", cellStyle: 1, gaps: "cases" },
  dcases: { left: "{", align: "l", cellStyle: 0, gaps: "cases" },
  rcases: { right: "}", align: "l", cellStyle: 1, gaps: "cases" },
  aligned: { align: "rl", cellStyle: 0, gaps: "aligned" },
  align: { align: "rl", cellStyle: 0, gaps: "aligned" },
  "align*": { align: "rl", cellStyle: 0, gaps: "aligned" },
  split: { align: "rl", cellStyle: 0, gaps: "aligned" },
  gathered: { align: "c", cellStyle: 0, gaps: "matrix" },
  gather: { align: "c", cellStyle: 0, gaps: "matrix" },
  "gather*": { align: "c", cellStyle: 0, gaps: "matrix" },
  array: { align: "spec", cellStyle: 1, gaps: "matrix" },
};

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
  medspace: 2 / 9,
  thickspace: 5 / 18,
  negthinspace: -1 / 6,
  negmedspace: -2 / 9,
  negthickspace: -5 / 18,
  " ": 0.318,
};

const IGNORED = new Set([
  "nonumber",
  "notag",
  "allowbreak",
  "nobreak",
  "relax",
  "displaylimits",
]);

const STYLES: Record<string, Style> = {
  displaystyle: 0,
  textstyle: 1,
  scriptstyle: 2,
  scriptscriptstyle: 3,
};

/** Letters of \mathbb, \mathcal, \mathfrak whose Unicode form is in the BMP. */
const LETTERLIKE: Record<Exclude<Alphabet, "mono">, Record<string, string>> = {
  double: { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" },
  script: {
    B: "ℬ",
    E: "ℰ",
    F: "ℱ",
    H: "ℋ",
    I: "ℐ",
    L: "ℒ",
    M: "ℳ",
    R: "ℛ",
    e: "ℯ",
    g: "ℊ",
    o: "ℴ",
  },
  fraktur: { C: "ℭ", H: "ℌ", I: "ℑ", R: "ℜ", Z: "ℨ" },
};
/** First code point of each alphabet's capitals, small letters and digits. */
const ALPHABET_STARTS: Record<
  Exclude<Alphabet, "mono">,
  [number, number, number | null]
> = {
  double: [0x1d538, 0x1d552, 0x1d7d8],
  script: [0x1d49c, 0x1d4b6, null],
  fraktur: [0x1d504, 0x1d51e, null],
};

function alphabetCharacter(char: string, alphabet: Alphabet): string {
  if (alphabet === "mono") return char;
  const letterlike = LETTERLIKE[alphabet][char];
  if (letterlike) return letterlike;
  const [capitals, smalls, digits] = ALPHABET_STARTS[alphabet];
  const code = char.codePointAt(0)!;
  if (char >= "A" && char <= "Z")
    return String.fromCodePoint(capitals + code - 65);
  if (char >= "a" && char <= "z")
    return String.fromCodePoint(smalls + code - 97);
  if (digits !== null && char >= "0" && char <= "9")
    return String.fromCodePoint(digits + code - 48);
  return char;
}

interface ParseContext {
  /** Letters upright: inside a subscript or an upright font command. */
  upright?: boolean;
  /** An explicit font command, over the subscript rule. */
  font?: Font;
  bold?: boolean;
  /** \text: spaces are kept as written. */
  text?: boolean;
  /** \mathbb, \mathcal, \mathfrak, \mathtt. */
  alphabet?: Alphabet;
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

const NO_STOPS: ReadonlySet<string> = new Set();
const RIGHT_STOPS: ReadonlySet<string> = new Set(["\\right", "\\middle"]);
const INDEX_STOPS: ReadonlySet<string> = new Set(["]"]);
const CELL_STOPS: ReadonlySet<string> = new Set(["&", "\\\\", "\\end"]);
const OPENERS = new Set(["(", "[", "{", "⟨", "⌈", "⌊"]);
const CLOSERS = new Set([")", "]", "}", "⟩", "⌉", "⌋"]);

class Parser {
  private index = 0;
  constructor(private readonly tokens: string[]) {}

  parse(): Node[] {
    const nodes = this.list({}, NO_STOPS);
    if (this.index < this.tokens.length) throw new Unsupported("stray }");
    return nodes;
  }

  private peek() {
    return this.tokens[this.index];
  }

  private skipSpaces() {
    while (this.peek() === " ") this.index += 1;
  }

  /** Nodes up to a closing brace or one of `stops`, which the caller takes. */
  private list(context: ParseContext, stops: ReadonlySet<string>): Node[] {
    const nodes: Node[] = [];
    while (this.index < this.tokens.length) {
      const token = this.peek()!;
      if (token === "}" || stops.has(token)) return nodes;
      if (token === "^" || token === "_" || token === "'") {
        this.index += 1;
        this.script(nodes, token, context);
        continue;
      }
      if (token === "\\limits" || token === "\\nolimits") {
        this.index += 1;
        const last = nodes.at(-1);
        if (last && (last.kind === "atom" || last.kind === "group"))
          last.limits = token === "\\limits";
        continue;
      }
      this.index += 1;
      nodes.push(...this.node(token, context));
    }
    return nodes;
  }

  /** One argument: a braced group, or the next single token. */
  private argument(context: ParseContext): Node[] {
    this.skipSpaces();
    const next = this.peek();
    if (next === undefined) throw new Unsupported("missing argument");
    this.index += 1;
    if (next === "{") {
      const nodes = this.list(context, NO_STOPS);
      if (this.peek() !== "}") throw new Unsupported("unclosed argument");
      this.index += 1;
      return nodes;
    }
    return this.node(next, context);
  }

  /** A braced word: an environment's name or an array's column letters. */
  private braced(): string {
    this.skipSpaces();
    if (this.peek() !== "{") throw new Unsupported("missing {");
    this.index += 1;
    let text = "";
    while (this.index < this.tokens.length && this.peek() !== "}")
      text += this.tokens[this.index++];
    if (this.peek() !== "}") throw new Unsupported("unclosed {");
    this.index += 1;
    return text;
  }

  /** A TeX length, in em of the current size. */
  private length(): number {
    this.skipSpaces();
    const braced = this.peek() === "{";
    if (braced) this.index += 1;
    this.skipSpaces();
    let number = "";
    while (/^[-+0-9.]$/u.test(this.peek() ?? ""))
      number += this.tokens[this.index++];
    this.skipSpaces();
    let unit = "";
    while (unit.length < 2 && /^[a-z]$/u.test(this.peek() ?? ""))
      unit += this.tokens[this.index++];
    if (braced) {
      this.skipSpaces();
      if (this.peek() !== "}") throw new Unsupported("length");
      this.index += 1;
    }
    const perUnit: Record<string, number> = {
      em: 1,
      ex: 0.43,
      pt: 0.1,
      pc: 1.2,
      mu: 1 / 18,
      px: 1 / 16,
      mm: 0.2845,
      cm: 2.845,
      in: 7.227,
    };
    const value = Number(number);
    const per = perUnit[unit];
    if (!number || !Number.isFinite(value) || per === undefined)
      throw new Unsupported("length");
    return value * per;
  }

  private script(nodes: Node[], token: string, context: ParseContext) {
    const last = nodes.at(-1);
    const target: ScriptsNode =
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
    this.skipSpaces();
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
      const children = this.list(context, NO_STOPS);
      if (this.peek() !== "}") throw new Unsupported("unclosed group");
      this.index += 1;
      return [{ kind: "group", children }];
    }
    if (token.startsWith("\\")) return this.command(token.slice(1), context);
    return atomsOf(token, context);
  }

  private environment(context: ParseContext): Node[] {
    const name = this.braced();
    const spec = ENVIRONMENTS[name];
    if (!spec) throw new Unsupported(`\\begin{${name}}`);
    let align: Align[] | "rl" =
      spec.align === "rl" ? "rl" : spec.align === "spec" ? [] : [spec.align];
    if (spec.align === "spec") {
      align = [...this.braced()].filter((letter): letter is Align =>
        "lcr".includes(letter),
      );
      if (align.length === 0) throw new Unsupported("array columns");
    }
    const rows: Node[][][] = [];
    let row: Node[][] = [];
    for (;;) {
      row.push(this.list({ ...context, upright: false }, CELL_STOPS));
      const token = this.peek();
      this.index += 1;
      if (token === "&") continue;
      if (token === "\\\\") {
        // A row's optional extra space, \\[2pt], is not kept.
        this.skipSpaces();
        if (this.peek() === "[")
          while (
            this.index < this.tokens.length &&
            this.tokens[this.index++] !== "]"
          );
        rows.push(row);
        row = [];
        continue;
      }
      if (token === "\\end") {
        if (this.braced() !== name) throw new Unsupported(`\\end{${name}}`);
        rows.push(row);
        break;
      }
      throw new Unsupported(`unclosed ${name}`);
    }
    // A final \\ leaves an empty last row.
    const last = rows.at(-1);
    if (rows.length > 1 && last?.length === 1 && last[0]!.length === 0)
      rows.pop();
    const array: Node = {
      kind: "array",
      rows,
      align,
      cellStyle: spec.cellStyle,
      gaps: spec.gaps,
    };
    return spec.left || spec.right
      ? [
          {
            kind: "delimited",
            left: spec.left ?? null,
            right: spec.right ?? null,
            body: [array],
          },
        ]
      : [array];
  }

  private command(name: string, context: ParseContext): Node[] {
    if (name in SPACES) return [{ kind: "space", em: SPACES[name]! }];
    if (IGNORED.has(name)) return [];
    if (name in STYLES) return [{ kind: "style", style: STYLES[name]! }];
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
    if (name in LARGE_OPERATORS) {
      const [text, large] = LARGE_OPERATORS[name]!;
      return [
        {
          kind: "atom",
          text,
          cls: "op",
          font: "upright",
          large,
          limits: large === "sum",
        },
      ];
    }
    if (name in FUNCTIONS) {
      const [text, limits] = FUNCTIONS[name]!;
      return [
        {
          kind: "atom",
          text,
          cls: "op",
          font: "upright",
          ...(limits ? { limits } : {}),
        },
      ];
    }
    if (name in ACCENTS) {
      const accent = ACCENTS[name]!;
      return [{ kind: "accent", ...accent, body: this.argument(context) }];
    }
    if (name in BIG_DELIMITERS) {
      const [height, suffix] = BIG_DELIMITERS[name]!;
      const text = this.delimiter();
      if (text === null) return [{ kind: "space", em: 0.12 }];
      const cls: AtomClass =
        suffix ??
        (OPENERS.has(text) ? "open" : CLOSERS.has(text) ? "close" : "ord");
      return [{ kind: "atom", text, cls, font: "upright", stretch: height }];
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
    if (
      name === "%" ||
      name === "&" ||
      name === "#" ||
      name === "$" ||
      name === "_"
    )
      return [{ kind: "atom", text: name, cls: "ord", font: "upright" }];
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
      case "binom":
      case "dbinom":
      case "tbinom": {
        const num = this.argument({ ...context, text: false });
        const den = this.argument({ ...context, text: false });
        return [
          {
            kind: "delimited",
            left: "(",
            right: ")",
            body: [
              {
                kind: "frac",
                num,
                den,
                bar: false,
                ...(name === "dbinom"
                  ? { force: "display" as const }
                  : name === "tbinom"
                    ? { force: "text" as const }
                    : {}),
              },
            ],
          },
        ];
      }
      case "sqrt": {
        this.skipSpaces();
        let index: Node[] | undefined;
        if (this.peek() === "[") {
          this.index += 1;
          index = this.list({ ...context, upright: true }, INDEX_STOPS);
          if (this.peek() !== "]") throw new Unsupported("unclosed root index");
          this.index += 1;
        }
        return [
          {
            kind: "radical",
            body: this.argument(context),
            ...(index ? { index } : {}),
          },
        ];
      }
      case "overline":
      case "bar":
        return [{ kind: "overline", body: this.argument(context) }];
      case "underline":
        return [{ kind: "underline", body: this.argument(context) }];
      case "overset":
      case "stackrel": {
        const over = this.argument(context);
        return [{ kind: "stack", over, base: this.argument(context) }];
      }
      case "underset": {
        const under = this.argument(context);
        return [{ kind: "stack", under, base: this.argument(context) }];
      }
      case "xrightarrow":
      case "xleftarrow": {
        this.skipSpaces();
        let under: Node[] | undefined;
        if (this.peek() === "[") {
          this.index += 1;
          under = this.list(context, INDEX_STOPS);
          if (this.peek() !== "]") throw new Unsupported("unclosed [");
          this.index += 1;
        }
        return [
          {
            kind: "xarrow",
            arrow: name === "xrightarrow" ? "→" : "←",
            over: this.argument(context),
            ...(under ? { under } : {}),
          },
        ];
      }
      case "not": {
        this.skipSpaces();
        const next = this.peek();
        const negated = next === undefined ? undefined : NEGATIONS[next];
        if (!negated) throw new Unsupported("\\not");
        this.index += 1;
        return [{ kind: "atom", text: negated, cls: "rel", font: "upright" }];
      }
      case "mathrm":
      case "mathup":
      case "mathsf":
      case "mathnormal":
        return [
          {
            kind: "group",
            children: this.argument({
              ...context,
              font: name === "mathnormal" ? "italic" : "upright",
            }),
          },
        ];
      case "operatorname": {
        const limits = this.peek() === "*";
        if (limits) this.index += 1;
        return [
          {
            kind: "group",
            cls: "op",
            ...(limits ? { limits } : {}),
            children: this.argument({ ...context, font: "upright" }),
          },
        ];
      }
      case "mathop":
      case "mathrel":
      case "mathbin":
      case "mathord":
      case "mathopen":
      case "mathclose":
      case "mathpunct":
      case "mathinner": {
        const cls = (
          {
            mathop: "op",
            mathrel: "rel",
            mathbin: "bin",
            mathord: "ord",
            mathopen: "open",
            mathclose: "close",
            mathpunct: "punct",
            mathinner: "ord",
          } as const
        )[name];
        return [
          {
            kind: "group",
            cls,
            ...(cls === "op" ? { limits: true } : {}),
            children: this.argument(context),
          },
        ];
      }
      case "mathbb":
      case "Bbb":
      case "mathcal":
      case "mathscr":
      case "mathfrak":
      case "mathtt": {
        const alphabet: Alphabet =
          name === "mathbb" || name === "Bbb"
            ? "double"
            : name === "mathfrak"
              ? "fraktur"
              : name === "mathtt"
                ? "mono"
                : "script";
        return [
          {
            kind: "group",
            children: this.argument({ ...context, alphabet, font: "upright" }),
          },
        ];
      }
      case "text":
      case "textrm":
      case "textnormal":
      case "textsf":
      case "textup":
      case "mbox":
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
        const body = this.list(context, RIGHT_STOPS);
        // \middle splits the body with a fence of its own.
        while (this.peek() === "\\middle") {
          this.index += 1;
          const text = this.delimiter();
          if (text !== null)
            body.push({
              kind: "atom",
              text,
              cls: "rel",
              font: "upright",
              middle: true,
            });
          body.push(...this.list(context, RIGHT_STOPS));
        }
        if (this.peek() !== "\\right") throw new Unsupported("\\left alone");
        this.index += 1;
        const right = this.delimiter();
        return [{ kind: "delimited", left, right, body }];
      }
      case "right":
        throw new Unsupported("\\right alone");
      case "begin":
        return this.environment(context);
      case "hspace":
      case "hskip":
      case "kern":
      case "mkern":
      case "mskip": {
        if (this.peek() === "*") this.index += 1;
        return [{ kind: "space", em: this.length() }];
      }
      case "phantom":
      case "hphantom":
      case "vphantom":
        return [
          {
            kind: "phantom",
            body: this.argument(context),
            width: name !== "vphantom",
            height: name !== "hphantom",
          },
        ];
      case "mathstrut":
        return [
          {
            kind: "phantom",
            body: [{ kind: "atom", text: "(", cls: "open", font: "upright" }],
            width: false,
            height: true,
          },
        ];
      case "bmod":
        return [{ kind: "atom", text: "mod", cls: "bin", font: "upright" }];
      case "mod":
      case "pmod": {
        const argument = this.argument({ ...context, upright: false });
        const mod: Node = {
          kind: "atom",
          text: "mod",
          cls: "ord",
          font: "upright",
        };
        return name === "mod"
          ? [
              { kind: "space", em: 1 },
              mod,
              { kind: "space", em: 1 / 3 },
              ...argument,
            ]
          : [
              { kind: "space", em: 1 },
              { kind: "atom", text: "(", cls: "open", font: "upright" },
              mod,
              { kind: "space", em: 1 / 3 },
              ...argument,
              { kind: "atom", text: ")", cls: "close", font: "upright" },
            ];
      }
      // MathLive's semantic letters: an upright d, e, i and j.
      case "differentialD":
      case "capitalDifferentialD":
      case "exponentialE":
      case "imaginaryI":
      case "imaginaryJ":
        return [
          {
            kind: "atom",
            text: {
              differentialD: "d",
              capitalDifferentialD: "D",
              exponentialE: "e",
              imaginaryI: "i",
              imaginaryJ: "j",
            }[name],
            cls: "ord",
            font: "upright",
          },
        ];
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
  if (context.alphabet && /[A-Za-z0-9]/u.test(char))
    return [
      {
        kind: "atom",
        text: alphabetCharacter(char, context.alphabet),
        cls: "ord",
        font: "upright",
        ...bold,
      },
    ];
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

function parse(latex: string): Node[] {
  return new Parser(tokenize(latex.trim())).parse();
}

function layout(
  nodes: Node[],
  options: LabelFormulaOptions,
): LabelFormulaLayout {
  return new Layout(options).list(nodes, options.display === "block" ? 0 : 1);
}

/** Lay out `latex` in label type, or null when it uses LaTeX label type does not set. */
export function layoutLabelFormula(
  latex: string,
  options: LabelFormulaOptions,
): LabelFormulaLayout | null {
  try {
    const nodes = parse(latex);
    if (nodes.length === 0) return null;
    return layout(nodes, options);
  } catch {
    return null;
  }
}

/**
 * Why `latex` cannot be set in label type, for the formula editor to say
 * before it inserts it; null when it can.
 */
export function labelFormulaProblem(latex: string): string | null {
  try {
    const nodes = parse(latex);
    if (nodes.length === 0) return "The formula is empty";
    layout(nodes, {
      fontSize: 15,
      bold: true,
      display: "block",
      subscriptScale: 0.76,
      subscriptBaselineShiftEm: 0.44,
      subscriptHorizontalGapEm: 0.046,
    });
    return null;
  } catch (error) {
    if (!(error instanceof Unsupported)) return "This formula cannot be set";
    const what = error.message;
    if (what === "&")
      return "& separates columns only inside a matrix, cases or aligned block";
    if (what === "\\\\")
      return "\\\\ starts a new row only inside a matrix, cases or aligned block";
    if (what.startsWith("\\")) return `${what} is not supported in formulas`;
    return `The formula is incomplete (${what})`;
  }
}
