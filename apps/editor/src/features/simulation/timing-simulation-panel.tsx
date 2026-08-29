import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { resolveDocumentLogicalNets } from "@icm/derived";
import { flattenRichText } from "@icm/model";
import type { RichTextDocument, SchematicDocument } from "@icm/model";
import {
  digitalSimulationInputFingerprint,
  simulateDigitalDocument,
  type DigitalSimulationResult,
} from "@icm/simulation";

import { RichTextEditor } from "../text-editing/rich-text-editor";
import {
  createTimingWaveformDiagram,
  defaultWaveformLabelDocument,
  layoutTimingWaveformDiagram,
  parseSimulationTimePs,
  timingWaveformSvg,
  type TimingWaveformLayout,
} from "./timing-waveform";

export interface TimingSimulationPanelProps {
  document: SchematicDocument;
  open: boolean;
  savedNetIds: ReadonlySet<string>;
  pickNetsActive: boolean;
  onOpenChange: (open: boolean) => void;
  onPickNetsChange: (active: boolean) => void;
  onToggleSavedNet: (netId: string) => void;
  onSetSavedNets: (netIds: readonly string[]) => void;
  onPlaceOnCanvas: (layout: TimingWaveformLayout) => void;
  onStatus: (message: string) => void;
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileStem(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/gu, "-") || "simulation";
}

function exportPng(svg: string, fileName: string): void {
  const source = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(source);
  const image = new Image();
  image.onload = () => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = image.naturalWidth * 2;
    canvas.height = image.naturalHeight * 2;
    const context = canvas.getContext("2d");
    if (!context) {
      URL.revokeObjectURL(url);
      return;
    }
    context.scale(2, 2);
    context.drawImage(image, 0, 0);
    canvas.toBlob((blob) => {
      URL.revokeObjectURL(url);
      if (blob) download(blob, fileName);
    }, "image/png");
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
}

