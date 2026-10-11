import "./native-dialog.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseProject } from "@icm/project-protocol";
import { VersionHistoryComparison } from "../components/version-history-comparison";
import {
  libraryCommand,
  type LibraryProject,
  type ProjectHistoryListing,
  type ProjectLibraryListing,
} from "./native-project-library";
import "../components/version-history-dialog.css";
import { nativePathLabel } from "./native-path-label";
import { useEditorServices } from "../services/editor-services";
import { projectFileBaseName } from "../document/project-file-service";

export function NativeLibraryDialog({
  onClose,
  onOpen,
  onNew,
}: {
  onClose(): void;
  onOpen(id: string): void;
  onNew?(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { exportDelivery } = useEditorServices();
  const [library, setLibrary] = useState<ProjectLibraryListing | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{
    entry: LibraryProject;
    name: string;
  } | null>(null);
  const [history, setHistory] = useState<{
    entry: Pick<LibraryProject, "id" | "name">;
    content: ProjectHistoryListing;
    selected: string;
  } | null>(null);
  async function refresh() {
    setLibrary(await libraryCommand("library"));
  }
  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    dialog.current?.showModal();
    void refresh().catch((error) => setError(String(error)));
  }, []);
  async function action(
    entry: Pick<LibraryProject, "id" | "name">,
    action: string,
    extra = {},
  ) {
    await run(async () => {
      await libraryCommand("library-action", {
        id: entry.id,
        action,
        ...extra,
      });
      if (
        ["restore-version", "delete", "purge", "restore", "rename"].includes(
          action,
        )
      )
        setHistory(null);
    });
  }
  async function showHistory(entry: Pick<LibraryProject, "id" | "name">) {
    await run(async () => {
      const content = await libraryCommand("history", { id: entry.id });
      setHistory({ entry, content, selected: content.versions[0]?.id ?? "" });
    });
  }
  async function exportSaved(id: string) {
    const saved = await libraryCommand("saved-copy", { id });
    await exportDelivery.deliverFile({
      suggestedName: `${projectFileBaseName(saved.name)}.icproj.json`,
      mediaType: "application/json",
      bytes: new TextEncoder().encode(saved.text),
    });
  }
  const comparison = (() => {
    if (!history) return null;
    const version = history.content.versions.find(
      (v) => v.id === history.selected,
    );
    if (!version) return null;
    try {
      return {
        before: parseProject(version.text),
        after: parseProject(history.content.currentText),
      };
    } catch (error) {
      return { error: String(error) };
    }
  })();
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="native-dialog"
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      aria-label="Local projects"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      style={{
        width: "min(1100px, 90vw)",
        maxHeight: "85vh",
        overflow: "auto",
      }}
    >
      <header
        style={{ display: "flex", justifyContent: "space-between", gap: 16 }}
      >
        <h2>Local projects</h2>
        <button type="button" disabled={busy} onClick={onClose}>
          Close
        </button>
      </header>
      <p>
        Project files and their last three saved versions stay on this computer.
        Exporting one Project file does not include its history.
      </p>
      <p title={library?.root}>
        Project folder:{" "}
        {library ? nativePathLabel(library.root) : "Unavailable"}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {onNew ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onClose();
              onNew();
            }}
          >
            New Project
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => libraryCommand("reveal", {}))}
        >
          Open project folder
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => libraryCommand("library-directory"))}
        >
          Choose project directory…
        </button>
        <button type="button" disabled={busy} onClick={() => void run(refresh)}>
          Refresh
        </button>
        <input
          aria-label="Search local projects"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search local projects"
        />
        <select
          aria-label="Project list filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Projects</option>
          <option value="favorites">Favorites</option>
          <option value="recycle">Recycle area</option>
        </select>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {renaming ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action(renaming.entry, "rename", { name: renaming.name });
            setRenaming(null);
          }}
        >
          <label>
            Project name{" "}
            <input
              autoFocus
              maxLength={120}
              value={renaming.name}
              onChange={(event) =>
                setRenaming({ ...renaming, name: event.target.value })
              }
            />
          </label>
          <button type="submit" disabled={busy || !renaming.name.trim()}>
            Save name
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRenaming(null)}
          >
            Cancel
          </button>
        </form>
      ) : null}
      <p>
        Close a project's tab before renaming, restoring history or deleting its
        saved file; the tab will protect unsaved edits.
      </p>
      <ul style={{ padding: 0, listStyle: "none" }}>
        {library?.projects
          .filter(
            (entry) =>
              entry.recycled === (filter === "recycle") &&
              (filter !== "favorites" || entry.favorite) &&
              entry.name
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
          )
          .map((entry) => (
            <li
              key={entry.id}
              style={{ borderBottom: "1px solid #8886", padding: "12px 0" }}
            >
              <strong>
                {entry.favorite ? "★ " : ""}
                {entry.name}
              </strong>
              <small
                title={entry.path}
                style={{ display: "block", overflowWrap: "anywhere" }}
              >
                {nativePathLabel(entry.path)} ·{" "}
                {entry.modified
                  ? new Date(entry.modified).toLocaleString()
                  : "Unavailable"}
              </small>
              {entry.error || entry.warning ? (
                <p role="alert">{entry.error ?? entry.warning}</p>
              ) : null}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 8,
                }}
              >
                {entry.recycled ? (
                  <>
                    <button
                      disabled={busy || !!entry.error}
                      onClick={() => void action(entry, "restore")}
                    >
                      Restore project
                    </button>
                    <button
                      disabled={busy || !!entry.error}
                      onClick={() => void action(entry, "purge")}
                    >
                      Delete permanently…
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      disabled={busy || !!entry.error}
                      onClick={() => {
                        onClose();
                        onOpen(entry.id);
                      }}
                    >
                      Open
                    </button>
                    <button
                      disabled={busy || !!entry.error}
                      onClick={() =>
                        void action(entry, "favorite", {
                          favorite: !entry.favorite,
                        })
                      }
                    >
                      {entry.favorite ? "Unfavorite" : "Favorite"}
                    </button>
                    <button
                      disabled={busy || !!entry.error}
                      onClick={() => void action(entry, "duplicate")}
                    >
                      Copy
                    </button>
                    <button
                      disabled={busy || !!entry.error}
                      onClick={() => setRenaming({ entry, name: entry.name })}
                    >
                      Rename…
                    </button>
                    <button
                      disabled={busy || !!entry.error}
                      onClick={() => void showHistory(entry)}
                    >
                      History
                    </button>
                    <button
                      disabled={busy || !!entry.error}
                      onClick={() => void action(entry, "delete")}
                    >
                      Move to recycle area…
                    </button>
                  </>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => libraryCommand("reveal", { id: entry.id }))
                  }
                >
                  Show in folder
                </button>
                {!entry.recycled ? (
                  <button
                    disabled={busy || !!entry.error}
                    onClick={() => void run(() => exportSaved(entry.id))}
                  >
                    Export saved file…
                  </button>
                ) : null}
              </div>
            </li>
          ))}
      </ul>
      {library?.projects.length === 0 ? (
        <p>No saved projects yet. Create a project, then press Ctrl+S.</p>
      ) : null}
      {filter !== "recycle" ? (
        <section aria-label="Recently opened files">
          <h3>Recently opened files</h3>
          <p>
            External files stay in their original locations. Removing a record
            keeps the file.
          </p>
          {library?.recentProjects
            .filter((entry) =>
              entry.name
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .map((entry) => (
              <article key={entry.id}>
                <strong>{entry.name}</strong>
                <p title={entry.path}>{nativePathLabel(entry.path)}</p>
                {entry.error ? (
                  <p role="alert">
                    File unavailable. Use Open Project to locate it again.
                  </p>
                ) : null}
                <button
                  disabled={busy || !!entry.error}
                  onClick={() => {
                    onClose();
                    onOpen(entry.id);
                  }}
                >
                  Open recent file
                </button>{" "}
                <button
                  disabled={busy || !!entry.error}
                  onClick={() =>
                    void run(() =>
                      libraryCommand("copy-to-library", { id: entry.id }),
                    )
                  }
                >
                  Copy to project library
                </button>{" "}
                <button
                  disabled={busy || !!entry.error}
                  onClick={() => void showHistory(entry)}
                >
                  History
                </button>{" "}
                <button
                  disabled={busy || !!entry.error}
                  onClick={() => void run(() => exportSaved(entry.id))}
                >
                  Export saved file…
                </button>{" "}
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => libraryCommand("reveal", { id: entry.id }))
                  }
                >
                  Show in folder
                </button>{" "}
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => libraryCommand("forget", { id: entry.id }))
                  }
                >
                  Remove recent record
                </button>
              </article>
            ))}
        </section>
      ) : null}
      {history ? (
        <section aria-label="Local save history">
          <h3>History · {history.entry.name}</h3>
          {!history.content.versions.length ? (
            <p>No earlier saves yet.</p>
          ) : (
            <>
              <select
                aria-label="Saved version"
                value={history.selected}
                onChange={(e) =>
                  setHistory({ ...history, selected: e.target.value })
                }
              >
                {history.content.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {new Date(v.savedAt).toLocaleString()}
                  </option>
                ))}
              </select>
              <button
                disabled={busy}
                onClick={() =>
                  void action(history.entry, "restore-version", {
                    version: history.selected,
                    expectedText: history.content.currentText,
                  })
                }
              >
                Restore this version…
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(history.entry, "branch-version", {
                    version: history.selected,
                  })
                }
              >
                Create independent branch
              </button>
              {comparison && "error" in comparison ? (
                <p role="alert">{comparison.error}</p>
              ) : comparison ? (
                <VersionHistoryComparison
                  before={comparison.before}
                  after={comparison.after}
                />
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </dialog>,
    document.body,
  );
}
