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
  const projects =
    library?.projects.filter(
      (entry) =>
        entry.recycled === (filter === "recycle") &&
        (filter !== "favorites" || entry.favorite) &&
        entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) ?? [];
  const recent =
    library?.recentProjects.filter((entry) =>
      entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) ?? [];
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="native-dialog native-library-dialog"
      aria-label="Local projects"
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2>Local projects</h2>
        <button type="button" disabled={busy} onClick={onClose}>
          Close
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {history ? (
        <section
          aria-label="Local save history"
          className="native-library-history"
        >
          <button disabled={busy} onClick={() => setHistory(null)}>
            Back to projects
          </button>
          <h3>History · {history.entry.name}</h3>
          {!history.content.versions.length ? (
            <p>No earlier saves yet.</p>
          ) : (
            <>
              <div className="native-library-toolbar">
                <select
                  aria-label="Saved version"
                  value={history.selected}
                  onChange={(event) =>
                    setHistory({ ...history, selected: event.target.value })
                  }
                >
                  {history.content.versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {new Date(version.savedAt).toLocaleString()}
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
              </div>
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
          <p className="native-library-note">
            The latest three prior saves are kept. Close the project's tab
            before restoring its file.
          </p>
        </section>
      ) : (
        <>
          <div className="native-library-toolbar">
            <input
              autoFocus
              aria-label="Search local projects"
              placeholder="Search projects"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="Project list filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">Projects</option>
              <option value="favorites">Favorites</option>
              <option value="recycle">Recycle area</option>
            </select>
            {onNew ? (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  onClose();
                  onNew();
                }}
              >
                New Project
              </button>
            ) : null}
          </div>
          {renaming ? (
            <form
              className="native-library-rename"
              onSubmit={(event) => {
                event.preventDefault();
                const rename = renaming;
                void run(async () => {
                  await libraryCommand("library-action", {
                    id: rename.entry.id,
                    action: "rename",
                    name: rename.name,
                  });
                  setRenaming(null);
                });
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
          <ul className="native-project-list">
            {projects.map((entry) => (
              <li key={entry.id}>
                <div className="native-library-entry">
                  <button
                    className="native-project-open"
                    disabled={busy || !!entry.error || entry.recycled}
                    onClick={() => {
                      onClose();
                      onOpen(entry.id);
                    }}
                    aria-label={`Open ${entry.name}`}
                  >
                    <strong>{entry.name}</strong>
                  </button>
                  <small title={entry.path}>
                    {nativePathLabel(entry.path)}
                  </small>
                </div>
                <time
                  dateTime={
                    entry.modified
                      ? new Date(entry.modified).toISOString()
                      : undefined
                  }
                >
                  {entry.modified
                    ? new Date(entry.modified).toLocaleDateString()
                    : "Unavailable"}
                </time>
                {entry.recycled ? (
                  <button
                    disabled={busy || !!entry.error}
                    onClick={() => void action(entry, "restore")}
                  >
                    Restore project
                  </button>
                ) : (
                  <button
                    className="native-favorite"
                    title={entry.favorite ? "Unfavorite" : "Favorite"}
                    aria-label={entry.favorite ? "Unfavorite" : "Favorite"}
                    aria-pressed={entry.favorite}
                    disabled={busy || !!entry.error}
                    onClick={() =>
                      void action(entry, "favorite", {
                        favorite: !entry.favorite,
                      })
                    }
                  >
                    {entry.favorite ? "★" : "☆"}
                  </button>
                )}
                <details className="native-more-actions">
                  <summary aria-label={`More actions for ${entry.name}`}>
                    More
                  </summary>
                  <div className="native-action-menu">
                    {entry.recycled ? (
                      <button
                        disabled={busy || !!entry.error}
                        onClick={() => void action(entry, "purge")}
                      >
                        Delete permanently…
                      </button>
                    ) : (
                      <>
                        <button
                          disabled={busy || !!entry.error}
                          onClick={() => void action(entry, "duplicate")}
                        >
                          Copy
                        </button>
                        <button
                          disabled={busy || !!entry.error}
                          onClick={() =>
                            setRenaming({ entry, name: entry.name })
                          }
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
                          onClick={() => void run(() => exportSaved(entry.id))}
                        >
                          Export saved file…
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
                        void run(() =>
                          libraryCommand("reveal", { id: entry.id }),
                        )
                      }
                    >
                      Show in folder
                    </button>
                  </div>
                </details>
                {entry.error || entry.warning ? (
                  <p className="native-row-notice" role="alert">
                    {entry.error ?? entry.warning}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {!projects.length ? (
            <p className="native-library-empty">
              {query
                ? "No matching projects."
                : filter === "favorites"
                  ? "No favorites yet. Use the star beside a project."
                  : filter === "recycle"
                    ? "The recycle area is empty."
                    : "No saved projects yet. Create a project, then press Ctrl+S."}
            </p>
          ) : null}
          {filter === "all" && recent.length ? (
            <details className="native-recent-projects">
              <summary>External files ({recent.length})</summary>
              <p className="native-library-note">
                Files stay in their original folders. Removing a record keeps
                the file.
              </p>
              <div className="native-project-list">
                {recent.map((entry) => (
                  <article key={entry.id}>
                    <div className="native-library-entry">
                      <button
                        className="native-project-open"
                        disabled={busy || !!entry.error}
                        onClick={() => {
                          onClose();
                          onOpen(entry.id);
                        }}
                        aria-label={`Open recent file ${entry.name}`}
                      >
                        <strong>{entry.name}</strong>
                      </button>
                      <small title={entry.path}>
                        {nativePathLabel(entry.path)}
                      </small>
                    </div>
                    <details className="native-more-actions">
                      <summary aria-label={`More actions for ${entry.name}`}>
                        More
                      </summary>
                      <div className="native-action-menu">
                        <button
                          disabled={busy || !!entry.error}
                          onClick={() =>
                            void run(() =>
                              libraryCommand("copy-to-library", {
                                id: entry.id,
                              }),
                            )
                          }
                        >
                          Copy to project library
                        </button>
                        <button
                          disabled={busy || !!entry.error}
                          onClick={() => void showHistory(entry)}
                        >
                          History
                        </button>
                        <button
                          disabled={busy || !!entry.error}
                          onClick={() => void run(() => exportSaved(entry.id))}
                        >
                          Export saved file…
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              libraryCommand("reveal", { id: entry.id }),
                            )
                          }
                        >
                          Show in folder
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              libraryCommand("forget", { id: entry.id }),
                            )
                          }
                        >
                          Remove recent record
                        </button>
                      </div>
                    </details>
                    {entry.error ? (
                      <p role="alert" className="native-row-notice">
                        File unavailable. Use Open Project to locate it again.
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </details>
          ) : null}
          <details className="native-folder-settings">
            <summary>Project folder & settings</summary>
            <p title={library?.root}>
              {library
                ? nativePathLabel(library.root)
                : "Reading project folder…"}
            </p>
            <div className="native-library-toolbar">
              <button
                disabled={busy}
                onClick={() => void run(() => libraryCommand("reveal", {}))}
              >
                Open project folder
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() => libraryCommand("library-directory"))
                }
              >
                Choose project directory…
              </button>
              <button disabled={busy} onClick={() => void run(refresh)}>
                Refresh
              </button>
            </div>
            <p className="native-library-note">
              Changing this folder keeps existing files where they are. Close a
              project's tab before renaming or deleting its saved file.
            </p>
          </details>
        </>
      )}
    </dialog>,
    document.body,
  );
}
