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
  keymap,
  drawSelection,
  highlightActiveLine,
  WidgetType,
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
  propertyCodeChanges,
  propertyCodeSpans,
  reflectedPropertyCode,
  type PropertyCodeSpan,
} from "./component-property-code-assists";
import {
  colorToRgb,
  MIRROR_OPTIONS,
  parseCanvasColor,
  ROTATION_OPTIONS,
} from "./component-property-fields";
import { COMMON_COLOR_PRESETS } from "./color-presets";
import { NO_INTERNAL_MARK } from "./component-visual-variants";

type PropertyCodeParseResult = { ok: true } | { ok: false; message: string };

export interface PropertyJsonEditorAdapter {
  parse(source: string): PropertyCodeParseResult;
  spans(source: string): PropertyCodeSpan[];
  changes(
    source: string,
    values: Readonly<Record<string, unknown>>,
  ): readonly { from: number; to: number; insert: string }[];
  reflected?(
    source: string,
    direction: "left-right" | "top-bottom",
  ): readonly { from: number; to: number; insert: string }[];
  mixedValues?: boolean;
}

interface Props {
  value: string;
  historyKey: number;
  context?: ComponentPropertyCodeContext;
  adapter?: PropertyJsonEditorAdapter;
  defaultForeground: string;
  focusRequest: number;
  onChange(source: string): void;
}
const externalUpdate = Annotation.define<boolean>();
const refreshDecorations = StateEffect.define<null>();
const LINE_COLOR_PRESETS = [
  ...COMMON_COLOR_PRESETS,
  { label: "Black", value: "#000000" },
] as const;

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
      create: (state) => jsonDecorations(state, read),
      update: (value, transaction) =>
        transaction.docChanged ||
        syntaxTree(transaction.startState) !== syntaxTree(transaction.state) ||
        transaction.effects.some((effect) => effect.is(refreshDecorations))
          ? jsonDecorations(transaction.state, read)
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
            const parsed = editorParse(source, read());
            if (parsed.ok) return [];
            const span = editorSpans(source, read())
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
      document
        .querySelectorAll(".component-property-color-popover")
        .forEach((element) => element.remove());
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
  }, [props.value, props.historyKey, props.context, props.adapter]);

  useLayoutEffect(() => {
    viewRef.current?.dispatch({ effects: refreshDecorations.of(null) });
  }, [props.context, props.adapter, props.defaultForeground]);

  useLayoutEffect(() => {
    if (props.focusRequest > 0) viewRef.current?.focus();
  }, [props.focusRequest]);

  return <div className="component-json-editor" ref={parent} />;
}

function editorParse(source: string, props: Props): PropertyCodeParseResult {
  if (props.adapter) return props.adapter.parse(source);
  return props.context
    ? parseComponentPropertyCode(source, props.context)
    : { ok: false, message: "Property editor context is unavailable" };
}

function editorSpans(source: string, props: Props): PropertyCodeSpan[] {
  return props.adapter
    ? props.adapter.spans(source)
    : propertyCodeSpans(source, props.context);
}

function editorChanges(
  source: string,
  props: Props,
  values: Readonly<Record<string, unknown>>,
) {
  if (props.adapter) return props.adapter.changes(source, values);
  return props.context
    ? propertyCodeChanges(source, props.context, values)
    : [];
}

function editorReflected(
  source: string,
  props: Props,
  direction: "left-right" | "top-bottom",
) {
  if (props.adapter?.reflected)
    return props.adapter.reflected(source, direction);
  return props.context
    ? reflectedPropertyCode(source, props.context, direction)
    : [];
}

