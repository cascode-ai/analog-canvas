import { useLayoutEffect, useRef } from "react";
import {
  EditorState,
  Annotation,
  StateEffect,
  StateField,
  Transaction,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  drawSelection,
  type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
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
import {
  colorToRgb,
  parseCanvasColor,
  MIRROR_OPTIONS,
  ROTATION_OPTIONS,
} from "./component-property-fields";
import {
  propertyCodeSpans,
  propertyCodeChanges,
  reflectedPropertyCode,
  type PropertyCodeSpan,
} from "./component-property-code-assists";

interface Props {
  value: string;
  historyKey: number;
  context: ComponentPropertyCodeContext;
  defaultForeground: string;
  focusRequest: number;
  showHelp: boolean;
  onChange(source: string): void;
}
const refreshAssists = StateEffect.define<null>();
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
    const assistField = StateField.define<DecorationSet>({
      create: (state) => decorations(state, read),
      update: (value, transaction) =>
        transaction.docChanged ||
        transaction.effects.some((effect) => effect.is(refreshAssists)) ||
        syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
          ? decorations(transaction.state, read)
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
          bracketMatching(),
          closeBrackets(),
          syntaxHighlighting(defaultHighlightStyle),
          linter(jsonParseLinter()),
          assistField,
          EditorView.contentAttributes.of({
            "aria-label": "Editable Canvas property code",
            spellcheck: "false",
          }),
          keymap.of([
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
    } else view.dispatch({ effects: refreshAssists.of(null) });
  }, [
    props.value,
    props.historyKey,
    props.context,
    props.defaultForeground,
    props.showHelp,
  ]);

  useLayoutEffect(() => {
    if (props.focusRequest > 0) viewRef.current?.focus();
  }, [props.focusRequest]);

  return <div className="component-json-editor" ref={parent} />;
}

function decorations(state: EditorState, read: () => Props): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  // Give stable, themeable classes to JSON tokens; assistance is never part of the document.
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
  const source = state.doc.toString();
  const enabled = parseComponentPropertyCode(source, read().context).ok;
  for (const span of propertyCodeSpans(source, read().context)) {
    if (span.field.kind !== "text" && span.field.kind !== "coordinate")
      ranges.push(
        Decoration.widget({
          widget: new PropertyAssist(
            span,
            enabled,
            read().defaultForeground,
            read,
          ),
          side: 1,
        }).range(state.doc.lineAt(span.to).to),
      );
    if (read().showHelp)
      ranges.push(
        Decoration.widget({
          widget: new PropertyHelp(span.field.description),
          block: true,
          side: 2,
        }).range(state.doc.lineAt(span.to).to),
      );
  }
  return Decoration.set(ranges, true);
}

class PropertyHelp extends WidgetType {
  constructor(readonly description: string) {
    super();
  }
  override eq(other: PropertyHelp) {
    return this.description === other.description;
  }
  toDOM() {
    const dom = document.createElement("div");
    dom.className = "cm-property-hint";
    dom.textContent = this.description;
    return dom;
  }
}

class PropertyAssist extends WidgetType {
  constructor(
    readonly span: PropertyCodeSpan,
    readonly enabled: boolean,
    readonly foreground: string,
    readonly read: () => Props,
  ) {
    super();
  }
  override eq(other: PropertyAssist) {
    return (
      JSON.stringify(this.span.field) === JSON.stringify(other.span.field) &&
      this.span.from === other.span.from &&
      this.span.to === other.span.to &&
      JSON.stringify(this.span.value) === JSON.stringify(other.span.value) &&
      this.enabled === other.enabled &&
      this.foreground === other.foreground
    );
  }
  override ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const { field, value } = this.span;
    const dom = document.createElement("span");
    dom.className = "cm-property-assist";
    dom.setAttribute("data-property-assist", field.path);
    dom.contentEditable = "false";
    dom.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
    const change = (values: Record<string, unknown>) => {
      const changes = propertyCodeChanges(
        view.state.doc.toString(),
        this.read().context,
        values,
      );
      if (changes.length)
        view.dispatch({ changes, userEvent: "input.property-control" });
    };
    const button = (label: string, text: string, run: () => void) => {
      const control = document.createElement("button");
      control.type = "button";
      control.setAttribute("aria-label", label);
      control.title = label;
      control.textContent = text;
      control.disabled = !this.enabled;
      control.onclick = run;
      dom.append(control);
      return control;
    };
    if (field.kind === "boolean" && typeof value === "boolean") {
      const toggle = button(
        `Show ${field.label.toLowerCase()}`,
        value ? "On" : "Off",
        () => change({ [field.path]: !value }),
      );
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-checked", String(value));
      toggle.className = "cm-property-toggle";
    }
    if (
      field.kind === "rotation" ||
      field.kind === "mirror" ||
      field.kind === "choice"
    ) {
      const select = document.createElement("select");
      select.setAttribute("aria-label", `${field.label} options`);
      select.title = field.description;
      select.disabled = !this.enabled;
      const options =
        field.kind === "rotation"
          ? ROTATION_OPTIONS
          : field.kind === "mirror"
            ? MIRROR_OPTIONS
            : (field.options ?? []);
      for (const option of options) {
        const element = document.createElement("option");
        element.value = String(option.value);
        element.textContent = option.label;
        select.append(element);
      }
      select.value = String(value);
      select.onchange = () =>
        change({
          [field.path]:
            field.kind === "rotation" ? Number(select.value) : select.value,
        });
      dom.append(select);
      if (field.kind === "mirror")
        for (const [direction, label] of [
          ["left-right", "Flip left/right"],
          ["top-bottom", "Flip top/bottom"],
        ] as const) {
          button(label, direction === "left-right" ? "↔" : "↕", () => {
            const changes = reflectedPropertyCode(
              view.state.doc.toString(),
              this.read().context,
              direction,
            );
            if (changes.length)
              view.dispatch({ changes, userEvent: "input.property-control" });
          });
        }
    }
    if (field.kind === "color") {
      let color: string;
      try {
        color = parseCanvasColor(value, field.path);
      } catch {
        color = "auto";
      }
      const inherited = color === "auto";
      const isForeground = field.path === "appearance.foreground";
      const effective = inherited
        ? isForeground
          ? this.foreground
          : "#ffffff"
        : color;
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = parseCanvasColor(colorToRgb(effective), field.path);
      picker.setAttribute("aria-label", `${field.label} color picker`);
      picker.title = inherited
        ? isForeground
          ? `Global RGB: ${JSON.stringify(colorToRgb(effective))}`
          : "No independent background fill"
        : `RGB: ${JSON.stringify(colorToRgb(effective))}`;
      picker.disabled = !this.enabled;
      picker.onchange = () =>
        change({ [field.path]: colorToRgb(picker.value) });
      dom.append(picker);
      const reset = button(
        isForeground ? "Use global foreground" : "Use no background fill",
        isForeground ? "Global" : "No fill",
        () => change({ [field.path]: "auto" }),
      );
      reset.disabled = !this.enabled || inherited;
    }
    return dom;
  }
}
