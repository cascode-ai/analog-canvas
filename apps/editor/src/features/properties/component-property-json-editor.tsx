import { useLayoutEffect, useRef } from "react";
import {
  EditorState,
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
  highlightActiveLine,
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
  historyKey: string;
  context: ComponentPropertyCodeContext;
  defaultForeground: string;
  focusRequest: number;
  onChange(source: string): void;
  onApply(): void;
}
const refreshAssists = StateEffect.define<null>();

/** Lazy loaded: selecting a component does not make the canvas shell depend on CodeMirror. */
export default function ComponentPropertyJsonEditor(props: Props) {
  const parent = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
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
    const renderControls = (view: EditorView) => {
      if (!controls.current) return;
      const source = view.state.doc.toString();
      let enabled = true;
      try {
        JSON.parse(source);
      } catch {
        enabled = false;
      }
      const rows = propertyCodeSpans(source, read().context)
        .filter(({ field }) =>
          ["boolean", "rotation", "mirror", "choice", "color"].includes(
            field.kind,
          ),
        )
        .map((span) =>
          new PropertyAssist(
            span,
            enabled,
            read().defaultForeground,
            read,
          ).toDOM(view),
        );
      if (!enabled) {
        const note = document.createElement("p");
        note.className = "component-property-controls-note";
        note.textContent = "Complete JSON syntax to use controls.";
        rows.push(note);
      }
      // Keep keyboard focus when a control updates the shared draft.
      const activeLabel = controls.current.contains(document.activeElement)
        ? document.activeElement?.getAttribute("aria-label")
        : null;
      controls.current.replaceChildren(...rows);
      if (activeLabel) {
        const target = Array.from(
          controls.current.querySelectorAll<HTMLElement>("[aria-label]"),
        ).find((element) => element.getAttribute("aria-label") === activeLabel);
        target?.focus({ preventScroll: true });
      }
    };
    const assistField = StateField.define<DecorationSet>({
      create: (state) => decorations(state, read),
      update: (value, transaction) =>
        transaction.docChanged ||
        transaction.selection ||
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
          assistField,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "Editable Canvas property code",
            spellcheck: "false",
          }),
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                read().onApply();
                return true;
              },
            },
            {
              key: "Ctrl-Enter",
              run: () => {
                read().onApply();
                return true;
              },
            },
            ...historyKeymap,
            ...closeBracketsKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) read().onChange(update.state.doc.toString());
            if (
              update.docChanged ||
              update.transactions.some((transaction) =>
                transaction.effects.some((effect) => effect.is(refreshAssists)),
              )
            )
              renderControls(update.view);
          }),
        ],
      });
    const view = new EditorView({
      parent: parent.current,
      state: createState.current(read().value),
    });
    viewRef.current = view;
    renderControls(view);
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
      view.dispatch({ effects: refreshAssists.of(null) });
    } else if (view.state.doc.toString() !== props.value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: props.value },
        annotations: Transaction.addToHistory.of(false),
      });
    } else view.dispatch({ effects: refreshAssists.of(null) });
  }, [props.value, props.historyKey, props.context, props.defaultForeground]);

  useLayoutEffect(() => {
    if (props.focusRequest > 0) viewRef.current?.focus();
  }, [props.focusRequest]);

  return (
    <>
      <div className="component-json-editor" ref={parent} />
      <div
        className="component-property-controls"
        role="group"
        aria-label="Property controls"
        ref={controls}
      />
    </>
  );
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
  const baseline = new Map(
    propertyCodeSpans(read().historyKey, read().context).map((span) => [
      span.field.path,
      span.value,
    ]),
  );
  for (const span of propertyCodeSpans(source, read().context)) {
    // Object containers are not value chips. Their children own editing marks.
    if (
      span.value !== null &&
      typeof span.value === "object" &&
      !Array.isArray(span.value)
    )
      continue;
    const active =
      state.selection.main.head >= span.from &&
      state.selection.main.head <= span.to;
    const dirty =
      JSON.stringify(baseline.get(span.field.path)) !==
      JSON.stringify(span.value);
    ranges.push(
      Decoration.mark({
        class: `cm-property-value${active ? " cm-property-value-active" : ""}${dirty ? " cm-property-value-dirty" : ""}`,
      }).range(span.from, span.to),
    );
    if (span.field.description) {
      // Attach to this value, never a shared physical line end. Include its
      // comma so formatted JSON reads naturally; compact JSON stays unambiguous.
      const at = source[span.to] === "," ? span.to + 1 : span.to;
      ranges.push(
        Decoration.widget({
          widget: new PropertyComment(span.field.description),
          side: 1,
        }).range(at),
      );
    }
  }
  return Decoration.set(ranges, true);
}

class PropertyComment extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: PropertyComment) {
    return this.text === other.text;
  }
  toDOM() {
    const dom = document.createElement("span");
    dom.className = "cm-property-hint";
    dom.contentEditable = "false";
    dom.textContent = ` // ${this.text}`;
    return dom;
  }
  override ignoreEvent() {
    return true;
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
    const dom = document.createElement("div");
    dom.className = "cm-property-assist";
    dom.setAttribute("data-property-assist", field.path);
    dom.contentEditable = "false";
    const label = document.createElement("span");
    label.className = "component-property-control-label";
    label.textContent =
      field.kind === "boolean"
        ? `Show ${field.label.toLowerCase()}`
        : field.label;
    dom.append(label);
    dom.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        this.read().onApply();
      }
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
      if (
        field.path === "netlistTarget" &&
        typeof value === "string" &&
        !options.some((option) => String(option.value) === value)
      ) {
        const authored = document.createElement("option");
        authored.value = value;
        authored.textContent = value;
        select.append(authored);
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
          const flip = button(
            label,
            direction === "left-right" ? "↔" : "↕",
            () => {
              const changes = reflectedPropertyCode(
                view.state.doc.toString(),
                this.read().context,
                direction,
              );
              if (changes.length)
                view.dispatch({ changes, userEvent: "input.property-control" });
            },
          );
          flip.disabled = !reflectedPropertyCode(
            view.state.doc.toString(),
            this.read().context,
            direction,
          ).length;
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
      picker.value = effective;
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
