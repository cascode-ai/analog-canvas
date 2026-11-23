import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import { closeCompletion } from "@codemirror/autocomplete";

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

interface ParameterGuide {
  line: { to: number };
  tokens: readonly { from: number; to: number }[];
  index: number;
  parameters: readonly {
    label: string;
    optional?: boolean;
    choices?: readonly string[];
  }[];
}
export function createParameterGuide(
  parameterGuide: (state: EditorState) => ParameterGuide | null,
) {
  const dismissParameterGuide = StateEffect.define<boolean>();
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
            p.optional
              ? `[${p.label}]`
              : `‹${p.choices?.join("|") ?? p.label}›`,
          )
          .join("  ");
      return Decoration.set([
        Decoration.widget({ widget: new GhostParameters(text), side: 1 }).range(
          guide.line.to,
        ),
      ]);
    },
  );

  function dismiss(view: EditorView): boolean {
    const closed = closeCompletion(view);
    if (!parameterGuide(view.state) || view.state.field(guideDismissed, false))
      return closed;
    view.dispatch({ effects: dismissParameterGuide.of(true) });
    return true;
  }

  const extension = [
    guideDismissed,
    ghost,
    keymap.of([
      {
        key: "Escape",
        run: dismiss,
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

  return { extension, dismiss, dismissParameterGuide };
}
