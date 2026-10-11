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
  currentControlPair,
  type CurrentControlOption,
} from "./current-control-options";
import { itemPropertyCode } from "./item-property-code";
import {
  createComponentPropertyCodeAdapter,
  dependentControlPropertyValues,
} from "./component-property-code-assists";

import {
  formatComponentPropertyCode,
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
  displayName?: string | null;
  itemName?: string;
  revision: number;
  referenceVisible: boolean | null;
  valueVisible: boolean | null;
  parameterVisibility?: Record<string, boolean>;
  connection?: "cell-pin" | "global" | null;
  netName?: string | null;
  defaultForeground?: string;
  details?: ComponentPropertyCodeContext["details"];
  supplyTerminals?: ComponentPropertyCodeContext["supplyTerminals"];
  controlPick?: {
    step: "positive" | "negative" | "current-positive" | "current-negative";
  } | null;
  controlSummary?: string;
  currentTerminalOptions?: readonly CurrentControlOption[];
  controlNetOptions?: ComponentPropertyCodeContext["controlNetOptions"];
  controlDeviceOptions?: ComponentPropertyCodeContext["controlDeviceOptions"];
  controlTerminalOptions?: ComponentPropertyCodeContext["controlTerminalOptions"];
  onStartControlPick?: () => void;
  onCancelControlPick?: () => void;
  onPreviewControlNet?: (netId: string | null) => void;
  onApply: (
    value: ComponentPropertyCodeValue,
  ) => { ok: true } | { ok: false; message: string };
}

/** Compact editable JSON for placement, display, and appearance. */
export function ComponentPropertyCodeEditor({
  instance,
  displayName,
  itemName,
  revision,
  referenceVisible,
  valueVisible,
  parameterVisibility,
  connection,
  netName,
  defaultForeground = "#000000",
  details,
  supplyTerminals,
  controlPick,
  controlSummary,
  currentTerminalOptions,
  controlNetOptions,
  controlDeviceOptions,
  controlTerminalOptions,
  onStartControlPick,
  onCancelControlPick,
  onPreviewControlNet,
  onApply,
}: ComponentPropertyCodeEditorProps) {
  const context = useMemo<ComponentPropertyCodeContext>(
    () => ({
      instance,
      ...(displayName !== undefined ? { displayName } : {}),
      referenceVisible,
      valueVisible,
      ...(parameterVisibility ? { parameterVisibility } : {}),
      ...(connection !== undefined ? { connection } : {}),
      ...(netName !== undefined ? { netName } : {}),
      ...(details ? { details } : {}),
      ...(supplyTerminals ? { supplyTerminals } : {}),
      ...(controlNetOptions ? { controlNetOptions } : {}),
      ...(controlDeviceOptions ? { controlDeviceOptions } : {}),
      ...(controlTerminalOptions ? { controlTerminalOptions } : {}),
    }),
    [
      instance,
      displayName,
      referenceVisible,
      valueVisible,
      parameterVisibility,
      connection,
      netName,
      details,
      supplyTerminals,
      controlNetOptions,
      controlDeviceOptions,
      controlTerminalOptions,
    ],
  );
  const nativeBaseline = useMemo(
    () => formatComponentPropertyCode(context),
    [context, revision],
  );
  const projection = useMemo(() => {
    const value = JSON.parse(nativeBaseline);
    const namePath =
      "displayName" in value
        ? "displayName"
        : "netName" in value
          ? "netName"
          : "netlistName" in value
            ? "netlistName"
            : undefined;
    return itemPropertyCode(nativeBaseline, {
      type: instance.symbolId,
      name: itemName ?? instance.reference ?? instance.id,
      ...(namePath ? { namePath } : {}),
    });
  }, [
    nativeBaseline,
    instance.symbolId,
    instance.reference,
    instance.id,
    itemName,
  ]);
  const baseline = projection.format(nativeBaseline);
  const nativeAdapter = useMemo(
    () => createComponentPropertyCodeAdapter(context),
    [context],
  );
  const adapter = useMemo(() => {
    const projected = projection.adapter(nativeAdapter);
    return {
      ...projected,
      changes: (source: string, values: Readonly<Record<string, unknown>>) =>
        projected.changes(source, dependentControlPropertyValues(values)),
    };
  }, [projection, nativeAdapter]);
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
    () => projection.parse(draft, nativeAdapter.parse),
    [nativeAdapter, draft, projection],
  );
  const statusMessage =
    applyMessage ??
    (parsed.ok ? null : `${parsed.message} · Canvas keeps the last valid edit`);

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
    const next = projection.parse(source, nativeAdapter.parse);
    if (!next.ok) return;
    const normalized = projection.format(
      serializeComponentPropertyCode(next.value),
    );
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
            className="component-property-help"
            aria-label="Defaults"
            title="Restore parameter and color defaults"
            onClick={() =>
              change(projection.format(defaultComponentPropertyCode(context)))
            }
          >
            Defaults
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
          adapter={adapter}
          value={draft}
          historyKey={historyKey}
          context={context}
          defaultForeground={defaultForeground}
          onChange={change}
          {...(onPreviewControlNet ? { onPreviewControlNet } : {})}
          {...(onStartControlPick
            ? {
                controlAction: {
                  active: Boolean(controlPick),
                  compact:
                    instance.symbolId === "cccs" ||
                    instance.symbolId === "ccvs",
                  ...(currentTerminalOptions &&
                  parsed.ok &&
                  parsed.value.control &&
                  "instanceId" in parsed.value.control
                    ? {
                        terminals: {
                          ...currentControlPair(
                            currentTerminalOptions,
                            parsed.value.control,
                          ),
                          options: currentTerminalOptions,
                          onChange: (value: string) => {
                            const option = currentTerminalOptions.find(
                              (item) => item.value === value,
                            );
                            if (value && !option) return;
                            onCancelControlPick?.();
                            change(
                              projection.format(
                                serializeComponentPropertyCode({
                                  ...parsed.value,
                                  control: {
                                    instanceId: option?.instanceId ?? "",
                                    pinName: option?.pinName ?? "",
                                    direction: "into",
                                  },
                                }),
                              ),
                            );
                          },
                        },
                      }
                    : {}),
                  ...(instance.netlist?.control?.kind === "terminal-current" ||
                  instance.netlist?.control?.kind === "current"
                    ? {
                        onReverse: () => {
                          if (
                            parsed.ok &&
                            parsed.value.control &&
                            "direction" in parsed.value.control
                          )
                            change(
                              projection.format(
                                serializeComponentPropertyCode({
                                  ...parsed.value,
                                  control: {
                                    ...parsed.value.control,
                                    direction:
                                      parsed.value.control.direction === "into"
                                        ? "out"
                                        : "into",
                                  },
                                }),
                              ),
                            );
                        },
                      }
                    : {}),
                  message:
                    controlPick?.step === "positive"
                      ? "Click control + Net"
                      : controlPick?.step === "negative"
                        ? "Click control − Net; the pick then finishes"
                        : controlPick?.step === "current-positive"
                          ? "Pick control + terminal"
                          : controlPick?.step === "current-negative"
                            ? "Pick highlighted − terminal"
                            : (controlSummary ?? "Control not selected"),
                  onClick: () =>
                    controlPick
                      ? onCancelControlPick?.()
                      : onStartControlPick(),
                },
              }
            : {})}
        />
      </Suspense>
      {statusMessage ? (
        <div className="component-property-code-status" aria-live="polite">
          <span>{statusMessage}</span>
        </div>
      ) : null}
    </section>
  );
}
