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

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(draft);
      setApplyMessage("JSON copied");
    } catch {
      setApplyMessage("Clipboard unavailable; select the code and copy it");
    }
  };

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
        <strong>Component properties</strong>
        <button
          type="button"
          className="component-property-copy"
          aria-label="Copy JSON"
          title="Copy JSON"
          onClick={() => void copy()}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
            <path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7" />
          </svg>
        </button>
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
          {applyMessage ??
            (parsed.ok
              ? changed
                ? "Pending · Ctrl/⌘ + Enter to apply"
                : "Unchanged"
              : parsed.message)}
        </span>
        <div>
          <button
            type="button"
            title="Load parameter and appearance defaults into draft"
            onClick={() => {
              setDraft(defaultComponentPropertyCode(context));
              setApplyMessage("Defaults loaded · pending");
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
