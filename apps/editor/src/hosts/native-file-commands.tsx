import { useEffect } from "react";
import type { FileCommandMenuProps } from "../features/editor-shell/file-command-menu";

export function NativeFileCommands(
  nativeFiles: NonNullable<FileCommandMenuProps["nativeFiles"]>,
) {
  useEffect(() => {
    document.title = `${nativeFiles.projectName} — ${nativeFiles.path ?? "Not saved to a file"} — Analog Canvas`;
  }, [nativeFiles.projectName, nativeFiles.path]);
  return (
    <>
      <button
        type="button"
        disabled={nativeFiles.busy}
        onClick={() => nativeFiles.open()}
      >
        Open Project…
      </button>
      <button
        type="button"
        disabled={nativeFiles.busy}
        onClick={nativeFiles.saveAs}
      >
        Save As…
      </button>
      <span
        className="command-group-label"
        data-testid="native-file-location"
        title={nativeFiles.path ?? undefined}
        style={{ overflowWrap: "anywhere", whiteSpace: "normal" }}
      >
        {nativeFiles.path ?? "Not saved to a file"}
      </span>
      <span className="command-group-label">Recent Projects</span>
      <div className="cloud-project-list" aria-label="Recent Projects">
        {nativeFiles.recent.map((file) => (
          <div className="cloud-project-command" key={file.id}>
            <button
              type="button"
              title={file.path}
              disabled={nativeFiles.busy}
              onClick={() => nativeFiles.open(file.id)}
            >
              {file.name}
              <small
                style={{
                  display: "block",
                  overflowWrap: "anywhere",
                  whiteSpace: "normal",
                }}
              >
                {file.path}
              </small>
            </button>
            <button
              type="button"
              title="Remove from recent list; keep the file"
              aria-label={`Remove recent ${file.name}`}
              disabled={nativeFiles.busy}
              onClick={() => nativeFiles.forget(file.id)}
            >
              ×
            </button>
          </div>
        ))}
        {!nativeFiles.recent.length ? (
          <span>No recent Projects. Open a file or save a new Project.</span>
        ) : null}
      </div>
    </>
  );
}