/** Marks and widgets are visual only; the editable document remains plain JSON. */
function jsonDecorations(state: EditorState, read: () => Props): DecorationSet {
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
  const source = state.doc.toString();
  const spans = editorSpans(source, read());
  const documentValid = editorParse(source, read()).ok;
  for (const field of [
    { path: "display.visualAnnotation", label: "visual annotation" },
    { path: "display.value", label: "value" },
    { path: "appearance.inputPolarity", label: "input polarity" },
  ] as const) {
    const span = spans.find(({ field: item }) => item.path === field.path);
    if (!span) continue;
    const valueValid =
      typeof span.value === "boolean" ||
      (read().adapter?.mixedValues === true && span.value === "mixed");
    ranges.push(
      Decoration.widget({
        widget: new DisplayToggleWidget(
          field.path,
          field.label,
          typeof span.value === "boolean" ? span.value : "mixed",
          !valueValid || !documentValid,
          read,
        ),
        side: 1,
      }).range(span.to),
    );
  }
  const internalMark = spans.find(
    ({ field }) => field.path === "appearance.internalMark",
  );
  if (internalMark) {
    const valueValid =
      typeof internalMark.value === "string" &&
      internalMark.value.trim().length > 0 &&
      internalMark.value.length <= 64;
    ranges.push(
      Decoration.widget({
        widget: new InternalMarkWidget(
          typeof internalMark.value === "string"
            ? internalMark.value
            : NO_INTERNAL_MARK,
          !valueValid || !documentValid,
          read,
        ),
        side: 1,
      }).range(internalMark.to),
    );
  }
  const rotation = spans.find(
    ({ field }) => field.path === "placement.rotation",
  );
  if (rotation) {
    const valueValid = ROTATION_OPTIONS.some(
      ({ value }) => value === rotation.value,
    );
    ranges.push(
      Decoration.widget({
        widget: new PlacementActionWidget(
          "placement.rotation",
          "rotation",
          rotation.value,
          !valueValid || !documentValid,
          read,
        ),
        side: 1,
      }).range(rotation.to),
    );
  }
  const mirror = spans.find(({ field }) => field.path === "placement.mirror");
  if (mirror) {
    const valueValid = MIRROR_OPTIONS.some(
      ({ value }) => value === mirror.value,
    );
    for (const [action, side] of [
      ["mirror-left-right", 1],
      ["mirror-top-bottom", 2],
    ] as const)
      ranges.push(
        Decoration.widget({
          widget: new PlacementActionWidget(
            "placement.mirror",
            action,
            mirror.value,
            !valueValid || !documentValid,
            read,
          ),
          side,
        }).range(mirror.to),
      );
  }
  const foreground = spans.find(
    ({ field }) => field.path === "appearance.foreground",
  );
  if (foreground) {
    let color = read().defaultForeground;
    let inherited = false;
    let mixed = false;
    let colorValid = true;
    try {
      if (foreground.value === "mixed" && read().adapter?.mixedValues) {
        mixed = true;
      } else {
        const parsed = parseCanvasColor(
          foreground.value,
          "appearance.foreground",
        );
        inherited = parsed === "auto";
        color = inherited ? read().defaultForeground : parsed;
      }
    } catch {
      colorValid = false;
    }
    ranges.push(
      Decoration.widget({
        widget: new ForegroundColorWidget(
          color,
          inherited,
          mixed,
          !colorValid || !documentValid,
          read,
        ),
        side: 1,
      }).range(foreground.to),
    );
  }
  for (const span of spans) {
    const at = source[span.to] === "," ? span.to + 1 : span.to;
    if (span.field.description)
      ranges.push(
        Decoration.widget({
          widget: new PropertyUnit(span.field.description),
          side: 2,
        }).range(at),
      );
    if (span.field.path === "netlistTarget" && span.field.kind === "choice")
      ranges.push(
        Decoration.widget({
          widget: new NetlistTargetSelect(span, documentValid, read),
          side: 1,
        }).range(at),
      );
  }
  return Decoration.set(ranges, true);
}

class PropertyUnit extends WidgetType {
  constructor(private readonly unit: string) {
    super();
  }

  override eq(other: PropertyUnit): boolean {
    return this.unit === other.unit;
  }

