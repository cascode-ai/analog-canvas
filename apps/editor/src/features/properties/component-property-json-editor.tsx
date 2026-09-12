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
import {
  colorToRgb,
  parseCanvasColor,
  ROTATION_OPTIONS,
} from "./component-property-fields";
import { COLOR_PRESETS } from "./color-override-control";
import {
  propertyCodeSpans,
  propertyCodeChanges,
  reflectedPropertyCode,
  type PropertyCodeSpan,
} from "./component-property-code-assists";

interface Props {
  value: string;
  historyKey: number;
  baselineCode: string;
  context: ComponentPropertyCodeContext;
  defaultForeground: string;
  focusRequest: number;
  onChange(source: string): void;
  showHelp: boolean;
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
      view.dispatch({ effects: refreshAssists.of(null) });
    } else if (view.state.doc.toString() !== props.value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: props.value },
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
  let enabled = true;
  try {
    JSON.parse(source);
  } catch {
    enabled = false;
  }
  const baseline = new Map(
    propertyCodeSpans(read().baselineCode, read().context).map((span) => [
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
    const at = source[span.to] === "," ? span.to + 1 : span.to;
    if (!["text", "coordinate"].includes(span.field.kind)) {
      ranges.push(
        Decoration.widget({
          widget: new PropertyAssist(
            span,
            enabled,
            read().defaultForeground,
            read,
          ),
          side: 1,
        }).range(at),
      );
    }
    if (read().showHelp) {
      const help = span.field.help || span.field.description;
      if (help)
        ranges.push(
          Decoration.widget({
            widget: new PropertyHelp(`${span.field.label}: ${help}`),
            block: true,
            side: 3,
          }).range(state.doc.lineAt(span.to).to),
        );
    } else if (span.field.description) {
      // Attach to this value, never a shared physical line end. Include its
      // comma so formatted JSON reads naturally; compact JSON stays unambiguous.
      ranges.push(
        Decoration.widget({
          widget: new PropertyComment(span.field.description),
          side: 2,
        }).range(at),
      );
    }
  }
  return Decoration.set(ranges, true);
}

class PropertyHelp extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: PropertyHelp) {
    return this.text === other.text;
  }
  toDOM() {
    const dom = document.createElement("div");
    dom.className = "cm-property-help-block";
    dom.contentEditable = "false";
    dom.textContent = this.text;
    return dom;
  }
  override ignoreEvent() {
    return true;
  }
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
    const dom = document.createElement("span");
    dom.className = "cm-property-assist";
    dom.dataset.kind = field.kind;
    dom.setAttribute("data-property-assist", field.path);
    dom.contentEditable = "false";
    dom.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
    const dispatchChanges = (
      changes: ReturnType<typeof propertyCodeChanges>,
    ) => {
      if (changes.length) {
        const previousFocus = document.activeElement;
        const focusedLabel = previousFocus?.getAttribute("aria-label");
        view.dispatch({ changes, userEvent: "input.property-control" });
        queueMicrotask(() => {
          if (!focusedLabel || previousFocus?.isConnected) return;
          const row = [
            ...view.dom.querySelectorAll<HTMLElement>("[data-property-assist]"),
          ].find((node) => node.dataset.propertyAssist === field.path);
          const next = [
            ...(row?.querySelectorAll<HTMLElement>("[aria-label]") ?? []),
          ].find((node) => node.getAttribute("aria-label") === focusedLabel);
          if (next?.getClientRects().length)
            next.focus({ preventScroll: true });
          else
            row
              ?.querySelector<HTMLButtonElement>(".cm-property-color-trigger")
              ?.focus({ preventScroll: true });
        });
      }
    };
    const change = (values: Record<string, unknown>) =>
      dispatchChanges(
        propertyCodeChanges(
          view.state.doc.toString(),
          this.read().context,
          values,
        ),
      );
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
    if (field.kind === "mirror") {
      for (const direction of ["left-right", "top-bottom"] as const) {
        const flip = button(
          `Flip ${direction === "left-right" ? "left/right" : "top/bottom"}`,
          "",
          () => {
            const changes = reflectedPropertyCode(
              view.state.doc.toString(),
              this.read().context,
              direction,
            );
            dispatchChanges(changes);
          },
        );
        flip.append(orientationIcon(direction));
        flip.disabled = !reflectedPropertyCode(
          view.state.doc.toString(),
          this.read().context,
          direction,
        ).length;
      }
    }
    if (field.kind === "choice" || field.kind === "rotation") {
      const select = document.createElement("select");
      select.setAttribute("aria-label", `${field.label} options`);
      select.title = field.description;
      select.disabled = !this.enabled;
      const options =
        field.kind === "rotation" ? ROTATION_OPTIONS : (field.options ?? []);
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
      const settings = document.createElement("div");
      settings.className = "component-property-color-popover";
      settings.setAttribute("popover", "auto");
      settings.setAttribute("role", "dialog");
      settings.setAttribute("aria-label", `${field.label} color settings`);
      const trigger = button(
        `Open ${field.label.toLowerCase()} colors`,
        "",
        () => {
          const bounds = trigger.getBoundingClientRect();
          settings.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - 244))}px`;
          settings.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 152))}px`;
          settings.togglePopover();
        },
      );
      trigger.className = "cm-property-color-trigger";
      trigger.style.backgroundColor = effective;
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-expanded", "false");
      settings.addEventListener("toggle", () =>
        trigger.setAttribute(
          "aria-expanded",
          String(settings.matches(":popover-open")),
        ),
      );
      settings.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          settings.hidePopover();
          trigger.focus();
          event.preventDefault();
        }
      });
      const heading = document.createElement("strong");
      heading.textContent = field.label;
      settings.append(heading);
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
      settings.append(picker);
      const reset = button(
        isForeground ? "Use global foreground" : "Use no background fill",
        isForeground ? "Global" : "No fill",
        () => change({ [field.path]: "auto" }),
      );
      reset.disabled = !this.enabled || inherited;
      settings.append(reset);
      const presets = document.createElement("div");
      presets.className = "component-property-swatches";
      presets.setAttribute("aria-label", `${field.label} presets`);
      for (const preset of COLOR_PRESETS) {
        const swatch = button(
          `Use ${preset.label} for ${field.label.toLowerCase()}`,
          "",
          () => change({ [field.path]: colorToRgb(preset.value) }),
        );
        swatch.className = "component-property-swatch";
        swatch.style.backgroundColor = preset.value;
        swatch.setAttribute(
          "aria-pressed",
          String(!inherited && color === preset.value),
        );
        presets.append(swatch);
      }
      settings.append(presets);
      dom.append(settings);
    }
    return dom;
  }
}

/** Same three silhouettes as the existing placement toolbar. */
function orientationIcon(kind: "rotate" | "left-right" | "top-bottom") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("class", "tool-icon");
  svg.setAttribute("aria-hidden", "true");
  const paths =
    kind === "rotate"
      ? ["M15.5 7A6 6 0 1 0 16 12", "M12.5 3.5H16v3.5"]
      : kind === "left-right"
        ? [
            "M10 3v14",
            "M3.5 6.5L8 4.5v11l-4.5-2z",
            "M16.5 6.5L12 4.5v11l4.5-2z",
          ]
        : [
            "M3 10h14",
            "M6.5 3.5L4.5 8h11l-2-4.5z",
            "M6.5 16.5L4.5 12h11l-2 4.5z",
          ];
  paths.forEach((d, index) => {
    const path = document.createElementNS(svg.namespaceURI, "path");
    for (const [name, value] of Object.entries({
      d,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.7",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }))
      path.setAttribute(name, value);
    if (kind !== "rotate" && index === 0)
      path.setAttribute("stroke-dasharray", "1.6 2");
    svg.append(path);
  });
  return svg;
}
