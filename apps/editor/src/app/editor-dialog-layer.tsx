import { Suspense, type ComponentProps } from "react";

import type { AgentFileCandidateSummary } from "@icm/agent-adapter";
import type { CellResetPlan } from "@icm/edit-engine";

import { ChunkLoadBanner } from "../components/chunk-load-fallback";
import {
  RecoveryAvailableBanner,
  RecoveryFailureBanner,
} from "../components/recovery-banners";
import {
  LazyCellManagerDialog,
  LazyNewTestbenchDialog,
  LazyConnectAgentPanel,
  LazyEditorHelpDialog,
  LazyInsertComponentDialog,
  LazyInstanceTableDialog,
  LazyNetlistPreflightDialog,
  LazyProjectSearchDialog,
  LazyPublishGalleryDialog,
  LazyRecentRecoveryDialog,
  LazyReplaceGuardDialog,
  LazyVersionHistoryDialog,
} from "./lazy-editor-dialogs";

export interface EditorDialogLayerProps {
  help: ComponentProps<typeof LazyEditorHelpDialog> | null;
  chunkLoadFailure: ComponentProps<typeof ChunkLoadBanner> | null;
  recoveryFailure: ComponentProps<typeof RecoveryFailureBanner> | null;
  recoveryAvailable: ComponentProps<typeof RecoveryAvailableBanner> | null;
  recentRecovery: ComponentProps<typeof LazyRecentRecoveryDialog> | null;
  replaceGuard: ComponentProps<typeof LazyReplaceGuardDialog> | null;
  search: ComponentProps<typeof LazyProjectSearchDialog> | null;
  instanceTable: ComponentProps<typeof LazyInstanceTableDialog> | null;
  insertComponent: ComponentProps<typeof LazyInsertComponentDialog> | null;
  cellReset: {
    documentName: string;
    pending: { plan: CellResetPlan; command: string };
    onCancel: () => void;
    onConfirm: () => void;
  } | null;
  cellManager: ComponentProps<typeof LazyCellManagerDialog> | null;
  newTestbench: ComponentProps<typeof LazyNewTestbenchDialog> | null;
  netlistPreflight: ComponentProps<typeof LazyNetlistPreflightDialog> | null;
  publishGallery: ComponentProps<typeof LazyPublishGalleryDialog> | null;
  versionHistory: ComponentProps<typeof LazyVersionHistoryDialog> | null;
  agentConnection: ComponentProps<typeof LazyConnectAgentPanel> | null;
  agentFileApproval: {
    candidate: AgentFileCandidateSummary;
    onReject: () => void;
    onApprove: () => void;
  } | null;
}

/** All modal/overlay UI kept outside the persistent editor workspace. */
export function EditorDialogLayer({
  help,
  chunkLoadFailure,
  recoveryFailure,
  recoveryAvailable,
  recentRecovery,
  replaceGuard,
  search,
  instanceTable,
  insertComponent,
  cellReset,
  cellManager,
  newTestbench,
  netlistPreflight,
  publishGallery,
  versionHistory,
  agentConnection,
  agentFileApproval,
}: EditorDialogLayerProps) {
  return (
    <>
      <Suspense fallback={null}>
        {help ? <LazyEditorHelpDialog {...help} /> : null}
        {chunkLoadFailure ? <ChunkLoadBanner {...chunkLoadFailure} /> : null}
        {recoveryFailure ? (
          <RecoveryFailureBanner {...recoveryFailure} />
        ) : null}
        {recoveryAvailable ? (
          <RecoveryAvailableBanner {...recoveryAvailable} />
        ) : null}
        {recentRecovery ? (
          <LazyRecentRecoveryDialog {...recentRecovery} />
        ) : null}
        {replaceGuard ? <LazyReplaceGuardDialog {...replaceGuard} /> : null}
        {search ? <LazyProjectSearchDialog {...search} /> : null}
        {instanceTable ? <LazyInstanceTableDialog {...instanceTable} /> : null}
        {insertComponent ? (
          <LazyInsertComponentDialog {...insertComponent} />
        ) : null}
        {cellReset ? (
          <div
            className="insert-dialog-backdrop"
            onPointerDown={(event) =>
              event.target === event.currentTarget && cellReset.onCancel()
            }
          >
            <section
              className="editor-action-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="clear-canvas-dialog-title"
              onKeyDown={(event) => {
                if (event.key === "Escape") cellReset.onCancel();
              }}
            >
              <header className="editor-action-dialog-header">
                <p>Cell contents</p>
                <h2 id="clear-canvas-dialog-title">
                  {cellReset.pending.command} in {cellReset.documentName}?
                </h2>
              </header>
              <div className="editor-action-dialog-body">
                <p>
                  {cellReset.pending.plan.summary}. Affected objects:{" "}
                  {cellReset.pending.plan.affectedObjectIds.length}. You can
                  restore them with Undo.
                </p>
              </div>
              <footer className="editor-action-dialog-actions">
                <button type="button" autoFocus onClick={cellReset.onCancel}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={cellReset.onConfirm}
                >
                  {cellReset.pending.command}
                </button>
              </footer>
            </section>
          </div>
        ) : null}
        {cellManager ? <LazyCellManagerDialog {...cellManager} /> : null}
        {newTestbench ? <LazyNewTestbenchDialog {...newTestbench} /> : null}
        {netlistPreflight ? (
          <LazyNetlistPreflightDialog {...netlistPreflight} />
        ) : null}
        {publishGallery ? (
          <LazyPublishGalleryDialog {...publishGallery} />
        ) : null}
        {versionHistory ? (
          <LazyVersionHistoryDialog {...versionHistory} />
        ) : null}
        {agentConnection ? (
          <LazyConnectAgentPanel {...agentConnection} />
        ) : null}
      </Suspense>
      {agentFileApproval ? (
        <div className="agent-panel" data-testid="agent-file-approval">
          <section
            className="agent-dialog"
            role="dialog"
            aria-label="Approve Agent file import"
          >
            <div className="agent-panel-header">
              <h2>Approve Agent file import</h2>
            </div>
            <p>
              The Agent staged a {agentFileApproval.candidate.kind} candidate.
              It has not changed this Project. Replacing it will end the current
              Agent session.
            </p>
            <dl className="agent-file-candidate-summary">
              <div>
                <dt>Project</dt>
                <dd>{agentFileApproval.candidate.projectName}</dd>
              </div>
              <div>
                <dt>Documents</dt>
                <dd>{agentFileApproval.candidate.documentCount}</dd>
              </div>
              <div>
                <dt>Instances</dt>
                <dd>{agentFileApproval.candidate.instanceCount}</dd>
              </div>
            </dl>
            {agentFileApproval.candidate.diagnostics.length > 0 ? (
              <ul className="agent-panel-audit">
                {agentFileApproval.candidate.diagnostics.map(
                  (diagnostic, index) => (
                    <li key={`${diagnostic.severity}-${index}`}>
                      <span>{diagnostic.severity}</span>
                      <span>{diagnostic.message}</span>
                    </li>
                  ),
                )}
              </ul>
            ) : null}
            <div className="agent-panel-controls">
              <button
                type="button"
                data-testid="agent-file-reject"
                onClick={agentFileApproval.onReject}
              >
                Reject
              </button>
              <button
                type="button"
                data-testid="agent-file-approve"
                onClick={agentFileApproval.onApprove}
              >
                Replace Project
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
