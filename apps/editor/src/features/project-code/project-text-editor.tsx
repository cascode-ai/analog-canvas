import { useLayoutEffect, useRef } from "react";
import {
  Annotation,
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet,
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
  /**
   * Spans lit line by line: the parts selected on the canvas, or in the
   * `warning` tone, the lines a finding names.
   */
  highlightedRanges?: readonly HighlightedRange[];
  /**
   * Changes when a new selection should come into view. Typing moves the
   * lit spans without changing it, so the view does not jump.
   */
  revealHighlight?: string;
}

const externalUpdate = Annotation.define<boolean>();

export interface HighlightedRange {
  from: number;
  to: number;
  tone?: "warning";
}

const setHighlight = StateEffect.define<readonly HighlightedRange[]>();
const TONE_CLASS = {
  selection: "cm-code-highlight",
  warning: "cm-code-warning",
};

function highlightDecorations(
  state: EditorState,
  ranges: readonly HighlightedRange[],
): DecorationSet {
  // A line can be both selected and flagged: it carries both classes.
  const lines = new Map<number, Set<string>>();
  for (const range of ranges) {
    if (range.from > state.doc.length) continue;
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(Math.min(range.to, state.doc.length)).number;
    for (let line = first; line <= last; line++)
      lines.set(
        line,
        (lines.get(line) ?? new Set()).add(
          TONE_CLASS[range.tone ?? "selection"],
        ),
      );
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const [line, classes] of [...lines].sort(
    ([left], [right]) => left - right,
  )) {
    const start = state.doc.line(line).from;
    builder.add(
      start,
      start,
      Decoration.line({ class: [...classes].join(" ") }),
    );
  }
  return builder.finish();
}

/** Lit lines, carried through edits until the next selection replaces them. */
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(lines, transaction) {
    let next = lines.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(setHighlight))
        next = highlightDecorations(transaction.state, effect.value);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

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
          highlightField,
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

  const highlightKey = JSON.stringify(props.highlightedRanges ?? []);
  useLayoutEffect(() => {
    viewRef.current?.dispatch({
      effects: setHighlight.of(props.highlightedRanges ?? []),
    });
    // Keyed by content: a new array with the same spans does not repaint.
  }, [highlightKey]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    // A selection comes into view; flagged lines stay where they are.
    const first = props.highlightedRanges?.find(
      (range) => range.tone !== "warning",
    );
    if (!view || !first || first.from > view.state.doc.length) return;
    view.dispatch({
      effects: EditorView.scrollIntoView(first.from, {
        y: "start",
        yMargin: 24,
      }),
    });
    // Only a new selection scrolls; see `revealHighlight`.
  }, [props.revealHighlight]);

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
    // Read-only text still takes focus and a cursor: a click on a line is how
    // it names that line's part, and its text can be selected and copied.
    EditorState.readOnly.of(Boolean(props.readOnly)),
    EditorView.contentAttributes.of({
      "aria-label": props.ariaLabel,
      "aria-readonly": props.readOnly ? "true" : "false",
      "aria-invalid": props.invalid ? "true" : "false",
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
      autocorrect: "off",
    }),
  ];
}
