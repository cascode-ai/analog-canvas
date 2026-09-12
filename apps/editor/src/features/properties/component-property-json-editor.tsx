import { useLayoutEffect, useRef } from "react";
import {
  EditorState,
  Annotation,
  StateField,
  Transaction,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
  syntaxTree,
  indentUnit,
} from "@codemirror/language";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { linter } from "@codemirror/lint";
import {
  parseComponentPropertyCode,
  type ComponentPropertyCodeContext,
} from "./component-property-code";
import { propertyCodeSpans } from "./component-property-code-assists";

interface Props {
  value: string;
  historyKey: number;
  context: ComponentPropertyCodeContext;
  focusRequest: number;
  onChange(source: string): void;
}
const externalUpdate = Annotation.define<boolean>();

/** Lazy loaded: selecting a component does not make the canvas shell depend on CodeMirror. */
export default function ComponentPropertyJsonEditor(props: Props) {
  const parent = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const historyKey = useRef(props.historyKey);
  const createState = useRef<(source: string) => EditorState>(() =>
    EditorState.create(),
  );

  useLayoutEffect(() => {
    if (!parent.current) return;
    const read = () => latest.current;
    const tokenField = StateField.define<DecorationSet>({
      create: jsonTokenDecorations,
      update: (value, transaction) =>
        transaction.docChanged ||
        syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
          ? jsonTokenDecorations(transaction.state)
          : value,
      provide: (field) => EditorView.decorations.from(field),
    });
    createState.current = (source) =>
      EditorState.create({
        doc: source,
        extensions: [
          json(),
          indentUnit.of("  "),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          closeBrackets(),
          syntaxHighlighting(defaultHighlightStyle),
          linter((view) => {
            const syntax = jsonParseLinter()(view);
            if (syntax.length) return syntax;
            const source = view.state.doc.toString();
            const parsed = parseComponentPropertyCode(source, read().context);
            if (parsed.ok) return [];
            const span = propertyCodeSpans(source, read().context)
              .sort((a, b) => b.field.path.length - a.field.path.length)
              .find(({ field }) => parsed.message.includes(field.path));
            return [
              {
                from: span?.from ?? 0,
                to: span?.to ?? Math.min(1, source.length),
                severity: "error" as const,
                message: parsed.message,
              },
            ];
          }),
          tokenField,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "Editable Canvas property code",
            spellcheck: "false",
          }),
          keymap.of([
            { key: "Mod-Shift-z", run: redo, preventDefault: true },
            ...historyKeymap,
            ...closeBracketsKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((transaction) =>
                transaction.annotation(externalUpdate),
              )
            )
              read().onChange(update.state.doc.toString());
          }),
        ],
      });
    const view = new EditorView({
      parent: parent.current,
      state: createState.current(read().value),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (historyKey.current !== props.historyKey) {
      historyKey.current = props.historyKey;
      view.setState(createState.current(props.value));
    } else if (view.state.doc.toString() !== props.value) {
      const current = view.state.doc.toString();
      let from = 0;
      let suffix = 0;
      while (
        from < Math.min(current.length, props.value.length) &&
        current[from] === props.value[from]
      )
        from++;
      while (
        suffix < Math.min(current.length, props.value.length) - from &&
        current[current.length - 1 - suffix] ===
          props.value[props.value.length - 1 - suffix]
      )
        suffix++;
      view.dispatch({
        changes: {
          from,
          to: current.length - suffix,
          insert: props.value.slice(from, props.value.length - suffix),
        },
        annotations: [
          Transaction.addToHistory.of(false),
          externalUpdate.of(true),
        ],
      });
    }
  }, [props.value, props.historyKey, props.context]);

  useLayoutEffect(() => {
    if (props.focusRequest > 0) viewRef.current?.focus();
  }, [props.focusRequest]);

  return <div className="component-json-editor" ref={parent} />;
}

/** Syntax marks are visual only; the editable document contains no widgets. */
function jsonTokenDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const classes: Record<string, string> = {
    PropertyName: "key",
    String: "string",
    Number: "number",
    True: "boolean",
    False: "boolean",
    Null: "boolean",
    "{": "bracket",
    "}": "bracket",
    "[": "bracket",
    "]": "bracket",
  };
  syntaxTree(state).iterate({
    enter(node) {
      const token = classes[node.name];
      if (token && node.to > node.from)
        ranges.push(
          Decoration.mark({ class: `cm-json-${token}` }).range(
            node.from,
            node.to,
          ),
        );
    },
  });
  return Decoration.set(ranges, true);
}
