// LaTeX read into the formula tree: tokens, commands and environments.
import {
  type Align,
  type Alphabet,
  type AtomClass,
  type Font,
  type Node,
  type ScriptsNode,
  Unsupported,
} from "./label-formula-nodes.js";
import {
  ACCENTS,
  BIG_DELIMITERS,
  ENVIRONMENTS,
  FUNCTIONS,
  GREEK,
  IGNORED,
  LARGE_OPERATORS,
  NEGATIONS,
  SPACES,
  STYLES,
  SYMBOLS,
  alphabetCharacter,
} from "./label-formula-symbols.js";

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

export function parse(latex: string): Node[] {
  return new Parser(tokenize(latex.trim())).parse();
}
