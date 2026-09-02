import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { BugReportLink } from "./bug-report-link";
import {
  browserStaleBuildRecovery,
  isStaleBuildFailure,
  isTemporaryModuleLoadFailure,
  recoverFromStaleBuild,
} from "./stale-build-recovery";

export interface EditorErrorBoundaryProps {
  children: ReactNode;
}

interface EditorErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort boundary around the whole editor: an exception thrown during
 * rendering shows a recovery screen instead of an unmounted blank page. The
 * screen keeps the user actionable — reload the editor, knowing that recent
 * committed work is kept in the browser recovery copies — while the error is
 * logged for diagnosis.
 */
export class EditorErrorBoundary extends Component<
  EditorErrorBoundaryProps,
  EditorErrorBoundaryState
> {
  override state: EditorErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): EditorErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      "Editor crashed during rendering:",
      error,
      info.componentStack,
    );
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      const staleBuild = isStaleBuildFailure(this.state.error);
      const moduleLoadFailure = isTemporaryModuleLoadFailure(this.state.error);
      return (
        <EditorCrashScreen
          message={this.state.error.message}
          staleBuild={staleBuild}
          moduleLoadFailure={moduleLoadFailure}
          onReload={() => window.location.reload()}
          onRecover={() =>
            void recoverFromStaleBuild(browserStaleBuildRecovery())
          }
        />
      );
    }
    return this.props.children;
  }
}

export interface EditorCrashScreenProps {
  message: string;
  onReload(): void;
  /**
   * The failure is a chunk this build can no longer fetch, so an ordinary
   * reload can hand back the same document and fail again. Reported in #493.
   */
  staleBuild?: boolean;
  /** The named module was not missing, so do not mislabel it as an update. */
  moduleLoadFailure?: boolean;
  onRecover?(): void;
}

export function EditorCrashScreen({
  message,
  onReload,
  staleBuild = false,
  moduleLoadFailure = false,
  onRecover,
}: EditorCrashScreenProps) {
  const kind = staleBuild ? "stale" : moduleLoadFailure ? "load" : "crash";
  return (
    <div
      className="editor-crash-screen"
      data-testid="editor-crash-screen"
      role="alert"
      aria-labelledby="editor-crash-title"
    >
      <div className="editor-crash-panel" data-kind={kind}>
        <h1 id="editor-crash-title">
          {staleBuild
            ? "This page is running an old version of the editor"
            : moduleLoadFailure
              ? "The editor could not finish loading"
              : "The editor hit an unexpected problem"}
        </h1>
        <p>
          {staleBuild
            ? "The app was updated after this page opened, so part of it can no longer load. Reloading with a clean copy fixes it. Your recent committed work is kept in this browser's recovery copies."
            : moduleLoadFailure
              ? "A required application file was temporarily unavailable. Try again; if the problem continues, reload with a clean copy. Your browser recovery copies are safe."
              : "Rendering stopped with an internal error. Your recent committed work is kept in this browser's recovery copies."}
        </p>
        <p>
          <code>{message}</code>
        </p>
        <div className="editor-crash-actions">
          {staleBuild && onRecover ? (
            <button
              type="button"
              data-testid="crash-reload-clean"
              onClick={onRecover}
            >
              Reload with a clean copy
            </button>
          ) : null}
          <button type="button" onClick={onReload}>
            {moduleLoadFailure ? "Try again" : "Reload editor"}
          </button>
          {moduleLoadFailure && onRecover ? (
            <button
              type="button"
              data-testid="crash-reload-clean"
              onClick={onRecover}
            >
              Reload with a clean copy
            </button>
          ) : null}
          <BugReportLink
            testId="crash-report-bug"
            surface="Unexpected problem screen"
          />
        </div>
        <p className="editor-crash-note">
          After reloading, use File / Recover Local Work… if your latest changes
          are missing.
        </p>
      </div>
    </div>
  );
}
