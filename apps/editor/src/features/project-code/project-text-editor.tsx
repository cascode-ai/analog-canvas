import { useLayoutEffect, useRef } from "react";
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
  insertNewline,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { searchKeymap } from "@codemirror/search";

import { spiceCodeLanguage } from "../simulation/code-spice-language";

export type ProjectTextLanguage = "json" | "netlist";

interface Props {
  ariaLabel: string;
  language: ProjectTextLanguage;
  value: string;
  readOnly?: boolean;
  invalid?: boolean;
  onChange?(source: string): void;
  onModEnter?(): void;
  onEnter?(): void;
  onCursorChange?(position: number): void;
  onBlur?(): void;
}

const externalUpdate = Annotation.define<boolean>();

/** A compact project-level editor: source text, line numbers, and syntax color only. */
export default function ProjectTextEditor(props: Props) {
  const parent = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const configuration = useRef(new Compartment());

  useLayoutEffect(() => {
    if (!parent.current) return;
    const read = () => latest.current;
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: read().value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          drawSelection(),
          highlightActiveLine(),
          EditorView.domEventHandlers({
            blur: () => {
              read().onBlur?.();
            },
          }),
          history(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle),
          configuration.current.of(configuredExtensions(read())),
          keymap.of([
            { key: "Shift-Enter", run: insertNewline },
            {
              key: "Enter",
              run: () => {
                read().onEnter?.();
                return Boolean(read().onEnter);
              },
            },
            {
              key: "Mod-Enter",
              run: () => {
                read().onModEnter?.();
                return Boolean(read().onModEnter);
              },
              preventDefault: true,
            },
            ...historyKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((transaction) =>
                transaction.annotation(externalUpdate),
              )
            )
              read().onChange?.(update.state.doc.toString());
            if (
              update.selectionSet ||
              update.docChanged ||
              update.focusChanged
            ) {
              if (update.view.hasFocus)
                read().onCursorChange?.(update.state.selection.main.head);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    viewRef.current?.dispatch({
      effects: configuration.current.reconfigure(configuredExtensions(props)),
    });
  }, [props.ariaLabel, props.invalid, props.language, props.readOnly]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === props.value) return;
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
        externalUpdate.of(true),
        Transaction.addToHistory.of(false),
      ],
    });
  }, [props.value]);

  return (
    <div
      ref={parent}
      className="project-source-editor"
      data-invalid={props.invalid ? "true" : "false"}
      data-language={props.language}
      onKeyDown={(event) => event.stopPropagation()}
    />
  );
}

function configuredExtensions(props: Props): Extension[] {
  return [
    props.language === "json" ? json() : spiceCodeLanguage,
    EditorState.readOnly.of(Boolean(props.readOnly)),
    EditorView.editable.of(!props.readOnly),
    EditorView.contentAttributes.of({
      "aria-label": props.ariaLabel,
      "aria-invalid": props.invalid ? "true" : "false",
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
      autocorrect: "off",
    }),
  ];
}
