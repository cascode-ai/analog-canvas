import {
  lazy,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PortLabelFormatOptions, SchematicDocument } from "@icm/model";
import type { PropertyJsonEditorAdapter } from "../properties/component-property-json-editor";

import {
  defaultDocumentSettingsCode,
  formatDocumentSettingsCode,
  parseDocumentSettingsCode,
  serializeDocumentSettingsCode,
  type CanvasPreferenceCodeValue,
  type DocumentSettingsCodeValue,
} from "./document-settings-code";
import {
  documentSettingsCodeChanges,
  documentSettingsCodeSpans,
} from "./document-settings-code-assists";

const PropertyJsonEditor = lazy(
  () => import("../properties/component-property-json-editor"),
);

export interface DocumentSettingsSectionProps {
  document: SchematicDocument;
  canvas: CanvasPreferenceCodeValue;
  portLabels: PortLabelFormatOptions;
  portLabelCount: number;
  onApply(
    value: DocumentSettingsCodeValue,
  ): { ok: true } | { ok: false; message: string };
  onFormatPortLabels(options: PortLabelFormatOptions): void;
}

/** One plain JSON surface for every Document-wide and editor preference. */
export function DocumentSettingsSection({
  document,
  canvas,
  portLabels,
  portLabelCount,
  onApply,
  onFormatPortLabels,
}: DocumentSettingsSectionProps) {
  const baseline = useMemo(
    () => formatDocumentSettingsCode(document, canvas, portLabels),
    [canvas, document, portLabels],
  );
  const previousBaseline = useRef(baseline);
  const appliedCode = useRef<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [draft, setDraft] = useState(baseline);
  const [message, setMessage] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const adapter = useMemo<PropertyJsonEditorAdapter>(
    () => ({
      parse: (source) => parseDocumentSettingsCode(source, document),
      spans: (source) => documentSettingsCodeSpans(source, document),
      changes: (source, values) =>
        documentSettingsCodeChanges(source, document, values),
    }),
    [document],
  );

  useLayoutEffect(() => {
    const ownEdit = appliedCode.current;
    appliedCode.current = null;
    if (previousBaseline.current === baseline && ownEdit === null) return;
    previousBaseline.current = baseline;
    if (ownEdit !== baseline) setDraft(baseline);
    if (ownEdit === null) setHistoryKey((key) => key + 1);
    setMessage(null);
    setRejected(false);
  }, [baseline]);

  const parsed = useMemo(
    () => parseDocumentSettingsCode(draft, document),
    [document, draft],
  );
  const status =
    message ??
    (parsed.ok ? null : `${parsed.message} · Canvas keeps the last valid edit`);

  function change(source: string): void {
    setDraft(source);
    setMessage(null);
    setRejected(false);
    const next = parseDocumentSettingsCode(source, document);
    if (!next.ok) return;
    const normalized = serializeDocumentSettingsCode(next.value);
    if (normalized === baseline) return;
    const result = onApply(next.value);
    if (!result.ok) {
      setMessage(result.message);
      setRejected(true);
      return;
    }
    appliedCode.current = normalized;
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(draft);
      setMessage("Properties JSON copied");
    } catch {
      setMessage("Clipboard unavailable; select the code and copy it");
    }
  }

  return (
    <section
      className="component-property-code-editor document-settings-code-editor"
      aria-label="Document settings"
      data-testid="document-settings-code-editor"
    >
      <header>
        <strong>Properties code</strong>
        <div className="component-property-header-actions">
          <button
            type="button"
            className="component-property-help"
            onClick={() =>
              change(defaultDocumentSettingsCode(document, canvas, portLabels))
            }
          >
            Defaults
          </button>
          {(!parsed.ok || rejected) && (
            <button
              type="button"
              className="component-property-copy"
              aria-label="Discard Properties draft"
              title="Discard invalid Properties draft"
              onClick={() => {
                setDraft(baseline);
                setMessage(null);
                setRejected(false);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
          <button
            type="button"
            className="component-property-copy"
            aria-label="Copy Properties JSON"
            title="Copy Properties JSON"
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
            aria-label="Loading Properties code"
            value={draft}
            readOnly
            rows={20}
          />
        }
      >
        <PropertyJsonEditor
          value={draft}
          historyKey={historyKey}
          adapter={adapter}
          defaultForeground="#000000"
          ariaLabel="Editable Properties code"
          onChange={change}
        />
      </Suspense>
      {status ? (
        <div className="component-property-code-status" aria-live="polite">
          <span>{status}</span>
        </div>
      ) : null}
      <div className="document-settings-port-action">
        <button
          type="button"
          disabled={portLabelCount === 0}
          onClick={() => onFormatPortLabels(portLabels)}
        >
          Format all Port labels in this Cell
        </button>
        <small>
          Uses <code>portLabels</code> above for {portLabelCount} existing label
          {portLabelCount === 1 ? "" : "s"}. Names and electrical connections do
          not change.
        </small>
      </div>
    </section>
  );
}
