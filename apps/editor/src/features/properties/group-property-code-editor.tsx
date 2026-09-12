import {
  lazy,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  formatGroupPropertyCode,
  groupPropertyCodeChanges,
  groupPropertyCodeSpans,
  parseGroupPropertyCode,
  serializeGroupPropertyCode,
  type GroupPropertyCodeContext,
  type GroupPropertyCodeValue,
} from "./group-property-code";
import type { PropertyJsonEditorAdapter } from "./component-property-json-editor";

const PropertyJsonEditor = lazy(
  () => import("./component-property-json-editor"),
);

export interface GroupPropertyCodeEditorProps {
  count: number;
  revision: number;
  context: GroupPropertyCodeContext;
  defaultForeground: string;
  onApply(
    value: GroupPropertyCodeValue,
  ): { ok: true } | { ok: false; message: string };
}

/** One honest batch surface: only fields shared by every selected component. */
export function GroupPropertyCodeEditor({
  count,
  revision,
  context,
  defaultForeground,
  onApply,
}: GroupPropertyCodeEditorProps) {
  const baseline = useMemo(
    () => formatGroupPropertyCode(context),
    [context, revision],
  );
  const previousBaseline = useRef(baseline);
  const appliedCode = useRef<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [draft, setDraft] = useState(baseline);
  const [message, setMessage] = useState<string | null>(null);
  const adapter = useMemo<PropertyJsonEditorAdapter>(
    () => ({
      parse: (source) => parseGroupPropertyCode(source, context),
      spans: groupPropertyCodeSpans,
      changes: (source, values) =>
        groupPropertyCodeChanges(source, context, values),
      mixedValues: true,
    }),
    [context],
  );

  useLayoutEffect(() => {
    const ownEdit = appliedCode.current;
    appliedCode.current = null;
    if (previousBaseline.current === baseline && ownEdit === null) return;
    previousBaseline.current = baseline;
    if (ownEdit !== baseline) setDraft(baseline);
    if (ownEdit === null) setHistoryKey((key) => key + 1);
    setMessage(null);
  }, [baseline]);

  const parsed = useMemo(
    () => parseGroupPropertyCode(draft, context),
    [context, draft],
  );
  const status =
    message ??
    (parsed.ok ? null : `${parsed.message} · Canvas keeps the last valid edit`);

  const change = (source: string): void => {
    setDraft(source);
    setMessage(null);
    const next = parseGroupPropertyCode(source, context);
    if (!next.ok) return;
    const normalized = serializeGroupPropertyCode(next.value);
    if (normalized === baseline) return;
    const result = onApply(next.value);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    appliedCode.current = normalized;
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(draft);
      setMessage("JSON copied");
    } catch {
      setMessage("Clipboard unavailable; select the code and copy it");
    }
  };

  return (
    <section
      className="component-property-code-editor group-property-code-editor"
      aria-label="Batch component properties"
      data-testid="group-property-code-editor"
    >
      <header>
        <strong>Properties</strong>
        <div className="component-property-header-actions">
          <span className="group-property-scope">{count} selected</span>
          {!parsed.ok ? (
            <button
              type="button"
              className="component-property-copy"
              aria-label="Discard draft"
              title="Discard invalid draft"
              onClick={() => {
                setDraft(baseline);
                setMessage(null);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
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
            aria-label="Loading batch property code"
            value={draft}
            readOnly
            rows={8}
          />
        }
      >
        <PropertyJsonEditor
          value={draft}
          historyKey={historyKey}
          adapter={adapter}
          defaultForeground={defaultForeground}
          focusRequest={0}
          onChange={change}
        />
      </Suspense>
      <small className="group-property-hint">
        “mixed” means the selected components currently use different values.
      </small>
      {status ? (
        <div className="component-property-code-status" aria-live="polite">
          <span>{status}</span>
        </div>
      ) : null}
    </section>
  );
}
