/**
 * The Owner's accounts' sidebar action (#1545): queue every public circuit
 * with a testbench for the server to run again on the hosted simulator, and
 * how the checks stand. The server runs them one at a time.
 */
import { useEffect, useState } from "react";
import {
  gallerySimulationCheckSummary,
  loadGallerySimulationChecks,
  queueGallerySimulationChecks,
  type GallerySimulationCheckProgress,
} from "../gallery-simulation-checks";

export function GallerySimulationChecks() {
  const [progress, setProgress] =
    useState<GallerySimulationCheckProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const waiting = progress?.waiting ?? 0;
  useEffect(() => {
    let cancelled = false;
    const read = () =>
      void loadGallerySimulationChecks(fetch).then((next) => {
        if (!cancelled && next) setProgress(next);
      });
    read();
    // While checks wait, the server's pass moves them on every few minutes.
    const timer = waiting > 0 ? window.setInterval(read, 60_000) : undefined;
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [waiting]);
  async function verifyAll(): Promise<void> {
    setBusy(true);
    setFailure(null);
    if (!(await queueGallerySimulationChecks(fetch, { all: true })))
      setFailure("Could not queue the simulation checks. Try again.");
    const next = await loadGallerySimulationChecks(fetch);
    if (next) setProgress(next);
    setBusy(false);
  }
  return (
    <section
      className="gallery-duplicates gallery-simulation-checks"
      data-testid="gallery-simulation-checks"
    >
      <div className="gallery-duplicates-actions">
        <button
          type="button"
          className="gallery-tag-option"
          disabled={busy}
          data-testid="gallery-verify-simulations"
          title="Run every public circuit's testbench again on the hosted simulator, one at a time"
          onClick={() => void verifyAll()}
        >
          {busy ? "Queueing…" : "Verify simulations"}
        </button>
        <span role="status">
          {progress ? gallerySimulationCheckSummary(progress) : null}
        </span>
      </div>
      {failure ? <p role="alert">{failure}</p> : null}
    </section>
  );
}
