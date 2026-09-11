import { lookupSimulationHelp, type SimulationLanguageHelp } from "@icm/spice";
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import { closeCompletion } from "@codemirror/autocomplete";

export const dismissParameterGuide = StateEffect.define<boolean>();
export function controlContext(text: string): boolean {
  return (
    [...text.matchAll(/^\s*\.(control|endc)\b/gimu)]
      .at(-1)?.[1]
      ?.toLowerCase() === "control"
  );
}

export function parameterGuide(state: EditorState) {
  const cursor = state.selection.main.head;
  let line = state.doc.lineAt(cursor);
  if (/^\s*(?:\*|;)/u.test(line.text)) return null;
  const head = /^\s*([.\w]+)(\s*)/u.exec(line.text);
  if (!head) return null;
  const context = controlContext(state.doc.sliceString(0, line.from))
    ? "control"
    : "deck";
  const waveform = /\b(PULSE|SIN|PWL)\s*\(/iu.exec(line.text);
  const waveEnd = waveform
    ? line.text.indexOf(")", waveform.index + waveform[0].length)
    : -1;
  const inWaveform =
    waveform &&
    cursor >= line.from + waveform.index + waveform[0].length &&
    (waveEnd < 0 || cursor <= line.from + waveEnd);
  const help =
    (inWaveform ? lookupSimulationHelp(waveform[1]!, "deck") : undefined) ??
    lookupSimulationHelp(head[1]!, context) ??
    (context === "deck"
      ? lookupSimulationHelp(head[1]![0]!, context)
      : undefined);
  if (!help?.parameters?.length || cursor < line.from + head[1]!.length)
    return null;
  // Balanced vectors/expressions and quoted paths form a single argument.
  const tokens: { from: number; to: number; value: string }[] = [];
  let start = -1,
    depth = 0,
    quote = "";
  const bodyStart = inWaveform
    ? waveform.index + waveform[0].length
    : head[0].length;
  if (inWaveform && waveEnd >= 0)
    line = {
      ...line,
      text: line.text.slice(0, waveEnd),
      to: line.from + waveEnd,
      length: waveEnd,
    };
  for (let i = bodyStart; i <= line.text.length; i++) {
    const char = line.text[i] ?? " ";
    if (start < 0 && /\s/u.test(char)) continue;
    if (start < 0) start = i;
    if (quote) {
      if (char === quote && line.text[i - 1] !== "\\") quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "{") depth++;
    else if (char === ")" || char === "}") depth--;
    if (/\s/u.test(char) && !quote && depth <= 0) {
      tokens.push({
        from: line.from + start,
        to: line.from + i,
        value: line.text.slice(start, i),
      });
      start = -1;
    }
  }
  const active = tokens.findIndex(
    (token) => cursor >= token.from && cursor <= token.to,
  );
  const index = active >= 0 ? active : tokens.length;
  let parameters = help.parameters.map((p, i) =>
    help.name.replace(/^\./u, "") === "ac" && i === 1
      ? {
          ...p,
          label:
            tokens[0]?.value.toLowerCase() === "dec"
              ? "points / decade"
              : tokens[0]?.value.toLowerCase() === "oct"
                ? "points / octave"
                : "points (total)",
        }
      : p,
  );
  if (/^[VI]$/u.test(help.name) && tokens[2]) {
    const excitation = tokens[2].value.toUpperCase();
    if (/^(PULSE|SIN|PWL)\(/u.test(excitation))
      parameters = parameters.slice(0, 3);
    else if (excitation === "AC")
      parameters = [
        ...parameters.slice(0, 3),
        { label: "magnitude" },
        { label: "phase / deg", optional: true },
      ];
    else if (excitation !== "DC")
      parameters = [...parameters.slice(0, 2), { label: "value" }];
  }
  return { line, help, tokens, index, parameters };
}

class GhostParameters extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: GhostParameters) {
    return this.text === other.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "simulation-parameter-ghost";
    span.textContent = this.text;
    span.setAttribute("aria-hidden", "true");
    span.contentEditable = "false";
    return span;
  }
  override ignoreEvent() {
    return true;
  }
}
const guideDismissed = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    if (
      tr.selection &&
      tr.startState.doc.lineAt(tr.startState.selection.main.head).number !==
        tr.state.doc.lineAt(tr.state.selection.main.head).number
    )
      value = false;
    if (tr.docChanged && tr.newDoc.lines !== tr.startState.doc.lines)
      value = false;
    for (const effect of tr.effects)
      if (effect.is(dismissParameterGuide)) value = effect.value;
    return value;
  },
});
const ghost = EditorView.decorations.compute(
  ["doc", "selection", guideDismissed],
  (state) => {
    if (state.field(guideDismissed)) return Decoration.none;
    const guide = parameterGuide(state);
    if (!guide) return Decoration.none;
    const missing = guide.parameters.slice(guide.tokens.length);
    if (!missing.length) return Decoration.none;
    const text =
      "  " +
      missing
        .map((p) =>
          p.optional ? `[${p.label}]` : `‹${p.choices?.join("|") ?? p.label}›`,
        )
        .join("  ");
    return Decoration.set([
      Decoration.widget({ widget: new GhostParameters(text), side: 1 }).range(
        guide.line.to,
      ),
    ]);
  },
);

export function insertSpiceHelp(
  view: EditorView,
  help: SimulationLanguageHelp,
  from?: number,
  to?: number,
) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const start = from ?? line.from;
  const end = to ?? line.to;
  const name = /^[RCLVI]$/u.test(help.name) ? `${help.name}1` : help.name;
  const waveform = /^(PULSE|SIN|PWL)$/iu.test(name);
  const text = name + (waveform ? "()" : help.parameters?.length ? " " : "");
  view.dispatch({
    changes: { from: start, to: end, insert: text },
    selection: { anchor: start + text.length - (waveform ? 1 : 0) },
    effects: dismissParameterGuide.of(false),
    userEvent: "input.complete",
  });
  view.focus();
}

export function dismissSpiceGuide(view: EditorView): boolean {
  const closed = closeCompletion(view);
  if (!parameterGuide(view.state) || view.state.field(guideDismissed, false))
    return closed;
  view.dispatch({ effects: dismissParameterGuide.of(true) });
  return true;
}

export const spiceParameterGuide = [
  guideDismissed,
  ghost,
  keymap.of([
    {
      key: "Escape",
      run: dismissSpiceGuide,
    },
    {
      key: "Tab",
      run(view) {
        const guide = parameterGuide(view.state);
        if (!guide || view.state.field(guideDismissed)) return false;
        const token = guide.tokens[guide.index];
        if (!token) {
          if (guide.parameters[guide.index]?.optional) {
            view.dispatch({ effects: dismissParameterGuide.of(true) });
            return true;
          }
          return guide.index < guide.parameters.length;
        }
        const next = guide.tokens[guide.index + 1];
        if (next)
          view.dispatch({ selection: { anchor: next.from, head: next.to } });
        else if (guide.index + 1 < guide.parameters.length)
          view.dispatch({
            changes: { from: token.to, insert: " " },
            selection: { anchor: token.to + 1 },
          });
        else return false;
        return true;
      },
    },
    {
      key: "Shift-Tab",
      run(view) {
        const guide = parameterGuide(view.state);
        const previous = guide?.tokens[guide.index - 1];
        if (!previous || view.state.field(guideDismissed)) return false;
        view.dispatch({
          selection: { anchor: previous.from, head: previous.to },
        });
        return true;
      },
    },
  ]),
];
