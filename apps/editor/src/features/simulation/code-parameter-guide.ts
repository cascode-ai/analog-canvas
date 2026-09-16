import {
  inspectVacaskSource,
  nativeArgumentFields,
  nativeControlContext,
  lookupNativeHelp,
  nativeSourceHints,
  nativeLanguageSymbols,
  nativeHelpInsertion,
  type NativeLanguageHelp,
  type NativeParameterHint,
} from "@icm/netlist";
import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import { closeCompletion } from "@codemirror/autocomplete";

export const dismissParameterGuide = StateEffect.define<boolean>();
export const nativeEntry = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? true,
});
export const nativeCompanions = Facet.define<
  readonly string[],
  readonly string[]
>({ combine: (values) => values[0] ?? [] });
export const controlContext = nativeControlContext;

export function parameterGuide(state: EditorState) {
  const cursor = state.selection.main.head;
  const text = state.doc.toString();
  const parsed = inspectVacaskSource("editor", text, state.facet(nativeEntry));
  if (parsed.comments.some((c) => cursor >= c.start && cursor <= c.end))
    return null;
  const line = state.doc.lineAt(cursor);
  const statement = parsed.statements.find(
    (s) =>
      s.sourceRef.start.offset <= cursor &&
      (s.sourceRef.end.offset >= cursor ||
        s.sourceRef.end.line === line.number),
  );
  if (!statement) return null;
  const fields = nativeArgumentFields(text, statement.tokens);
  const head = fields[0]?.value;
  const context = nativeControlContext(
    text.slice(0, statement.sourceRef.start.offset),
    state.facet(nativeEntry),
  )
    ? "control"
    : "circuit";
  let help = head ? lookupNativeHelp(head, context) : undefined;
  let hints: readonly NativeParameterHint[] = help?.parameters ?? [];
  let tokens = fields.slice(1);
  if (head === "analysis" && context === "control" && fields[2]) {
    const specific = lookupNativeHelp(`analysis ${fields[2].value}`, context);
    if (specific) {
      help = specific;
      hints = [
        { label: "name" },
        { label: "type", choices: ["op", "ac", "tran", "noise"] },
        ...(specific.parameters ?? []),
      ];
    }
  } else if (
    !help &&
    context === "circuit" &&
    statement.tokens[1]?.value === "("
  ) {
    const symbols = nativeLanguageSymbols([
      { text, entry: state.facet(nativeEntry) },
      ...state.facet(nativeCompanions).map((text) => ({ text, entry: false })),
    ]);
    const module = symbols.models.get(fields[2]?.value ?? "");
    const type = fields
      .find((f) => /^type\s*=/u.test(f.value))
      ?.value.split("=")[1]
      ?.trim()
      .replace(/^"|"$/gu, "");
    hints = [
      { label: "(ordered nodes)" },
      { label: "master" },
      ...nativeSourceHints(module, type),
    ];
    help = {
      name: head!,
      context,
      signature: "name (nodes) master name=value ...",
      summary:
        "Instance node order comes from its master. Source AC uses mag/phase alongside its selected transient type.",
      section: "cir-instance",
      group: "Sources & loads",
      parameters: hints,
    };
  }
  if (!help || !hints.length) return null;
  const positional = hints.filter((h) => !h.key && !h.repeat);
  const repeating = hints.find((h) => h.repeat);
  const used = new Set<string>();
  const parameters: NativeParameterHint[] = tokens.map((token, i) => {
    if (i < positional.length) return positional[i]!;
    const key = /^([^=\s]+)\s*=/u.exec(token.value)?.[1];
    if (key) used.add(key);
    return (
      hints.find((h) => h.key === key && h.key !== undefined) ??
      repeating ?? { label: "name=value" }
    );
  });
  parameters.push(
    ...positional.slice(tokens.length),
    ...hints.filter((h) => h.key && !used.has(h.key)),
  );
  if (repeating) parameters.push(repeating);
  let active = tokens.findIndex((t) => cursor >= t.from && cursor <= t.to);
  const last = tokens.at(-1);
  if (
    active < 0 &&
    last &&
    /=$/u.test(last.value) &&
    cursor >= last.to &&
    /^\s*$/u.test(text.slice(last.to, cursor))
  )
    active = tokens.length - 1;
  return {
    line,
    help,
    tokens,
    index: active < 0 ? tokens.length : active,
    parameters,
  };
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

export function insertNativeHelp(
  view: EditorView,
  help: NativeLanguageHelp,
  from?: number,
  to?: number,
) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const start = from ?? line.from;
  const end = to ?? line.to;
  const text = nativeHelpInsertion(
    help,
    view.state.doc.toString(),
    view.state.facet(nativeEntry),
  );
  view.dispatch({
    changes: { from: start, to: end, insert: text },
    selection: {
      anchor: start + (help.primitive ? text.indexOf("()") + 1 : text.length),
    },
    effects: dismissParameterGuide.of(false),
    userEvent: "input.complete",
  });
  view.focus();
}

export function dismissNativeGuide(view: EditorView): boolean {
  const closed = closeCompletion(view);
  if (!parameterGuide(view.state) || view.state.field(guideDismissed, false))
    return closed;
  view.dispatch({ effects: dismissParameterGuide.of(true) });
  return true;
}

export const nativeParameterGuide = [
  guideDismissed,
  ghost,
  keymap.of([
    {
      key: "Escape",
      run: dismissNativeGuide,
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
