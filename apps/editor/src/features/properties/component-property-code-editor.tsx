import { useEffect, useMemo, useRef, useState } from "react";

import type { SchematicDocument } from "@icm/model";

import {
  formatComponentPropertyCode,
  parseComponentPropertyCode,
  serializeComponentPropertyCode,
  type ComponentPropertyCodeContext,
  type ComponentPropertyCodeValue,
} from "./component-property-code";

type Instance = SchematicDocument["instances"][number];

export interface ComponentPropertyCodeEditorProps {
  instance: Instance;
  revision: number;
  referenceVisible: boolean | null;
  valueVisible: boolean | null;
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
  onApply,
}: ComponentPropertyCodeEditorProps) {
  const context = useMemo<ComponentPropertyCodeContext>(
    () => ({ instance, referenceVisible, valueVisible }),
    [instance, referenceVisible, valueVisible],
  );
  const baseline = useMemo(
    () => formatComponentPropertyCode(context),
    [context, revision],
  );
  const previousBaseline = useRef(baseline);
  const [draft, setDraft] = useState(baseline);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft((current) =>
      current === previousBaseline.current ? baseline : current,
    );
    previousBaseline.current = baseline;
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
          <strong>Canvas properties</strong>
          <span>{instance.reference ?? instance.id}</span>
        </div>
        <code>{instance.symbolId}</code>
      </header>
      <textarea
        aria-label="Editable Canvas property code"
        value={draft}
        rows={15}
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setApplyMessage(null);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            apply();
          }
        }}
      />
      <div className="component-property-code-status" aria-live="polite">
        <span>
          {parsed.ok
            ? (applyMessage ?? "JSON · Ctrl/⌘ + Enter to apply")
            : parsed.message}
        </span>
        <div>
          <button
            type="button"
            disabled={!changed}
            onClick={() => {
              setDraft(baseline);
              setApplyMessage(null);
            }}
          >
            Revert
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