  toDOM(): HTMLElement {
    const unit = document.createElement("span");
    unit.className = "cm-property-unit";
    unit.contentEditable = "false";
    unit.textContent = ` // ${this.unit}`;
    return unit;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class NetlistTargetSelect extends WidgetType {
  constructor(
    private readonly span: PropertyCodeSpan,
    private readonly enabled: boolean,
    private readonly read: () => Props,
  ) {
    super();
  }

  override eq(other: NetlistTargetSelect): boolean {
    return (
      JSON.stringify(this.span.field.options) ===
        JSON.stringify(other.span.field.options) &&
      this.span.value === other.span.value &&
      this.enabled === other.enabled
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const select = document.createElement("select");
    select.className = "cm-netlist-target-select";
    select.contentEditable = "false";
    select.setAttribute("aria-label", "Target netlist options");
    select.disabled = !this.enabled;
    const options = this.span.field.options ?? [];
    for (const option of options) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    }
    if (
      typeof this.span.value === "string" &&
      !options.some((option) => option.value === this.span.value)
    ) {
      const authored = document.createElement("option");
      authored.value = this.span.value;
      authored.textContent = this.span.value;
      select.append(authored);
    }
    select.value = String(this.span.value);
    select.addEventListener("change", () => {
      const changes = editorChanges(view.state.doc.toString(), this.read(), {
        netlistTarget: select.value,
      });
      if (changes.length)
        view.dispatch({ changes, userEvent: "input.property-control" });
    });
    return select;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class DisplayToggleWidget extends WidgetType {
  constructor(
    private readonly path:
      "display.visualAnnotation" | "display.value" | "appearance.inputPolarity",
    private readonly label: "visual annotation" | "value" | "input polarity",
    private readonly checked: boolean | "mixed",
    private readonly disabled: boolean,
    private readonly read: () => Props,
  ) {
    super();
  }

  override eq(other: DisplayToggleWidget): boolean {
    return (
      other.path === this.path &&
      other.checked === this.checked &&
      other.disabled === this.disabled
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const toggle = document.createElement("span");
    toggle.className = "cm-property-inline-toggle";
    toggle.contentEditable = "false";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute(
      "aria-label",
      this.path === "appearance.inputPolarity"
        ? "Toggle input polarity marks"
        : `Toggle ${this.label} visibility`,
    );
    toggle.setAttribute(
      "aria-checked",
      String(this.checked === "mixed" ? false : this.checked),
    );
    toggle.dataset.mixed = String(this.checked === "mixed");
    toggle.setAttribute("aria-disabled", String(this.disabled));
    toggle.tabIndex = this.disabled ? -1 : 0;
    toggle.title = this.disabled
      ? `Fix the property JSON before changing ${
          this.path === "appearance.inputPolarity"
            ? "input polarity marks"
            : "visibility"
        }`
      : `${
          this.path === "appearance.inputPolarity"
            ? "Input polarity marks"
            : this.label === "visual annotation"
              ? "Visual annotation"
              : "Value"
        } · ${
          this.checked === "mixed" ? "Mixed" : this.checked ? "Shown" : "Hidden"
        }`;
    const apply = (): void => {
      if (this.disabled) return;
      const source = view.state.doc.toString();
      const current = editorSpans(source, this.read()).find(
        ({ field }) => field.path === this.path,
      );
      if (
        !current ||
        (typeof current.value !== "boolean" && current.value !== "mixed")
      )
        return;
      const changes = editorChanges(source, this.read(), {
        [this.path]: current.value === true ? false : true,
      });
      if (changes.length !== 1) return;
      view.dispatch({ changes, userEvent: "input.property-toggle" });
    };
    toggle.addEventListener("click", apply);
    toggle.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        apply();
      }
    });
    return toggle;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class InternalMarkWidget extends WidgetType {
  constructor(
    private readonly value: string,
    private readonly disabled: boolean,
    private readonly read: () => Props,
  ) {
    super();
  }

  override eq(other: InternalMarkWidget): boolean {
    return other.value === this.value && other.disabled === this.disabled;
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("span");
    const empty = this.value === NO_INTERNAL_MARK;
    button.className = "cm-property-inline-placement cm-property-inline-mark";
    button.contentEditable = "false";
    button.dataset.empty = String(empty);
    button.setAttribute("role", "button");
    button.setAttribute(
      "aria-label",
      empty ? "Use A internal mark" : "Remove internal mark",
    );
    button.setAttribute("aria-disabled", String(this.disabled));
    button.tabIndex = this.disabled ? -1 : 0;
    button.textContent = empty ? "A" : "×";
    button.title = this.disabled
      ? "Fix the property JSON before changing the internal mark"
      : empty
        ? "Internal mark · Use A"
        : `Internal mark · ${this.value} · Remove`;
    const apply = (): void => {
      if (this.disabled) return;
      const source = view.state.doc.toString();
      const current = editorSpans(source, this.read()).find(
        ({ field }) => field.path === "appearance.internalMark",
      );
      if (!current || typeof current.value !== "string") return;
      const changes = editorChanges(source, this.read(), {
        "appearance.internalMark":
          current.value === NO_INTERNAL_MARK ? "A" : NO_INTERNAL_MARK,
      });
      if (changes.length !== 1) return;
      view.dispatch({ changes, userEvent: "input.property-internal-mark" });
    };
    button.addEventListener("click", apply);
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        apply();
      }
    });
    return button;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class PlacementActionWidget extends WidgetType {
  constructor(
    private readonly path: "placement.rotation" | "placement.mirror",
    private readonly action:
      "rotation" | "mirror-left-right" | "mirror-top-bottom",
    private readonly value: unknown,
    private readonly disabled: boolean,
    private readonly read: () => Props,
  ) {
    super();
  }

  override eq(other: PlacementActionWidget): boolean {
    return (
      other.path === this.path &&
      other.action === this.action &&
      other.value === this.value &&
      other.disabled === this.disabled
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("span");
    button.className = "cm-property-inline-placement";
    button.contentEditable = "false";
    button.dataset.action = this.action;
    button.setAttribute("role", "button");
    button.setAttribute(
      "aria-label",
      this.action === "rotation"
        ? "Rotate clockwise"
        : this.action === "mirror-left-right"
          ? "Mirror left to right"
          : "Mirror top to bottom",
    );
    button.setAttribute("aria-disabled", String(this.disabled));
    button.tabIndex = this.disabled ? -1 : 0;
    button.title = this.disabled
      ? "Fix the property JSON before changing placement"
      : this.action === "rotation"
        ? `Rotate clockwise · ${String(this.value)}°`
        : this.action === "mirror-left-right"
          ? "Mirror left/right · Shift+R"
          : "Mirror top/bottom · Ctrl+R";
    if (this.action !== "rotation")
      button.append(
        mirrorActionIcon(this.action === "mirror-top-bottom" ? 90 : 0),
      );
    const apply = (): void => {
      if (this.disabled) return;
      const source = view.state.doc.toString();
      const current = editorSpans(source, this.read()).find(
        ({ field }) => field.path === this.path,
      );
      if (!current) return;
      if (this.action === "rotation") {
        const index = ROTATION_OPTIONS.findIndex(
          ({ value }) => value === current.value,
        );
        if (index < 0) return;
        const next =
          ROTATION_OPTIONS[(index + 1) % ROTATION_OPTIONS.length]!.value;
        const changes = editorChanges(source, this.read(), {
          [this.path]: next,
        });
        if (changes.length !== 1) return;
        view.dispatch({ changes, userEvent: "input.property-placement" });
      } else {
        const changes = editorReflected(
          source,
          this.read(),
          this.action === "mirror-left-right" ? "left-right" : "top-bottom",
        );
        if (changes.length !== 1) return;
        view.dispatch({ changes, userEvent: "input.property-placement" });
      }
    };
    button.addEventListener("click", apply);
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        apply();
      }
    });
    return button;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** One canonical double arrow; the vertical control is the same geometry rotated. */
function mirrorActionIcon(rotation: 0 | 90): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.classList.add("cm-property-inline-mirror-icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const group = document.createElementNS(namespace, "g");
  if (rotation) group.setAttribute("transform", "rotate(90 8 8)");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute(
    "d",
    "M 2.5 8 H 13.5 M 5.5 5 L 2.5 8 L 5.5 11 M 10.5 5 L 13.5 8 L 10.5 11",
  );
  group.append(path);
  svg.append(group);
  return svg;
}

class ForegroundColorWidget extends WidgetType {
  constructor(
    private readonly color: string,
    private readonly inherited: boolean,
    private readonly mixed: boolean,
    private readonly disabled: boolean,
    private readonly read: () => Props,
  ) {
    super();
  }

  override eq(other: ForegroundColorWidget): boolean {
    return (
      other.color === this.color &&
      other.inherited === this.inherited &&
      other.mixed === this.mixed &&
      other.disabled === this.disabled
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("span");
    button.className = "cm-property-inline-color";
    button.contentEditable = "false";
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", "Edit line color");
    button.setAttribute("aria-disabled", String(this.disabled));
    button.tabIndex = this.disabled ? -1 : 0;
    button.title = this.disabled
      ? "Fix the property JSON before changing line color"
      : this.mixed
        ? "Line color · Mixed"
        : this.inherited
          ? `Line color · Auto (${this.color})`
          : `Line color · ${this.color}`;
    button.dataset.inherited = this.inherited ? "true" : "false";
    button.dataset.mixed = this.mixed ? "true" : "false";
    button.style.setProperty("--component-inline-color", this.color);
    button.addEventListener("click", () => {
      if (!this.disabled) showForegroundColorPopover(view, this.read, button);
    });
    button.addEventListener("keydown", (event) => {
      if (!this.disabled && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        showForegroundColorPopover(view, this.read, button);
      }
    });
    return button;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function showForegroundColorPopover(
  view: EditorView,
  read: () => Props,
  anchor: HTMLElement,
): void {
  document
    .querySelectorAll(".component-property-color-popover")
    .forEach((element) => element.remove());

  const span = editorSpans(view.state.doc.toString(), read()).find(
    ({ field }) => field.path === "appearance.foreground",
  );
  if (!span) return;

  let parsed: "auto" | `#${string}`;
  const mixed = span.value === "mixed" && read().adapter?.mixedValues === true;
  try {
    parsed = mixed
      ? "auto"
      : parseCanvasColor(span.value, "appearance.foreground");
  } catch {
    return;
  }
  const inherited = parsed === "auto";
  const effective = inherited ? read().defaultForeground : parsed;
  const channels = colorToRgb(effective);
  const popover = document.createElement("div");
  popover.className = "component-property-color-popover";
  popover.setAttribute("popover", "auto");
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Line color settings");
  popover.style.setProperty("--component-inline-color", effective);

  const close = (): void => {
    if (popover.matches(":popover-open")) popover.hidePopover();
    else popover.remove();
  };
  const apply = (value: [number, number, number]): void => {
    const changes = editorChanges(view.state.doc.toString(), read(), {
      "appearance.foreground": value,
    });
    if (changes.length !== 1) return;
    view.dispatch({ changes, userEvent: "input.property-color" });
  };

  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = "Line color";
  const current = document.createElement("span");
  current.textContent = mixed
    ? "Mixed"
    : inherited
      ? `Auto · ${effective}`
      : effective;
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "component-property-color-popover-close";
  closeButton.setAttribute("aria-label", "Close line color settings");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", close);
  header.append(title, current, closeButton);

  const presets = document.createElement("div");
  presets.className = "component-property-color-popover-presets";
  presets.setAttribute("aria-label", "Line presets");
  for (const preset of LINE_COLOR_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "component-property-color-popover-swatch";
    button.setAttribute("aria-label", `Use ${preset.label} for line`);
    button.setAttribute(
      "aria-pressed",
      String(!mixed && !inherited && effective.toLowerCase() === preset.value),
    );
    button.title = `${preset.label} · ${preset.value}`;
    button.style.setProperty("--component-swatch-color", preset.value);
    const fill = document.createElement("span");
    fill.setAttribute("aria-hidden", "true");
    button.append(fill);
    button.addEventListener("click", () => {
      apply(colorToRgb(preset.value));
      close();
    });
    presets.append(button);
  }

  const custom = document.createElement("div");
  custom.className = "component-property-color-popover-custom";
  const rgb = document.createElement("div");
  rgb.className = "component-property-color-popover-rgb";
  rgb.setAttribute("aria-label", "Line custom RGB");
  const label = document.createElement("label");
  label.textContent = "RGB";
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.value = `[${channels.join(",")}]`;
  input.placeholder = "[220,38,38]";
  input.setAttribute("aria-label", "Line RGB");
  input.addEventListener("input", () => {
    const next = parseRgbTuple(input.value);
    input.setAttribute("aria-invalid", String(next === null));
    if (!next) return;
    channels.splice(0, channels.length, ...next);
    apply(next);
  });
  input.addEventListener("change", () => {
    input.value = `[${channels.join(",")}]`;
    input.setAttribute("aria-invalid", "false");
  });
  label.append(input);
  rgb.append(label);
  custom.append(rgb);
  popover.append(header, presets, custom);
  popover.addEventListener("toggle", () => {
    if (!popover.matches(":popover-open")) popover.remove();
  });
  document.body.append(popover);
  popover.style.visibility = "hidden";
  popover.showPopover();
  const anchorRect = anchor.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const gap = 6;
  const left = Math.min(
    window.innerWidth - popoverRect.width - 8,
    Math.max(8, anchorRect.right - popoverRect.width),
  );
  const below = anchorRect.bottom + gap;
  const top =
    below + popoverRect.height <= window.innerHeight - 8
      ? below
      : Math.max(8, anchorRect.top - popoverRect.height - gap);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.visibility = "visible";
}

function parseRgbTuple(source: string): [number, number, number] | null {
  let normalized = source.trim().replace(/^rgb\s*=\s*/iu, "");
  if (normalized.startsWith("[") !== normalized.endsWith("]")) return null;
  if (normalized.startsWith("[")) normalized = normalized.slice(1, -1);
  const parts = normalized.split(",");
  if (parts.length !== 3 || parts.some((value) => value.trim() === ""))
    return null;
  const values = parts.map((value) => Number(value.trim()));
  if (
    values.length !== 3 ||
    values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  )
    return null;
  return values as [number, number, number];
}
