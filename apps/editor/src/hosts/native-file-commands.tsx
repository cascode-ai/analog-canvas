import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FileCommandMenuProps } from "../features/editor-shell/file-command-menu";
import { NativeLibraryDialog } from "./native-library-dialog";
import { nativePathLabel } from "./native-path-label";

export function NativeFileCommands(
  nativeFiles: NonNullable<FileCommandMenuProps["nativeFiles"]>,
) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [copy, setCopy] = useState<{
    name: string;
    intoLibrary: boolean;
  } | null>(null);
  const saveDialog = useRef<HTMLDialogElement>(null);
  const copyOpen = copy !== null;
  useEffect(() => {
    if (copyOpen) saveDialog.current?.showModal();
  }, [copyOpen]);
  useEffect(() => {
    document.title = `${nativeFiles.projectName} — Analog Canvas`;
  }, [nativeFiles.projectName]);
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
        onClick={() =>
          setCopy({ name: nativeFiles.projectName, intoLibrary: true })
        }
      >
        Save As…
      </button>
      {copy
        ? createPortal(
            <dialog
              ref={saveDialog}
              className="native-dialog native-save-dialog"
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              aria-label="Save independent project"
              onCancel={(event) => {
                event.preventDefault();
                setCopy(null);
              }}
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  nativeFiles.saveAs({ ...copy, name: copy.name.trim() });
                  setCopy(null);
                }}
              >
                <h2>Save independent project</h2>
                <p>
                  Your original project keeps its last saved content. The new
                  project has its own identity and history.
                </p>
                <label>
                  Project name{" "}
                  <input
                    autoFocus
                    value={copy.name}
                    maxLength={120}
                    onChange={(event) =>
                      setCopy({ ...copy, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Location{" "}
                  <select
                    value={copy.intoLibrary ? "library" : "external"}
                    onChange={(event) =>
                      setCopy({
                        ...copy,
                        intoLibrary: event.target.value === "library",
                      })
                    }
                  >
                    <option value="library">Project library</option>
                    <option value="external">Choose another file…</option>
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={!copy.name.trim() || nativeFiles.busy}
                >
                  Save copy
                </button>
                <button type="button" onClick={() => setCopy(null)}>
                  Cancel
                </button>
              </form>
            </dialog>,
            document.body,
          )
        : null}
      <span
        className="command-group-label"
        data-testid="native-file-location"
        title={nativeFiles.path ?? undefined}
        style={{
          overflowWrap: "anywhere",
          whiteSpace: "normal",
          textTransform: "none",
          letterSpacing: "normal",
        }}
      >
        {nativeFiles.path
          ? nativePathLabel(nativeFiles.path)
          : "Ctrl+S saves into your project library"}
      </span>
      <button
        type="button"
        disabled={nativeFiles.busy}
        onClick={() => setLibraryOpen(true)}
      >
        Local projects…
      </button>
      {libraryOpen ? (
        <NativeLibraryDialog
          onClose={() => setLibraryOpen(false)}
          onOpen={nativeFiles.open}
          {...(nativeFiles.newProject ? { onNew: nativeFiles.newProject } : {})}
        />
      ) : null}
      <span className="command-group-label">Recent Projects</span>
      <div className="cloud-project-list" aria-label="Recent Projects">
        {nativeFiles.recent.map((file) => (
          <div className="cloud-project-command" key={file.id}>
            <button
              type="button"
              title={file.path}
              className="cloud-project-open"
              disabled={nativeFiles.busy}
              onClick={() => nativeFiles.open(file.id)}
            >
              <span className="cloud-project-name">{file.name}</span>
              <small
                style={{
                  display: "block",
                  overflowWrap: "anywhere",
                  whiteSpace: "normal",
                }}
              >
                {nativePathLabel(file.path)}
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
