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
import { Facet, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { createParameterGuide } from "./parameter-guide-view";

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

const guide = createParameterGuide(parameterGuide);
export const dismissParameterGuide = guide.dismissParameterGuide;
export const dismissNativeGuide = guide.dismiss;
export const nativeParameterGuide = guide.extension;
