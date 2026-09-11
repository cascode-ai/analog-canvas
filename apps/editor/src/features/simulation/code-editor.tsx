import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
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
  startCompletion,
  CompletionContext,
  selectedCompletion,
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
import {
  controlContext,
  insertSpiceHelp,
  spiceParameterGuide,
  dismissParameterGuide,
  dismissSpiceGuide,
  parameterGuide,
} from "./code-parameter-guide";
import { CodeHelperList, type CodeHelperAction } from "./code-helper-list";
import { nativeSaveEdit } from "./native-save-edit";

export interface SimulationCodeEditorProps {
  path: string;
  text: string;
  /** A committed revision/history boundary. Do not change this while typing a local draft. */
  historyKey: string;
  mode?: "spice" | "json";
  entry?: boolean;
  readOnly?: boolean;
  diagnostics?: readonly SimulationSourceDiagnostic[] | undefined;
  /** Generated authoring slots are not legal values; diagnose them without locking the file. */
  generated?: boolean;
  /** Exact mapped-parameter validation reuses the compiler's edit planner. */
  validateText?(
    text: string,
  ): readonly { from: number; to: number; message: string; code: string }[];
  onChange(text: string): void;
  /** Generated Circuit uses its mapped-span planner here; invalid numeric drafts may remain editable. */
  acceptChange?(text: string): boolean;
  onRejectedChange?(): void;
  onSave?(): void;
  onRun?(): void;
  onHistoryBoundary?(direction: "undo" | "redo"): void;
  onCursor?(sourceOffset: number): void;
  helperActions?: readonly CodeHelperAction[];
  relatedSources?: readonly string[];
  signalNames?: (() => Readonly<Record<string, string>>) | undefined;
  onFocusSignal?: ((vector: string | null) => void) | undefined;
  saveRequest?: { id: string; vectors: string[] } | undefined;
  reveal?:
    { sourceOffset: number; requestId: string; focus?: boolean } | undefined;
}

