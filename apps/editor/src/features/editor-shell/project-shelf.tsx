import { lazy, Suspense, useState } from "react";
import type { CloudProjectSummary } from "./cloud-projects";

const InlineConfirm = lazy(() =>
  import("../../components/inline-confirm").then((module) => ({
    default: module.InlineConfirm,
  })),
);

/** The compact Shelf stays in the tab strip; its two actions appear on hover
 * or keyboard focus, and decisions stay beside the selected Project. */
export function ProjectShelf({
  projects,
  busy,
  onOpen,
  onRename,
  onDelete,
}: {
  projects: readonly CloudProjectSummary[];
  busy: boolean;
  onOpen(id: string): void;
  onRename(id: string, name: string): Promise<void>;
  onDelete(id: string): Promise<void>;
}) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const rename = async () => {
    if (!editing || busy) return;
    const name = editing.name.trim();
    if (!name) return;
    try {
      setError(null);
      await onRename(editing.id, name);
      setEditing(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not rename this Project.",
      );
    }
  };
  return (
    <>
      {projects.length ? (
        projects.map((project) => (
          <div className="project-shelf-row" key={project.id}>
            {editing?.id === project.id ? (
              <form
                className="project-shelf-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  void rename();
                }}
              >
                <input
                  aria-label="Shelf project name"
                  value={editing.name}
                  maxLength={120}
                  autoFocus
                  disabled={busy}
                  onChange={(event) =>
                    setEditing({
                      id: project.id,
                      name: event.currentTarget.value,
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditing(null);
                    }
                  }}
                />
                <button type="submit" disabled={busy || !editing.name.trim()}>
                  Save
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="project-shelf-open"
                  disabled={busy}
                  onClick={(event) => {
                    event.currentTarget.closest("details")!.open = false;
                    onOpen(project.id);
                  }}
                >
                  {project.name}
                </button>
                <span className="project-shelf-actions">
                  <button
                    type="button"
                    aria-label={`Rename ${project.name}`}
                    title="Rename"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setEditing({ id: project.id, name: project.name });
                    }}
                  >
                    ✎
                  </button>
                  <Suspense fallback={null}>
                    <InlineConfirm
                      aria-label={`Delete ${project.name}`}
                      title="Delete"
                      disabled={busy}
                      onConfirm={() => onDelete(project.id)}
                    >
                      ×
                    </InlineConfirm>
                  </Suspense>
                </span>
              </>
            )}
          </div>
        ))
      ) : (
        <span>No saved Shelf projects. Sign in to load your shelf.</span>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
