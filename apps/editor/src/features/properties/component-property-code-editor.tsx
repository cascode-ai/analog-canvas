import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import type { SchematicDocument } from "@icm/model";

import {
  formatComponentPropertyCode,
  parseComponentPropertyCode,
  serializeComponentPropertyCode,
  defaultComponentPropertyCode,
  type ComponentPropertyCodeContext,
  type ComponentPropertyCodeValue,
} from "./component-property-code";

type Instance = SchematicDocument["instances"][number];
const PropertyJsonEditor = lazy(
  () => import("./component-property-json-editor"),
);

export interface ComponentPropertyCodeEditorProps {
  instance: Instance;
  revision: number;
  referenceVisible: boolean | null;
  valueVisible: boolean | null;
  defaultForeground?: string;
  details?: ComponentPropertyCodeContext["details"];
  focusRequest?: number;
  onApply: (
    value: ComponentPropertyCodeValue,
  ) => { ok: true } | { ok: false; message: string };
}

/** Compact editable JSON for placement, display, and appearance. */
export function ComponentPropertyCodeEditor({
  instance,
  revision,
  referenceVisible,
  valueVisible,
  defaultForeground = "#000000",
  details,
  focusRequest = 0,
  onApply,
}: ComponentPropertyCodeEditorProps) {
  const context = useMemo<ComponentPropertyCodeContext>(
    () => ({
      instance,
      referenceVisible,
      valueVisible,
      ...(details ? { details } : {}),
    }),
    [instance, referenceVisible, valueVisible, details],
  );
  const baseline = useMemo(
    () => formatComponentPropertyCode(context),
    [context, revision],
  );
  const previousBaseline = useRef(baseline);
  const [draft, setDraft] = useState(baseline);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  useEffect(() => {
    // Capture before enqueueing: React may run the updater after the ref has
    // advanced. Reading the ref inside it leaves normalized target edits stale.
    const previous = previousBaseline.current;
    previousBaseline.current = baseline;
    setDraft((current) => (current === previous ? baseline : current));
  }, [baseline]);

  const parsed = useMemo(
    () => parseComponentPropertyCode(draft, context),
    [context, draft],
  );
  const changed = draft !== baseline;

  const apply = (): void => {
    if (!parsed.ok) {
      setApplyMessage(parsed.message);
      return;
    }
    const result = onApply(parsed.value);
    if (!result.ok) {
      setApplyMessage(result.message);
      return;
    }
    const normalized = serializeComponentPropertyCode(parsed.value);
    previousBaseline.current = normalized;
    setDraft(normalized);
    setApplyMessage("Applied");
  };

  return (
    <section
      className="component-property-code-editor"
      aria-label="Canvas property code"
      data-testid="component-property-code-editor"
    >
      <header>
        <div>
          <strong>Component properties</strong>
          <span>{instance.reference ?? instance.id}</span>
        </div>
        <code>{instance.symbolId}</code>
      </header>
      <Suspense
        fallback={
          <textarea
            aria-label="Loading Canvas property code"
            value={draft}
            readOnly
            rows={15}
          />
        }
      >
        <PropertyJsonEditor
          value={draft}
          historyKey={baseline}
          context={context}
          defaultForeground={defaultForeground}
          focusRequest={focusRequest}
          onChange={(source) => {
            setDraft(source);
            setApplyMessage(null);
          }}
          onApply={apply}
        />
      </Suspense>
      <div className="component-property-code-status" aria-live="polite">
        <span>
          {parsed.ok
            ? (applyMessage ??
              (changed
                ? "Changes pending · Apply or Ctrl/⌘ + Enter"
                : "JSON · hints and controls are not saved"))
            : parsed.message}
        </span>
        <div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(draft).then(
                () =>
                  setApplyMessage("JSON copied · hints and controls excluded"),
                () =>
                  setApplyMessage(
                    "Clipboard unavailable; select the code and copy it",
                  ),
              );
            }}
          >
            Copy JSON
          </button>
          <button
            type="button"
            title="Reset parameter and appearance defaults in the draft; keep position, identity, target, display flags, and unknown overrides. Apply to commit."
            onClick={() => {
              setDraft(defaultComponentPropertyCode(context));
              setApplyMessage("Defaults loaded into draft · Apply to commit");
            }}
          >
            Defaults
          </button>
          <button
            type="button"
            disabled={!changed}
            onClick={() => {
              setDraft(baseline);
              setApplyMessage(null);
            }}
          >
            Discard draft
          </button>
          <button
            type="button"
            disabled={!changed || !parsed.ok}
            onClick={apply}
          >
            Apply code
          </button>
        </div>
      </div>
    </section>
  );
}
