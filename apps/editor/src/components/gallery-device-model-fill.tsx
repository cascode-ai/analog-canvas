import { useEffect, useRef, useState } from "react";
import {
  fillGalleryDeviceModels,
  type GalleryDeviceModelReport,
} from "../gallery-device-models";
import {
  createNetlistExportProfile,
  NETLIST_PROFILE_LABELS,
} from "../features/netlist-export/netlist-process-presets";

/**
 * Give the library the models its circuits were drawn without.
 *
 * A circuit drawn before the editor bound devices to a process prints a TODO
 * field for every device model. This runs the editor's own fill over every
 * published circuit, writing only what is missing, and reports what it wrote.
 * It is a curator's action on other people's work, so it says plainly how many
 * circuits it changed and which ones it could not.
 */
export function GalleryDeviceModelFill({
  onFilled,
}: {
  onFilled: (filled: number) => void;
}) {
  const [report, setReport] = useState<GalleryDeviceModelReport | null>(null);
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const start = () => {
    if (running) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setReport(null);
    setRunning(true);
    void fillGalleryDeviceModels(
      createNetlistExportProfile("sky130"),
      (progress) => {
        if (!next.signal.aborted) setReport(progress);
      },
      fetch,
      next.signal,
    )
      .then((final) => {
        if (next.signal.aborted) return;
        setReport(final);
        if (final.filled > 0) onFilled(final.filled);
      })
      .finally(() => {
        if (!next.signal.aborted) setRunning(false);
      });
  };
  const label = `Fill missing ${NETLIST_PROFILE_LABELS.sky130} models`;
  return (
    <>
      <button
        type="button"
        className="gallery-tag-option"
        data-testid="gallery-fill-device-models"
        disabled={running}
        title="Write the process's model and dimensions into every published circuit whose devices have none, leaving authored values alone"
        onClick={start}
      >
        {running ? "Filling…" : label}
      </button>
      {report ? (
        <span role="status">
          {running
            ? `Filling ${report.scanned}${report.total == null ? "" : ` / ${report.total}`} circuits…`
            : `${report.filled} ${report.filled === 1 ? "circuit" : "circuits"} filled · ${report.instances} ${report.instances === 1 ? "device" : "devices"}${report.failures.length ? ` · ${report.failures.length} could not be written` : ""}`}
        </span>
      ) : null}
      {!running && report?.error ? (
        <p role="alert">{report.error} Results are incomplete.</p>
      ) : null}
      {!running && report?.failures.length ? (
        <p role="status">
          Not written:{" "}
          {report.failures
            .slice(0, 5)
            .map((failure) => `${failure.name} (${failure.message})`)
            .join("; ")}
          {report.failures.length > 5 ? ", …" : ""}
        </p>
      ) : null}
    </>
  );
}
