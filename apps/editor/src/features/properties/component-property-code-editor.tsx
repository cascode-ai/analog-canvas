import {
  lazy,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
  const appliedCode = useRef<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [draft, setDraft] = useState(baseline);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  useLayoutEffect(() => {
    const ownEdit = appliedCode.current;
    appliedCode.current = null;
    if (previousBaseline.current === baseline && ownEdit === null) return;
    previousBaseline.current = baseline;
    // Preserve the user's whitespace, caret and local undo history on a live
    // acknowledgement. Only planner normalization or an external edit replaces
    // text; external undo/redo must never be replayed back into the model.
    if (ownEdit !== baseline) setDraft(baseline);
    if (ownEdit === null) setHistoryKey((key) => key + 1);
    setApplyMessage(null);
    setRejected(false);
  }, [baseline, draft]);

  const parsed = useMemo(
    () => parseComponentPropertyCode(draft, context),
    [context, draft],
  );

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(draft);
      setApplyMessage("JSON copied");
    } catch {
      setApplyMessage("Clipboard unavailable; select the code and copy it");
    }
  };

  const change = (source: string): void => {
    setDraft(source);
    setApplyMessage(null);
    setRejected(false);
    const next = parseComponentPropertyCode(source, context);
    if (!next.ok) return;
    const normalized = serializeComponentPropertyCode(next.value);
    if (normalized === baseline) return;
    const result = onApply(next.value);
    if (!result.ok) {
      setApplyMessage(result.message);
      setRejected(true);
      return;
    }
    appliedCode.current = normalized;
  };

  return (
    <section
      className="component-property-code-editor"
      aria-label="Canvas property code"
      data-testid="component-property-code-editor"
    >
      <header>
        <strong>Properties</strong>
        <div className="component-property-header-actions">
          <button
            type="button"
            className="component-property-copy"
            aria-label="Defaults"
            title="Restore parameter and color defaults"
            onClick={() => change(defaultComponentPropertyCode(context))}
          >
            <span aria-hidden="true">↺</span>
          </button>
          {(!parsed.ok || rejected) && (
            <button
              type="button"
              className="component-property-copy"
              aria-label="Discard draft"
              title="Discard invalid draft"
              onClick={() => {
                setDraft(baseline);
                setApplyMessage(null);
                setRejected(false);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
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
        </div>
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
          historyKey={historyKey}
          context={context}
          defaultForeground={defaultForeground}
          focusRequest={focusRequest}
          baselineCode={baseline}
          onApply={() => change(draft)}
          onChange={change}
        />
      </Suspense>
      <div className="component-property-code-status" aria-live="polite">
        <span>
          {applyMessage ??
            (parsed.ok
              ? "Live"
              : `${parsed.message} · Canvas keeps the last valid edit`)}
        </span>
      </div>
    </section>
  );
}
