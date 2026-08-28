import { useMemo, useState } from "react";

import { resolveDocumentLogicalNets } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import {
  simulateDigitalDocument,
  type DigitalSimulationResult,
} from "@icm/simulation";

import { parseSimulationTimePs, timingWaveformSvg } from "./timing-waveform";

export interface TimingSimulationPanelProps {
  document: SchematicDocument;
  defaultOpen?: boolean;
  onPlaceOnCanvas: (result: DigitalSimulationResult) => void;
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
  return value.trim().replace(/[^A-Za-z0-9._-]+/gu, "-") || "timing";
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
  defaultOpen = false,
  onPlaceOnCanvas,
  onStatus,
}: TimingSimulationPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [stopTime, setStopTime] = useState("40ns");
  const [savedNetIds, setSavedNetIds] = useState<Set<string>>(() => new Set());
  const [result, setResult] = useState<DigitalSimulationResult | null>(null);
  const logicalNets = useMemo(
    () => resolveDocumentLogicalNets(document).groups,
    [document],
  );
  const waveformSvg = result ? timingWaveformSvg(result) : null;
  const stale =
    result !== null && result.documentRevision !== document.revision;

  const toggleSavedNet = (netId: string): void => {
    setSavedNetIds((current) => {
      const next = new Set(current);
      if (next.has(netId)) next.delete(netId);
      else next.add(netId);
      return next;
    });
  };
  const run = (): void => {
    const stopTimePs = parseSimulationTimePs(stopTime);
    if (!stopTimePs) {
      onStatus(
        "Simulation stop time must include a supported unit, for example 40ns",
      );
      return;
    }
    if (savedNetIds.size === 0) {
      onStatus("Save at least one Net before running the timing simulation");
      return;
    }
    const next = simulateDigitalDocument({
      document,
      profile: { stopTimePs, savedNetIds: [...savedNetIds] },
    });
    setResult(next);
    onStatus(
      next.completed
        ? `Digital simulation completed with ${next.traces.length} saved Net${next.traces.length === 1 ? "" : "s"}`
        : "Digital simulation stopped with errors; inspect the waveform panel diagnostics",
    );
  };
  const fileStem = `${safeFileStem(document.name)}-timing`;

  return (
    <section
      className={open ? "timing-panel" : "timing-panel collapsed"}
      aria-label="Digital timing simulation"
      data-testid="timing-simulation-panel"
    >
      <header className="timing-panel-header">
        <button
          type="button"
          className="timing-panel-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> Timing
        </button>
        {result ? (
          <span
            className={stale ? "timing-run-state stale" : "timing-run-state"}
          >
            {stale
              ? "Circuit changed · run again"
              : result.completed
                ? "Complete"
                : "Errors"}
          </span>
        ) : (
          <span className="timing-run-state">Temporary results</span>
        )}
        {open ? (
          <div className="timing-panel-actions">
            <details className="timing-node-picker">
              <summary>Saved nodes ({savedNetIds.size})</summary>
              <div className="timing-node-picker-menu">
                <div className="timing-node-picker-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setSavedNetIds(
                        new Set(logicalNets.map((net) => net.baseNetIds[0]!)),
                      )
                    }
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSavedNetIds(new Set())}
                  >
                    Clear
                  </button>
                </div>
                {logicalNets.length === 0 ? (
                  <p>No Nets in this Cell.</p>
                ) : (
                  logicalNets.map((net) => {
                    const baseNetId = net.baseNetIds[0]!;
                    return (
                      <label key={net.id}>
                        <input
                          type="checkbox"
                          checked={savedNetIds.has(baseNetId)}
                          onChange={() => toggleSavedNet(baseNetId)}
                        />
                        <span>{net.name ?? net.id}</span>
                        <code>{baseNetId}</code>
                      </label>
                    );
                  })
                )}
              </div>
            </details>
            <label className="timing-stop-time">
              Stop
              <input
                value={stopTime}
                aria-label="Simulation stop time"
                onChange={(event) => setStopTime(event.currentTarget.value)}
              />
            </label>
            <button type="button" className="primary" onClick={run}>
              Run
            </button>
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
              onClick={() => result && onPlaceOnCanvas(result)}
            >
              Place on Canvas
            </button>
          </div>
        ) : null}
      </header>
      {open ? (
        <div className="timing-panel-body">
          {waveformSvg ? (
            <div
              className="timing-waveform-preview"
              data-testid="timing-waveform-preview"
              dangerouslySetInnerHTML={{ __html: waveformSvg }}
            />
          ) : (
            <div className="timing-panel-empty">
              Save the Nets you want to observe, then run the digital
              simulation.
            </div>
          )}
          {result && result.diagnostics.length > 0 ? (
            <details className="timing-diagnostics">
              <summary>{result.diagnostics.length} diagnostics</summary>
              <ul>
                {result.diagnostics.map((diagnostic, index) => (
                  <li key={`${diagnostic.code}-${index}`}>
                    <strong>{diagnostic.code}</strong> {diagnostic.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
