import { StreamLanguage, type StreamParser } from "@codemirror/language";
import {
  nativeLanguageHelp,
  lookupNativeHelp,
  VACASK_LANGUAGE_REFERENCE,
  inspectVacaskSource,
  nativeLanguageSymbols,
  vacaskIdentifier,
} from "@icm/netlist";
import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { hoverTooltip } from "@codemirror/view";
import {
  parameterGuide,
  insertNativeHelp,
  nativeEntry,
  controlContext,
} from "./code-parameter-guide";

interface State {
  blockComment: boolean;
  longString: string | null;
}
const parser: StreamParser<State> = {
  name: "vacask",
  startState: () => ({ blockComment: false, longString: null }),
  token(stream, state) {
    if (state.longString) {
      if (stream.match(`>>>${state.longString}`)) state.longString = null;
      else stream.skipToEnd();
      return "string";
    }
    if (state.blockComment) {
      if (stream.match("*/")) state.blockComment = false;
      else stream.next();
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.blockComment = true;
      return "comment";
    }
    const long = stream.match(/^<<<([A-Za-z0-9_]+)/u);
    if (Array.isArray(long)) {
      state.longString = long[1]!;
      stream.skipToEnd();
      return "string";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"/u)) return "string";
    if (stream.match(/^'(?:[^']|'')*'/u)) return "variableName";
    if (
      stream.match(
        /^(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+|[a-zA-Z]+)?)/u,
      )
    )
      return "number";
    const word = stream.match(/^[@$a-zA-Z_][\w$]*/u);
    if (Array.isArray(word)) {
      if (
        [
          "analysis",
          "sweep",
          "parameters",
          "model",
          "subckt",
          "ends",
          "include",
          "load",
          "ground",
          "global",
          "control",
          "endc",
          "save",
          "options",
          "alter",
          "var",
          "clear",
          "abort",
          "@if",
          "@else",
          "@end",
        ].includes(word[0])
      )
        return "keyword";
      return stream.match(/^\s*=/u, false) ? "propertyName" : "variableName";
    }
    if (stream.match(/^[{}()[\]]/u)) return "bracket";
    if (stream.match(/^[=+*/^<>!?:;,\-]/u)) return "operator";
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
};
export const nativeCodeLanguage = StreamLanguage.define(parser);

export function nativeCompletion(
  context: CompletionContext,
  relatedSources: readonly string[] = [],
  signalNames?: () => Readonly<Record<string, string>>,
): CompletionResult | null {
  const text = context.state.doc.toString();
  const entry = context.state.facet(nativeEntry);
  const parsed = inspectVacaskSource("completion", text, entry);
  const line = context.state.doc.lineAt(context.pos);
  if (
    (entry && line.number === 1) ||
    parsed.comments.some((c) => context.pos >= c.start && context.pos <= c.end)
  )
    return null;
  const word = context.matchBefore(/[\w$]+/u);
  const before = line.text.slice(0, context.pos - line.from);
  const head = /^\s*[\w$]*$/u.test(before);
  const guide = parameterGuide(context.state);
  if (!head && guide) {
    const hint = guide.parameters[guide.index];
    if (!hint) return null;
    const token = guide.tokens[guide.index];
    const eq = token?.value.indexOf("=") ?? -1;
    const valueFrom =
      token && eq >= 0
        ? token.from +
          eq +
          1 +
          (text.slice(token.from + eq + 1, context.pos).match(/^\s*/u)?.[0]
            .length ?? 0)
        : undefined;
    const withKey = (label: string) =>
      hint.key && valueFrom === undefined ? `${hint.key}=${label}` : label;
    if (hint.choices)
      return {
        from: valueFrom ?? token?.from ?? context.pos,
        options: hint.choices.map((label) => ({
          label: withKey(label),
          type: "enum",
        })),
      };
    if (hint.symbols) {
      const symbols = nativeLanguageSymbols([
        { text, entry },
        ...relatedSources.map((text) => ({ text, entry: false })),
      ]);
      const mapped = hint.symbols === "vector" ? (signalNames?.() ?? {}) : {};
      const options = new Map<
        string,
        { label: string; type: string; detail?: string }
      >();
      const add = (label: string, detail?: string) => {
        const key =
          hint.symbols === "vector"
            ? JSON.stringify(
                inspectVacaskSource(
                  "selector",
                  `save ${label}`,
                ).statements[0]?.tokens.map((t) => [t.kind, t.value]),
              )
            : label;
        if (!options.has(key))
          options.set(key, {
            label,
            type: "variable",
            ...(detail ? { detail } : {}),
          });
      };
      if (hint.symbols === "vector") {
        add("default");
        add("full");
        for (const [label, detail] of Object.entries(mapped)) {
          add(label, detail);
          if (label.startsWith("v(")) add(`d${label}`, `${detail} · AC phasor`);
        }
        for (const node of symbols.nodes) {
          add(`v(${vacaskIdentifier(node)})`);
          add(`dv(${vacaskIdentifier(node)})`, "AC phasor");
        }
        for (const [name, master] of symbols.instances) {
          const module = symbols.models.get(master ?? "");
          if (module === "vsource" || module === "inductor") {
            add(`i(${vacaskIdentifier(name)})`, "Native branch flow");
            add(`di(${vacaskIdentifier(name)})`, "AC branch phasor");
          }
        }
      } else if (hint.symbols === "node") {
        for (const node of symbols.nodes)
          add(
            withKey(hint.key ? JSON.stringify(node) : vacaskIdentifier(node)),
          );
      } else {
        for (const [name, master] of symbols.instances) {
          if (
            hint.key === "in" &&
            !["vsource", "isource"].includes(
              symbols.models.get(master ?? "") ?? "",
            )
          )
            continue;
          add(withKey(JSON.stringify(name)));
        }
      }
      return {
        from: valueFrom ?? token?.from ?? context.pos,
        options: [...options.values()],
      };
    }
    const fields = guide.parameters
      .slice(guide.tokens.length)
      .filter((h) => h.key);
    if (fields.length)
      return {
        from: token?.from ?? context.pos,
        options: fields.map((h) => ({
          label: `${h.key}=`,
          type: "property",
          detail: h.label,
        })),
      };
    return null;
  }
  if (!head || (!context.explicit && !word)) return null;
  const scope = controlContext(text.slice(0, line.from), entry)
    ? "control"
    : "circuit";
  return {
    from: word?.from ?? context.pos,
    options: nativeLanguageHelp
      .filter((h) => h.context === scope)
      .map((help) => ({
        label: help.name,
        type: "keyword",
        detail: help.signature,
        info: help.summary,
        apply: (
          view: Parameters<typeof insertNativeHelp>[0],
          _completion: unknown,
          from: number,
          to: number,
        ) => insertNativeHelp(view, help, from, to),
      })),
    validFor: /^[\w$]*$/u,
  };
}

export const nativeHoverHelp = hoverTooltip((view, position) => {
  const text = view.state.doc.toString();
  const line = view.state.doc.lineAt(position);
  const entry = view.state.facet(nativeEntry);
  const parsed = inspectVacaskSource("hover", text, entry);
  if (
    (entry && line.number === 1) ||
    parsed.comments.some((c) => position >= c.start && position <= c.end)
  )
    return null;
  const word = [...line.text.matchAll(/[a-zA-Z_][\w]*/gu)].find(
    (m) =>
      line.from + m.index <= position &&
      line.from + m.index + m[0].length >= position,
  );
  if (!word) return null;
  const scope = controlContext(text.slice(0, line.from), entry)
    ? "control"
    : "circuit";
  const help =
    lookupNativeHelp(word[0], scope) ??
    (line.text.trimStart().startsWith("analysis ")
      ? lookupNativeHelp(`analysis ${word[0]}`, scope)
      : undefined);
  if (!help) return null;
  return {
    pos: line.from + word.index,
    end: line.from + word.index + word[0].length,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "simulation-code-help";
      const code = document.createElement("code");
      code.textContent = help.signature;
      const summary = document.createElement("p");
      summary.textContent = help.summary;
      const link = document.createElement("a");
      link.href = VACASK_LANGUAGE_REFERENCE + help.section + ".md";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "VACASK reference";
      dom.append(code, summary, link);
      return { dom };
    },
  };
});
