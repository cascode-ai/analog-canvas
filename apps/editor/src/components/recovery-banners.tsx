import { useLayoutEffect, useRef } from "react";
import type { RecoveryState } from "../document/recovery-coordinator";

/** The recovery states the failure banner reports. */
export type RecoveryFailureState = Extract<
  RecoveryState,
  "quota-exceeded" | "unavailable" | "failed"
>;

export interface RecoveryFailureBannerProps {
  state: RecoveryFailureState;
  onDownload(): void;
  onDismiss(): void;
}

export interface RecoveryAvailableBannerProps {
  projectName: string;
  updatedAt: string;
  onRestore(): void;
  onDownload(): void;
  onDismiss(): void;
}

/** Follow the actual toolbar, including wrapped controls and project tabs. */
function useRecoveryBannerPosition() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const chrome = document.querySelector(".app-chrome");
    if (!chrome) return;
    const update = () => {
      if (ref.current)
        ref.current.style.top = `${chrome.getBoundingClientRect().bottom + 8}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(chrome);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return ref;
}

function failureMessage(state: RecoveryFailureState): string {
  switch (state) {
    case "quota-exceeded":
      return "Browser storage for this site is full — new recovery copies cannot be saved.";
    case "unavailable":
      return "Browser storage is unavailable — recovery copies cannot be saved.";
    case "failed":
      return "The latest recovery copy could not be saved.";
  }
}

/**
 * Persistent, dismissible warning that recovery writes are failing, with a
 * direct download so the user can secure the current Project immediately.
 */
export function RecoveryFailureBanner({
  state,
  onDownload,
  onDismiss,
}: RecoveryFailureBannerProps) {
  const ref = useRecoveryBannerPosition();
  return (
    <aside
      ref={ref}
      className="recovery-banner recovery-banner-warning"
      data-testid="recovery-failure-banner"
      role="alert"
      aria-label="Recovery storage problem"
    >
      <p>
        {failureMessage(state)} Download the Project to keep your work safe.
      </p>
      <div className="recovery-banner-actions">
        <button type="button" onClick={onDownload}>
          Download Backup
        </button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss warning">
          Dismiss
        </button>
      </div>
    </aside>
  );
}

/** Non-modal startup offer for a newer, explicitly unsaved working copy. */
export function RecoveryAvailableBanner({
  projectName,
  updatedAt,
  onRestore,
  onDownload,
  onDismiss,
}: RecoveryAvailableBannerProps) {
  const ref = useRecoveryBannerPosition();
  return (
    <aside
      ref={ref}
      className="recovery-banner"
      data-testid="startup-recovery-banner"
      aria-label="Unsaved recovery available"
    >
      <p>
        Unsaved work for <strong>{projectName}</strong> was recovered from{" "}
        <time dateTime={updatedAt}>{new Date(updatedAt).toLocaleString()}</time>
        .
      </p>
      <div className="recovery-banner-actions">
        <button type="button" onClick={onRestore}>
          Restore
        </button>
        <button type="button" onClick={onDownload}>
          Download backup
        </button>
        <button type="button" onClick={onDismiss}>
          Ignore
        </button>
      </div>
    </aside>
  );
}

export interface WorkspaceReopenBannerProps {
  names: string[];
  savedAt: number;
  onReopen(): void;
  onDismiss(): void;
}

/**
 * Non-modal offer in a fresh browser tab to bring back the tabs a closed
 * editor window left (#1250). Not now leaves them stored; another fresh
 * window offers them again.
 */
export function WorkspaceReopenBanner({
  names,
  savedAt,
  onReopen,
  onDismiss,
}: WorkspaceReopenBannerProps) {
  const ref = useRecoveryBannerPosition();
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return (
    <aside
      ref={ref}
      className="recovery-banner"
      data-testid="workspace-reopen-banner"
      aria-label="Reopen tabs from your last window"
    >
      <p>
        Your last editor window had{" "}
        {names.length === 1 ? "1 tab" : `${names.length} tabs`} open:{" "}
        <strong>
          {shown}
          {more}
        </strong>
        , saved{" "}
        <time dateTime={new Date(savedAt).toISOString()}>
          {new Date(savedAt).toLocaleString()}
        </time>
        .
      </p>
      <div className="recovery-banner-actions">
        <button type="button" onClick={onReopen}>
          Reopen tabs
        </button>
        <button type="button" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </aside>
  );
}

/** Concise statusbar label derived from coordinator recovery state. */
export function recoveryStateLabel(state: RecoveryState): string | null {
  switch (state) {
    case "idle":
    case "pending":
    case "stored":
      return null;
    case "quota-exceeded":
      return "Recovery full — download now";
    case "unavailable":
      return "Recovery unavailable — download now";
    case "failed":
      return "Recovery failed — download now";
  }
}
