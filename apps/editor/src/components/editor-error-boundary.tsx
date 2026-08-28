import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { BugReportLink } from "./bug-report-link";

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
      return (
        <EditorCrashScreen
          message={this.state.error.message}
          onReload={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}

export interface EditorCrashScreenProps {
  message: string;
  onReload(): void;
}

export function EditorCrashScreen({
  message,
  onReload,
}: EditorCrashScreenProps) {
  return (
    <div
      className="editor-crash-screen"
      data-testid="editor-crash-screen"
      role="alert"
      aria-labelledby="editor-crash-title"
    >
      <div className="editor-crash-panel">
        <h1 id="editor-crash-title">The editor hit an unexpected problem</h1>
        <p>
          Rendering stopped with an internal error. Your recent committed work
          is kept in this browser's recovery copies.
        </p>
        <p>
          <code>{message}</code>
        </p>
        <div className="editor-crash-actions">
          <button type="button" onClick={onReload}>
            Reload editor
          </button>
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
