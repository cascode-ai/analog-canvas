import {
  defaultInstanceLabelPlacement,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { flattenRichText, normalizeRichText } from "@icm/model";
import type {
  Annotation,
  RichTextDocument,
  RichTextRun,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

/**
 * Formula source is presentation, not an electrical identifier grammar. A
 * bound label can keep a formula only when its canonical plain projection is
 * exactly the name it already owns; every other formula must become literal
 * attached text instead of leaking LaTeX into Instance.reference.
 */
export function boundFormulaPresentation(
  latex: string,
  semanticText: string,
): RichTextDocument | null {
  const parser = new BoundNameFormulaParser(latex);
  const runs = parser.parse();
  if (!runs) return null;
  const document = normalizeRichText({ runs });
  return flattenRichText(document).trim() === semanticText.trim()
    ? document
    : null;
}

const GREEK_COMMANDS: Readonly<Record<string, string>> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  phi: "φ",
  omega: "ω",
  Delta: "Δ",
  Omega: "Ω",
};

/**
 * Deliberately small LaTeX projection for a bound electrical name. It accepts
 * only syntax that canonical RichText can represent without adding semantic
 * characters. Unsupported mathematics is not guessed.
 */
class BoundNameFormulaParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): RichTextRun[] | null {
    const runs = this.parseRuns(null);
    return runs && this.index === this.source.length && runs.length > 0
      ? runs
      : null;
  }

  private parseRuns(stop: "}" | null): RichTextRun[] | null {
    const runs: RichTextRun[] = [];
    let text = "";
    const flush = (): void => {
      if (!text) return;
      runs.push({ kind: "text", value: text });
      text = "";
    };

    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      if (character === "}") {
        if (stop !== "}") return null;
        flush();
        this.index += 1;
        return runs;
      }
      if (/\s/u.test(character)) {
        this.index += 1;
        continue;
      }
      if (character === "{") {
        flush();
        this.index += 1;
        const group = this.parseRuns("}");
        if (!group) return null;
        runs.push(...group);
        continue;
      }
      if (character === "_" || character === "^") {
        flush();
        this.index += 1;
        const children = this.parseArgument();
        if (!children?.length) return null;
        runs.push({
          kind: "span",
          style: character === "_" ? "subscript" : "superscript",
          children,
        });
        continue;
      }
      if (character === "\\") {
        flush();
        const command = this.parseCommand();
        if (!command) return null;
        runs.push(...command);
        continue;
      }
      text += character;
      this.index += 1;
    }
    if (stop) return null;
    flush();
    return runs;
  }

  private parseArgument(): RichTextRun[] | null {
    if (this.source[this.index] === "{") {
      this.index += 1;
      return this.parseRuns("}");
    }
    if (this.index >= this.source.length) return null;
    if (this.source[this.index] === "\\") return this.parseCommand();
    const value = this.source[this.index]!;
    this.index += 1;
    return [{ kind: "text", value }];
  }

  private parseCommand(): RichTextRun[] | null {
    this.index += 1;
    const start = this.index;
    while (/[A-Za-z]/u.test(this.source[this.index] ?? "")) this.index += 1;
    const command = this.source.slice(start, this.index);
    if (!command) {
      const literal = this.source[this.index];
      if (!literal) return null;
      this.index += 1;
      return [{ kind: "text", value: literal }];
    }
    const greek = GREEK_COMMANDS[command];
    if (greek) return [{ kind: "text", value: greek }];
    const style =
      command === "overline" || command === "bar"
        ? "overbar"
        : command === "mathbf"
          ? "bold"
          : command === "mathit"
            ? "italic"
            : null;
    if (!style) return null;
    const children = this.parseArgument();
    return children?.length ? [{ kind: "span", style, children }] : null;
  }
}

/** Build the literal, object-attached formula chosen by the mismatch prompt. */
export function attachedInstanceFormulaAnnotation(options: {
  document: SchematicDocument;
  source: Annotation;
  formula: RichTextDocument;
  resolver: SymbolResolver;
  id: string;
}): Annotation | null {
  const { document, source, formula, resolver, id } = options;
  const binding = source.binding;
  if (binding?.kind !== "instance-reference") return null;
  const instance = document.instances.find(
    (candidate) => candidate.id === binding.instanceId,
  );
  if (!instance?.placement) return null;
  const symbol = resolver.resolve(instance.symbolId, instance.symbolVariantId);
  if (!symbol) return null;
  const placement = defaultInstanceLabelPlacement(
    instance,
    symbol,
    resolveDocumentStyleProfile(document.presentation),
    document.presentation.grid,
    "value",
  );
  if (!placement) return null;

  return {
    id,
    kind: "instance-value",
    content: formula,
    anchor: {
      kind: "object",
      objectId: instance.id,
      localOffset: {
        x: placement.position.x - instance.placement.position.x,
        y: placement.position.y - instance.placement.position.y,
      },
      fallbackPosition: placement.position,
    },
    alignment: placement.alignment,
    rotation: 0,
    locked: false,
    sizeScale: source.sizeScale ?? 1,
  };
}
