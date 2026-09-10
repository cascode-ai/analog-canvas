import { useEffect, useLayoutEffect, useRef } from "react";
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import { inspectSimulationSource } from "@icm/spice";
import type { SimulationSourceDiagnostic } from "@icm/netlist";
import {
  spiceCodeLanguage,
  spiceCompletion,
  spiceHoverHelp,
} from "./code-spice-language";
import {
  editorOffset,
  editorText,
  sourceOffset,
} from "./code-text-coordinates";
import {
  changedSourceText,
  exactSourceField,
  exactSourceHistory,
  restoreExactSource,
} from "./code-source-state";

export interface SimulationCodeEditorProps {
  path: string;
  text: string;
  /** A committed revision/history boundary. Do not change this while typing a local draft. */
  historyKey: string;
  mode?: "spice" | "json";
  entry?: boolean;
  readOnly?: boolean;
  diagnostics?: readonly SimulationSourceDiagnostic[];
  onChange(text: string): void;
  /** Generated Circuit uses its mapped-span planner here; invalid numeric drafts may remain editable. */
  acceptChange?(text: string): boolean;
  onRejectedChange?(): void;
  onSave?(): void;
  onRun?(): void;
  onHistoryBoundary?(direction: "undo" | "redo"): void;
  onCursor?(sourceOffset: number): void;
  reveal?: { sourceOffset: number; requestId: string };
}

const externalChange = Annotation.define<boolean>();
/** Loaded only by the Code workspace. It owns local text history, never Project/Run state. */
export default function SimulationCodeEditor(props: SimulationCodeEditorProps) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const exact = useRef(props.text);
  const committed = useRef(`${props.path}\u0000${props.historyKey}`);
  const createState = useRef<(text: string, selection?: number) => EditorState>(
    () => EditorState.create(),
  );
  const configuration = useRef(new Compartment());
  const extensions = () => sourceExtensions(callbacks, exact);

  useLayoutEffect(() => {
    if (!parent.current) return;
    createState.current = (text, selection = 0) =>
      EditorState.create({
        doc: editorText(text),
        selection: { anchor: Math.min(selection, editorText(text).length) },
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          drawSelection(),
          highlightActiveLine(),
          history(),
          exactSourceField.init(() => text),
          exactSourceHistory,
          bracketMatching(),
          closeBrackets(),
          syntaxHighlighting(defaultHighlightStyle),
          lintGutter(),
          configuration.current.of(extensions()),
          EditorView.contentAttributes.of({
            "aria-label": "Simulation source editor",
            spellcheck: "false",
            "data-simulation-code-input": "true",
          }),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                callbacks.current.onSave?.();
                return true;
              },
            },
            {
              key: "Mod-Enter",
              run: () => {
                callbacks.current.onRun?.();
                return true;
              },
            },
            ...historyKeymap.map((binding) => {
              const command = binding.run;
              if (command !== undo && command !== redo) return binding;
              return {
                ...binding,
                run: (v: EditorView) => {
                  if (!command(v))
                    callbacks.current.onHistoryBoundary?.(
                      command === undo ? "undo" : "redo",
                    );
                  return true;
                },
              };
            }),
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          EditorState.changeFilter.of((transaction) => {
            if (
              !transaction.docChanged ||
              transaction.annotation(externalChange)
            )
              return true;
            const next = changedSourceText(
              transaction.startState.field(exactSourceField),
              transaction,
            );
            if (callbacks.current.acceptChange?.(next) === false) {
              callbacks.current.onRejectedChange?.();
              return false;
            }
            return !callbacks.current.readOnly;
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              exact.current = update.state.field(exactSourceField);
              if (
                update.transactions.some(
                  (t) => t.docChanged && !t.annotation(externalChange),
                )
              )
                callbacks.current.onChange(exact.current);
            }
            if (update.selectionSet || update.docChanged)
              callbacks.current.onCursor?.(
                sourceOffset(exact.current, update.state.selection.main.head),
              );
          }),
        ],
      });
    exact.current = callbacks.current.text;
    const editor = new EditorView({
      parent: parent.current,
      state: createState.current(exact.current),
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
    // An editor belongs to this mount; current props are read through the ref.
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const key = `${props.path}\u0000${props.historyKey}`;
    if (key !== committed.current) {
      const scroll = editor.scrollDOM.scrollTop;
      const samePath = committed.current.split("\u0000")[0] === props.path;
      const anchor = samePath ? editor.state.selection.main.head : 0;
      exact.current = props.text;
      editor.setState(createState.current(props.text, anchor));
      if (samePath) editor.scrollDOM.scrollTop = scroll;
      committed.current = key;
    } else if (props.text !== exact.current) {
      exact.current = props.text;
      editor.dispatch({
        changes: {
          from: 0,
          to: editor.state.doc.length,
          insert: editorText(props.text),
        },
        effects: restoreExactSource.of(props.text),
        annotations: [
          externalChange.of(true),
          Transaction.addToHistory.of(false),
        ],
      });
    }
  }, [props.text, props.path, props.historyKey]);

  useEffect(() => {
    view.current?.dispatch({
      effects: configuration.current.reconfigure(extensions()),
    });
  }, [props.mode, props.entry, props.readOnly, props.diagnostics]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || !props.reveal) return;
    const anchor = editorOffset(exact.current, props.reveal.sourceOffset);
    editor.dispatch({ selection: { anchor }, scrollIntoView: true });
    editor.focus();
  }, [props.reveal?.requestId]);

  return (
    <div
      ref={parent}
      className="simulation-code-editor"
      onKeyDown={(event) => event.stopPropagation()}
    />
  );
}

function sourceExtensions(
  callbacks: { current: SimulationCodeEditorProps },
  exact: { current: string },
): Extension[] {
  const props = callbacks.current;
  const language =
    props.mode === "json"
      ? [json()]
      : [
          spiceCodeLanguage,
          autocompletion({ override: [spiceCompletion] }),
          spiceHoverHelp,
        ];
  return [
    ...language,
    EditorState.readOnly.of(Boolean(props.readOnly)),
    EditorView.editable.of(!props.readOnly),
    linter(
      (editor) => {
        const current = callbacks.current;
        const text = exact.current;
        const local =
          current.mode === "json"
            ? []
            : inspectSimulationSource(
                {
                  id: current.path,
                  path: current.path,
                  hash: "",
                  encoding: "utf-8",
                  text,
                },
                current.entry,
              ).diagnostics;
        const diagnostics: Diagnostic[] = (
          current.mode === "json" ? jsonParseLinter()(editor) : []
        ) as Diagnostic[];
        for (const item of [...local, ...(current.diagnostics ?? [])]) {
          if (
            ("path" in item && item.path && item.path !== current.path) ||
            !item.sourceRef
          )
            continue;
          const from = editorOffset(text, item.sourceRef.start.offset),
            to = editorOffset(text, item.sourceRef.end.offset);
          diagnostics.push({
            from,
            to: Math.max(from, to),
            severity: item.severity === "info" ? "info" : item.severity,
            message: item.message,
            source: item.code,
          });
        }
        return diagnostics;
      },
      { delay: 350 },
    ),
  ];
}
