import { StreamLanguage, type StreamParser } from "@codemirror/language";
import {
  simulationLanguageHelp,
  lookupSimulationHelp,
  NGSPICE_LANGUAGE_REFERENCE,
  type SimulationLanguageContext,
} from "@icm/spice";
import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { hoverTooltip } from "@codemirror/view";
import { parameterGuide, insertSpiceHelp } from "./code-parameter-guide";

interface State {
  control: boolean;
  head: boolean;
}
/** Display tokens only. Semantic inspection and helpers stay in @icm/spice. */
const parser: StreamParser<State> = {
  name: "ngspice",
  startState: () => ({ control: false, head: true }),
  token(stream, state) {
    if (stream.sol()) state.head = true;
    if (stream.eatSpace()) return null;
    if (
      (state.head && stream.peek() === "*") ||
      stream.match(/^(?:\$|;|\/\/)/u)
    ) {
      stream.skipToEnd();
      return "comment";
    }
    const atHead = state.head;
    state.head = false;
    if (stream.match(/^\.control\b/iu)) {
      state.control = true;
      return "keyword";
    }
    if (stream.match(/^\.endc\b/iu)) {
      state.control = false;
      return "keyword";
    }
    if (stream.match(/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/u))
      return "string";
    if (
      stream.match(
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmunpfa])?\b/iu,
      )
    )
      return "number";
    if (stream.match(/^\.[a-z][\w]*/iu)) return "keyword";
    const word = stream.match(/^[a-z_][\w.:]*/iu);
    if (word) {
      if (atHead) return state.control ? "keyword" : "typeName";
      return stream.match(/^\s*=/u, false) ? "propertyName" : "variableName";
    }
    if (stream.match(/^[{}()[\]]/u)) return "bracket";
    if (stream.match(/^[=+*/^<>!-]/u)) return "operator";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "*" } },
};
export const spiceCodeLanguage = StreamLanguage.define(parser);

export function spiceCompletion(
  context: CompletionContext,
  relatedSources: readonly string[] = [],
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const word = context.matchBefore(/[.\w]+/u);
  if (!context.explicit && !word) return null;
  const before = line.text.slice(0, context.pos - line.from);
  if (/^\s*\*/u.test(before)) return null;
  const head = /^\s*[.\w]*$/u.test(before);
  const guide = parameterGuide(context.state);
  if (!head && guide) {
    const choices = guide.parameters[guide.index]?.choices;
    if (!choices) {
      const parameter = guide.parameters[guide.index]?.label;
      const wantsSource = parameter === "source" || parameter === "inputSource";
      const wantsVector =
        parameter === "vector" || parameter === "v(out[,ref])";
      if (!wantsSource && !wantsVector) return null;
      const symbols = new Set<string>();
      for (const text of [context.state.doc.toString(), ...relatedSources]) {
        let subckt = false;
        for (const row of text.split(/\r?\n/u)) {
          if (/^\s*\.subckt\b/iu.test(row)) subckt = true;
          if (/^\s*\.ends\b/iu.test(row)) subckt = false;
          if (subckt) continue;
          const instance = /^\s*([RCLVI][\w.]*)\s+(\S+)\s+(\S+)\s+/iu.exec(row);
          if (!instance) continue;
          if (wantsSource && /^[VI]/iu.test(instance[1]!))
            symbols.add(instance[1]!);
          if (wantsVector) {
            for (const node of instance.slice(2, 4)) symbols.add(`v(${node})`);
            if (/^V/iu.test(instance[1]!)) symbols.add(`i(${instance[1]})`);
          }
        }
      }
      const vectorWord = context.matchBefore(/[\w().,:]+/u);
      return {
        from: vectorWord?.from ?? context.pos,
        options: [...symbols].map((label) => ({ label, type: "variable" })),
      };
    }
    return {
      from: word?.from ?? context.pos,
      options: choices.map((label) => {
        const wave = /^(PULSE|SIN|PWL)$/u.test(label)
          ? lookupSimulationHelp(label, "deck")
          : undefined;
        return {
          label,
          type: "enum",
          ...(wave
            ? {
                apply: (
                  view: Parameters<typeof insertSpiceHelp>[0],
                  _completion: unknown,
                  from: number,
                  to: number,
                ) => insertSpiceHelp(view, wave, from, to),
              }
            : {}),
        };
      }),
    };
  }
  if (!head) return null;
  // Partial lines need a lexical context for completion; the authoritative parser diagnoses whole files separately.
  const preceding = context.state.doc.sliceString(0, line.from);
  const boundaries = [...preceding.matchAll(/^\s*\.(control|endc)\b/gimu)];
  const control = boundaries.at(-1)?.[1]?.toLowerCase() === "control";
  const languageContext: SimulationLanguageContext = control
    ? "control"
    : /^\s*\.param\b/iu.test(before)
      ? "parameter"
      : "deck";
  const options = simulationLanguageHelp
    .filter(
      (rule) =>
        rule.context === languageContext &&
        (head || !rule.name.startsWith(".")),
    )
    .map((rule) => ({
      label: rule.name,
      type: "keyword",
      detail: rule.signature,
      info: `${rule.summary}\nngspice 46 manual §${rule.section}`,
      boost: 100 - (rule.priority ?? 90),
      apply: (
        view: Parameters<typeof insertSpiceHelp>[0],
        _completion: unknown,
        from: number,
        to: number,
      ) => insertSpiceHelp(view, rule, from, to),
    }));
  return { from: word?.from ?? context.pos, options, validFor: /^[.\w]*$/u };
}

export const spiceHoverHelp = hoverTooltip((view, position) => {
  const line = view.state.doc.lineAt(position);
  const relative = position - line.from;
  const matches = [...line.text.matchAll(/[.a-z_][\w.]*/giu)];
  const word = matches.find(
    (m) => m.index <= relative && m.index + m[0].length >= relative,
  );
  if (!word || /^\s*\*/u.test(line.text)) return null;
  const boundaries = [
    ...view.state.doc
      .sliceString(0, line.from)
      .matchAll(/^\s*\.(control|endc)\b/gimu),
  ];
  const context =
    boundaries.at(-1)?.[1]?.toLowerCase() === "control" ? "control" : "deck";
  const help = lookupSimulationHelp(word[0], context);
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
      const text = document.createElement("p");
      text.textContent = help.summary;
      const link = document.createElement("a");
      link.href = NGSPICE_LANGUAGE_REFERENCE;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `ngspice 46 · §${help.section}`;
      dom.append(code, text, link);
      return { dom };
    },
  };
});