const externalChange = Annotation.define<boolean>();
/** Loaded only by the Code workspace. It owns local text history, never Project/Run state. */
export default function SimulationCodeEditor(props: SimulationCodeEditorProps) {
  const [helperOpen, setHelperOpen] = useState(false);
  const [unknownCommand, setUnknownCommand] = useState(false);
  const [argumentHint, setArgumentHint] = useState("");
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const exact = useRef(props.text);
  const committed = useRef(`${props.path}\u0000${props.historyKey}`);
  const documents = useRef(
    new Map<
      string,
      {
        state: EditorState;
        scroll: ReturnType<EditorView["scrollSnapshot"]>;
      }
    >(),
  );
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
            if (update.selectionSet || update.docChanged) {
              const guide =
                callbacks.current.mode === "json"
                  ? null
                  : parameterGuide(update.state);
              setArgumentHint(guide?.parameters[guide.index]?.label ?? "");
              const line = update.state.doc.lineAt(
                update.state.selection.main.head,
              );
              const word = line.text.trim();
              setUnknownCommand(
                /^[\p{L}]{2,}$/u.test(word) &&
                  !spiceCompletion(
                    new CompletionContext(
                      update.state,
                      update.state.selection.main.head,
                      true,
                    ),
                  )?.options.some((option) =>
                    option.label.toLowerCase().startsWith(word.toLowerCase()),
                  ),
              );
            }
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
      view.current?.destroy();
      view.current = null;
    };
    // An editor belongs to this mount; current props are read through the ref.
  }, []);

  // File identity must be reflected in the DOM before the next input/focus event.
  // A passive effect lets fast tab switches type into the outgoing document and
  // capture its short viewport as the returning file's scroll snapshot.
  useLayoutEffect(() => {
    let editor = view.current;
    if (!editor) return;
    const key = `${props.path}\u0000${props.historyKey}`;
    if (key !== committed.current) {
      documents.current.set(committed.current, {
        state: editor.state,
        scroll: editor.scrollSnapshot(),
      });
      const samePath = committed.current.split("\u0000")[0] === props.path;
      const anchor = samePath ? editor.state.selection.main.head : 0;
      const cached = documents.current.get(key);
      const reusable = cached?.state.field(exactSourceField) === props.text;
      const scroll = reusable
        ? cached.scroll
        : samePath && editor.state.field(exactSourceField) === props.text
          ? editor.scrollSnapshot()
          : undefined;
      const focused = editor.hasFocus;
      exact.current = props.text;
      const state = reusable
        ? cached.state
        : createState.current(props.text, anchor);
      // A new viewport can initialize its virtual height map around the restored
      // scroll anchor; recycling a short file's viewport clamps a long file's scroll.
      editor.destroy();
      editor = new EditorView({
        parent: parent.current!,
        state,
        ...(scroll ? { scrollTo: scroll } : {}),
      });
      view.current = editor;
      editor.dispatch({
        effects: configuration.current.reconfigure(extensions()),
      });
      if (focused) editor.focus();
      callbacks.current.onCursor?.(
        sourceOffset(props.text, editor.state.selection.main.head),
      );
      // Keep one revision per file. Committed history is owned by Project Undo/Redo.
      for (const stored of documents.current.keys())
        if (stored !== key && stored.split("\u0000")[0] === props.path)
          documents.current.delete(stored);
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

  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: configuration.current.reconfigure(extensions()),
    });
  }, [
    props.mode,
    props.entry,
    props.readOnly,
    props.generated,
    props.diagnostics,
  ]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || !props.reveal) return;
    const anchor = editorOffset(exact.current, props.reveal.sourceOffset);
    editor.dispatch({ selection: { anchor }, scrollIntoView: true });
    if (props.reveal.focus !== false) editor.focus();
  }, [props.reveal?.requestId]);

  useEffect(() => {
    const editor = view.current;
    if (
      !editor ||
      !props.saveRequest ||
      props.generated ||
      props.mode === "json"
    )
      return;
    const edit = nativeSaveEdit(
      editor.state.doc.toString(),
      editor.state.selection.main.head,
      props.saveRequest.vectors,
      !!props.entry,
    );
    editor.dispatch({
      changes: { from: edit.from, insert: edit.insert },
      selection: { anchor: edit.from + edit.insert.length },
      scrollIntoView: true,
    });
    editor.focus();
  }, [props.saveRequest?.id]);

  return (
    <div className="simulation-code-editor-shell">
      <div
        className="simulation-code-helper-toolbar"
        style={
          props.mode === "json" && !props.helperActions?.length
            ? { visibility: "hidden" }
            : undefined
        }
      >
        <button
          type="button"
          title="Insert / Helper · Ctrl+Space"
          data-simulation-helper-trigger
          aria-expanded={helperOpen}
          onClick={() => setHelperOpen((open) => !open)}
        >
          Helper <kbd>Ctrl+Space</kbd>
        </button>
        {unknownCommand && !helperOpen && (
          <button
            className="simulation-find-helper"
            onClick={() => setHelperOpen(true)}
          >
            Find a helper…
          </button>
        )}
        {argumentHint && (
          <small aria-live="polite">{argumentHint} · Tab / Shift+Tab</small>
        )}
      </div>
      {helperOpen && (
        <CodeHelperList
          language={props.mode ?? "spice"}
          control={controlContext(
            view.current?.state.doc.sliceString(
              0,
              view.current.state.selection.main.head,
            ) ?? "",
          )}
          actions={props.helperActions}
          onClose={() => {
            setHelperOpen(false);
            view.current?.focus();
          }}
          onChoose={(rule) => {
            const editor = view.current;
            if (!editor || props.readOnly || props.mode === "json") return;
            const line = editor.state.doc.lineAt(
              editor.state.selection.main.head,
            );
            if (
              /^(PULSE|SIN|PWL)$/u.test(rule.name) &&
              /^[VI]\S*\s/iu.test(line.text.trim())
            ) {
              insertSpiceHelp(
                editor,
                rule,
                editor.state.selection.main.from,
                editor.state.selection.main.to,
              );
              return;
            }
            // Replace an unfinished command only. Existing populated code is preserved.
            if (/^\s*[.\p{L}\w]*$/u.test(line.text))
              insertSpiceHelp(editor, rule);
            else {
              editor.dispatch({
                changes: { from: line.to, insert: "\n" },
                selection: { anchor: line.to + 1 },
              });
              insertSpiceHelp(editor, rule);
            }
          }}
        />
      )}
      <div
        ref={parent}
        className="simulation-code-editor"
        onKeyDownCapture={(event) => {
          if (
            event.key === "Escape" &&
            props.mode !== "json" &&
            view.current &&
            dismissSpiceGuide(view.current)
          ) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (
            !event.ctrlKey ||
            event.code !== "Space" ||
            event.altKey ||
            event.nativeEvent.isComposing
          )
            return;
          const editor = view.current;
          if (!editor) return;
          event.preventDefault();
          event.stopPropagation();
          if (props.mode === "json") {
            if (props.helperActions?.length) setHelperOpen(true);
            else startCompletion(editor);
            return;
          }
          editor.dispatch({ effects: dismissParameterGuide.of(false) });
          const line = editor.state.doc.lineAt(
            editor.state.selection.main.head,
          );
          const prefix = line.text.trim().toLowerCase();
          if (
            /^[.\p{L}\w]+$/u.test(prefix) &&
            !spiceCompletion(
              new CompletionContext(
                editor.state,
                editor.state.selection.main.head,
                true,
              ),
            )?.options.some((option) =>
              option.label.toLowerCase().startsWith(prefix),
            )
          )
            setHelperOpen(true);
          else startCompletion(editor);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </div>
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
          spiceParameterGuide,
          autocompletion({
            override: [
              (context) =>
                spiceCompletion(
                  context,
                  callbacks.current.relatedSources,
                  callbacks.current.signalNames,
                ),
            ],
            activateOnTypingDelay: 350,
          }),
          EditorView.updateListener.of((update) => {
            const previous = selectedCompletion(update.startState)?.label;
            const selected = selectedCompletion(update.state)?.label;
            if (!update.view.hasFocus) {
              callbacks.current.onFocusSignal?.(null);
              return;
            }
            if (selected && selected !== previous)
              callbacks.current.onFocusSignal?.(selected);
            if (previous && !selected) callbacks.current.onFocusSignal?.(null);
            if (!selected && update.selectionSet) {
              const cursor = update.state.selection.main.head;
              const line = update.state.doc.lineAt(cursor);
              const vector = [...line.text.matchAll(/\bv\([^\s)]+\)/giu)].find(
                (match) =>
                  line.from + match.index <= cursor &&
                  cursor <= line.from + match.index + match[0].length,
              );
              callbacks.current.onFocusSignal?.(vector?.[0] ?? null);
            }
          }),
          ViewPlugin.define((view) => {
            const preview = (event: MouseEvent) => {
              const row = (event.target as Element).closest?.(
                ".cm-tooltip-autocomplete li",
              );
              const label = row?.querySelector(
                ".cm-completionLabel",
              )?.textContent;
              if (label) callbacks.current.onFocusSignal?.(label);
            };
            const clear = () => callbacks.current.onFocusSignal?.(null);
            view.dom.addEventListener("mouseover", preview);
            view.dom.addEventListener("mouseleave", clear);
            view.contentDOM.addEventListener("blur", clear);
            return {
              destroy() {
                view.dom.removeEventListener("mouseover", preview);
                view.dom.removeEventListener("mouseleave", clear);
                view.contentDOM.removeEventListener("blur", clear);
                clear();
              },
            };
          }),
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
        if (current.generated) {
          for (const match of text.matchAll(/<([A-Za-z][A-Za-z0-9_]*)>/g)) {
            if (
              text
                .slice(text.lastIndexOf("\n", match.index) + 1, match.index)
                .trimStart()
                .startsWith("*")
            )
              continue;
            diagnostics.push({
              from: editorOffset(text, match.index),
              to: editorOffset(text, match.index + match[0].length),
              severity: "error",
              message: `Enter ${match[1]}. This incomplete value can be saved, but cannot run.`,
              source: "MISSING_REQUIRED_PARAMETER",
            });
          }
        }
        for (const item of current.validateText?.(text) ?? [])
          diagnostics.push({
            from: editorOffset(text, item.from),
            to: editorOffset(text, item.to),
            severity: "error",
            message: item.message,
            source: item.code,
          });
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