export function TimingSimulationPanel({
  document,
  open,
  savedNetIds,
  pickNetsActive,
  onOpenChange,
  onPickNetsChange,
  onToggleSavedNet,
  onSetSavedNets,
  onPlaceOnCanvas,
  onStatus,
}: TimingSimulationPanelProps) {
  const [stopTime, setStopTime] = useState("40ns");
  const [result, setResult] = useState<DigitalSimulationResult | null>(null);
  const [netAliases, setNetAliases] = useState<
    Record<string, RichTextDocument>
  >({});
  const [labelEditor, setLabelEditor] = useState<{
    baseNetId: string;
    netName: string;
    draft: RichTextDocument;
  } | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const drag = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const logicalNets = useMemo(
    () => resolveDocumentLogicalNets(document).groups,
    [document],
  );
  useEffect(() => {
    setNetAliases((current) => {
      const retained = Object.fromEntries(
        Object.entries(current).filter(([baseNetId]) =>
          savedNetIds.has(baseNetId),
        ),
      );
      return Object.keys(retained).length === Object.keys(current).length
        ? current
        : retained;
    });
  }, [savedNetIds]);
  useEffect(() => {
    if (labelEditor && !savedNetIds.has(labelEditor.baseNetId)) {
      setLabelEditor(null);
    }
  }, [labelEditor, savedNetIds]);
  const waveformDiagram = useMemo(
    () => (result ? createTimingWaveformDiagram(result, netAliases) : null),
    [netAliases, result],
  );
  const waveformLayout = useMemo(
    () =>
      waveformDiagram
        ? layoutTimingWaveformDiagram(waveformDiagram, document.presentation)
        : null,
    [document.presentation, waveformDiagram],
  );
  const waveformSvg = waveformLayout
    ? timingWaveformSvg(waveformLayout, document.presentation)
    : null;
  const stale =
    result !== null &&
    result.inputFingerprint !== digitalSimulationInputFingerprint(document);

  const run = (): void => {
    const stopTimePs = parseSimulationTimePs(stopTime);
    if (!stopTimePs) {
      onStatus(
        "Simulation stop time must include a supported unit, for example 40ns",
      );
      return;
    }
    if (savedNetIds.size === 0) {
      onStatus("Save at least one Net before running Digital Simulation");
      return;
    }
    const next = simulateDigitalDocument({
      document,
      profile: { stopTimePs, savedNetIds: [...savedNetIds] },
    });
    setResult(next);
    onStatus(
      next.completed
        ? `Digital Simulation completed with ${next.traces.length} saved Net${next.traces.length === 1 ? "" : "s"}`
        : "Digital Simulation stopped with errors; inspect the diagnostics",
    );
  };
  const fileStem = `${safeFileStem(document.name)}-digital-timing`;
  const close = (): void => {
    onPickNetsChange(false);
    onOpenChange(false);
  };
  const beginWindowDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button"))
    ) {
      return;
    }
    const windowElement = event.currentTarget.parentElement;
    if (!windowElement) return;
    const bounds = windowElement.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const moveWindow = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const left = Math.max(
      8,
      Math.min(
        globalThis.innerWidth - 280,
        event.clientX - drag.current.offsetX,
      ),
    );
    const top = Math.max(
      64,
      Math.min(
        globalThis.innerHeight - 120,
        event.clientY - drag.current.offsetY,
      ),
    );
    setPosition({ left, top });
  };
  const endWindowDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (!open) return null;

  return (
    <section
      className="digital-simulation-window"
      aria-label="Digital Simulation"
      aria-modal={false}
      role="dialog"
      data-testid="timing-simulation-panel"
      style={position ?? undefined}
    >
      <header
        className="digital-simulation-header"
        onPointerDown={beginWindowDrag}
        onPointerMove={moveWindow}
        onPointerUp={endWindowDrag}
        onPointerCancel={endWindowDrag}
      >
        <strong>Digital Simulation</strong>
        <span
          className={
            stale ? "simulation-run-state stale" : "simulation-run-state"
          }
        >
          {result
            ? stale
              ? "Circuit changed · run again"
              : result.completed
                ? "Complete"
                : "Errors"
            : "Temporary results"}
        </span>
        <button
          type="button"
          aria-label="Close Digital Simulation"
          onClick={close}
        >
          ×
        </button>
      </header>

      <div className="digital-simulation-controls">
        <label className="simulation-stop-time">
          Stop
          <input
            value={stopTime}
            aria-label="Simulation stop time"
            onChange={(event) => setStopTime(event.currentTarget.value)}
          />
        </label>
        <select
          aria-label="Add saved Net"
          value=""
          onChange={(event) => {
            const netId = event.currentTarget.value;
            if (netId) onToggleSavedNet(netId);
          }}
        >
          <option value="">Add Net…</option>
          {logicalNets
            .filter((net) => !savedNetIds.has(net.baseNetIds[0]!))
            .map((net) => (
              <option key={net.id} value={net.baseNetIds[0]!}>
                {net.name ?? net.id}
              </option>
            ))}
        </select>
        <button
          type="button"
          aria-pressed={pickNetsActive}
          className={pickNetsActive ? "active" : undefined}
          onClick={() => onPickNetsChange(!pickNetsActive)}
        >
          {pickNetsActive ? "Picking Nets…" : "Pick Nets"}
        </button>
        <button
          type="button"
          onClick={() =>
            onSetSavedNets(logicalNets.map((net) => net.baseNetIds[0]!))
          }
        >
          All
        </button>
        <button type="button" onClick={() => onSetSavedNets([])}>
          Clear
        </button>
        <button type="button" className="primary" onClick={run}>
          Run Simulation
        </button>
      </div>

      <div className="digital-simulation-workspace">
        {labelEditor ? (
          <section
            className="simulation-waveform-label-editor"
            aria-label={`Edit waveform name for ${labelEditor.netName}`}
          >
            <header>
              <div>
                <strong>Waveform name</strong>
                <small>Display only · Net {labelEditor.netName}</small>
              </div>
              <button
                type="button"
                aria-label="Close waveform name editor"
                onClick={() => setLabelEditor(null)}
              >
                ×
              </button>
            </header>
            <RichTextEditor
              targetKey={`waveform-${labelEditor.baseNetId}`}
              content={labelEditor.draft}
              sizeScale={1}
              alignment="start"
              multiline={false}
              compact
              deleteLabel="Reset"
              onChange={(draft) =>
                setLabelEditor((current) =>
                  current ? { ...current, draft } : current,
                )
              }
              onSizeChange={() => undefined}
              onAlignmentChange={() => undefined}
              onCommit={() => {
                const { baseNetId, draft } = labelEditor;
                setNetAliases((current) => {
                  const next = { ...current };
                  if (flattenRichText(draft).trim()) next[baseNetId] = draft;
                  else delete next[baseNetId];
                  return next;
                });
                setLabelEditor(null);
              }}
              onDelete={() => {
                const { baseNetId } = labelEditor;
                setNetAliases((current) => {
                  const next = { ...current };
                  delete next[baseNetId];
                  return next;
                });
                setLabelEditor(null);
              }}
            />
          </section>
        ) : null}
        <aside className="simulation-saved-nets" aria-label="Saved Nets">
          <div className="simulation-saved-nets-heading">
            <span>Saved Nets</span>
            <small>Names below only affect waveform labels.</small>
          </div>
          <div className="simulation-saved-net-list" role="list">
            {savedNetIds.size === 0 ? (
              <small className="simulation-saved-nets-empty">None</small>
            ) : null}
            {[...savedNetIds].map((baseNetId) => {
              const net = logicalNets.find((candidate) =>
                candidate.baseNetIds.includes(baseNetId),
              );
              const netName = net?.name ?? baseNetId;
              const waveformName =
                netAliases[baseNetId] ?? defaultWaveformLabelDocument(netName);
              return (
                <div
                  className="simulation-saved-net"
                  key={baseNetId}
                  role="listitem"
                >
                  <div className="simulation-saved-net-header">
                    <span
                      className="simulation-saved-net-source"
                      title={netName}
                    >
                      <small>Net</small>
                      <strong>{netName}</strong>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove saved Net ${netName}`}
                      title={`Remove ${netName}`}
                      onClick={() => onToggleSavedNet(baseNetId)}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    className="simulation-waveform-name"
                    aria-label={`Edit waveform name for ${netName}`}
                    title={`Edit waveform display name for Net ${netName}`}
                    onClick={() =>
                      setLabelEditor({
                        baseNetId,
                        netName,
                        draft: waveformName,
                      })
                    }
                  >
                    <small>Waveform name</small>
                    <span>{flattenRichText(waveformName)}</span>
                    <span aria-hidden="true">✎</span>
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <div className="digital-simulation-body">
          {waveformSvg ? (
            <div
              className="timing-waveform-preview"
              data-testid="timing-waveform-preview"
              dangerouslySetInnerHTML={{ __html: waveformSvg }}
            />
          ) : (
            <div className="simulation-empty">
              Pick the Nets to observe, then run the simulation.
            </div>
          )}
          {result && result.diagnostics.length > 0 ? (
            <ul
              className="simulation-diagnostics"
              aria-label="Simulation diagnostics"
            >
              {result.diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${index}`}>
                  <strong>{diagnostic.code}</strong> {diagnostic.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <footer className="digital-simulation-footer">
        <button
          type="button"
          disabled={!waveformSvg}
          onClick={() =>
            waveformSvg &&
            download(
              new Blob([waveformSvg], {
                type: "image/svg+xml;charset=utf-8",
              }),
              `${fileStem}.svg`,
            )
          }
        >
          Export SVG
        </button>
        <button
          type="button"
          disabled={!waveformSvg}
          onClick={() =>
            waveformSvg && exportPng(waveformSvg, `${fileStem}.png`)
          }
        >
          Export PNG
        </button>
        <button
          type="button"
          disabled={!result || result.traces.length === 0 || stale}
          onClick={() => waveformLayout && onPlaceOnCanvas(waveformLayout)}
        >
          Place on Canvas
        </button>
      </footer>
    </section>
  );
}
