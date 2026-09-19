import {
  lazy,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PropertyJsonEditorAdapter } from "./component-property-json-editor";
import type { PropertyResult } from "./annotation-property-code";
import {
  itemPropertyCode,
  type ItemPropertyIdentity,
} from "./item-property-code";

const PropertyJsonEditor = lazy(
  () => import("./component-property-json-editor"),
);

/** A valid JSON edit commits once; incomplete drafts never mutate the canvas. */
export function AnnotationPropertyCodeEditor<T>({
  baseline: nativeBaseline,
  adapter: nativeAdapter,
  parse: parseNative,
  format: formatNative,
  item,
  onApply,
  defaultColor,
  actions,
  title,
}: {
  baseline: string;
  item: ItemPropertyIdentity;
  adapter: PropertyJsonEditorAdapter;
  parse(source: string): PropertyResult<T>;
  format(value: T): string;
  onApply(value: T): { ok: boolean; message?: string };
  defaultColor: string;
  actions?: ReactNode;
  title: string;
}) {
  const projection = useMemo(
    () => itemPropertyCode(nativeBaseline, item),
    [nativeBaseline, item],
  );
  const baseline = projection.format(nativeBaseline);
  const adapter = useMemo(
    () => projection.adapter(nativeAdapter),
    [projection, nativeAdapter],
  );
  const parse = (source: string) => projection.parse(source, parseNative);
  const format = (value: T) => projection.format(formatNative(value));
  const previous = useRef(baseline);
  const applied = useRef<string | null>(null);
  const [draft, setDraft] = useState(baseline);
  const [historyKey, setHistoryKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  useLayoutEffect(() => {
    const ownEdit = applied.current;
    applied.current = null;
    if (previous.current === baseline && ownEdit === null) return;
    previous.current = baseline;
    if (ownEdit !== baseline) setDraft(baseline);
    if (ownEdit === null) setHistoryKey((key) => key + 1);
    setMessage(null);
    setRejected(false);
  }, [baseline, draft]);
  const parsed = parse(draft);
  const change = (source: string) => {
    setDraft(source);
    setMessage(null);
    setRejected(false);
    const next = parse(source);
    if (!next.ok) return;
    const canonical = format(next.value);
    if (canonical === baseline) return;
    const result = onApply(next.value);
    if (!result.ok) {
      setMessage(result.message ?? "Property edit was rejected");
      setRejected(true);
      return;
    }
    applied.current =
      JSON.stringify(JSON.parse(source)) ===
      JSON.stringify(JSON.parse(canonical))
        ? canonical
        : source;
  };
  return (
    <section
      className="component-property-code-editor"
      aria-label="Annotation property code"
    >
      <header>
        <strong>{title}</strong>
        <div className="component-property-header-actions">
          {(!parsed.ok || rejected) && (
            <button
              type="button"
              aria-label="Discard draft"
              onClick={() => {
                setDraft(baseline);
                setMessage(null);
                setRejected(false);
              }}
            >
              ×
            </button>
          )}
          <button
            type="button"
            className="component-property-copy"
            aria-label="Copy JSON"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(draft);
                setMessage("JSON copied");
              } catch {
                setMessage(
                  "Clipboard unavailable; select the code and copy it",
                );
              }
            }}
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
          adapter={adapter}
          defaultForeground={defaultColor}
          onChange={change}
        />
      </Suspense>
      {actions}
      {(message || !parsed.ok) && (
        <div className="component-property-code-status" aria-live="polite">
          {message ??
            (!parsed.ok
              ? `${parsed.message} · Canvas keeps the last valid edit`
              : null)}
        </div>
      )}
    </section>
  );
}
