import { useCallback, useEffect, useState } from "react";

import {
  CLOUD_PROJECT_LIMIT,
  cloudProjectPreviewUrl,
  deleteCloudProject,
  listCloudProjects,
  type CloudProjectSummary,
} from "../features/editor-shell/cloud-projects";
import { Masonry } from "./masonry";

/**
 * "My shelf": a member's own saved circuits as a wall rather than a list of
 * names in a menu. Every tile is private — the worker scopes both the listing
 * and each thumbnail to the signed-in account — so the shelf is a personal
 * corner of the same server the community gallery lives on.
 */

export type ShelfState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "unreachable"; message: string }
  | { status: "ready"; projects: readonly CloudProjectSummary[] };

export async function loadShelf(
  fetchLike: typeof fetch = fetch,
): Promise<ShelfState> {
  const outcome = await listCloudProjects(fetchLike);
  if (outcome.status === "listed") {
    return { status: "ready", projects: outcome.projects };
  }
  if (outcome.status === "signed-out") return { status: "signed-out" };
  return { status: "unreachable", message: outcome.message };
}

/** Opening a shelf tile hands the id to the editor, which loads the Project. */
export function shelfProjectHref(projectId: string): string {
  return `/editor?project=${encodeURIComponent(projectId)}`;
}

function formatUpdatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ShelfWall() {
  const [state, setState] = useState<ShelfState>({ status: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    void loadShelf().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);

  async function removeProject(project: CloudProjectSummary): Promise<void> {
    const confirmed = window.confirm(
      `Delete “${project.name}” from your shelf? This cannot be undone.`,
    );
    if (!confirmed) return;
    setBusyId(project.id);
    const outcome = await deleteCloudProject(project.id);
    setBusyId(null);
    if (outcome.status === "deleted") {
      setState({ status: "ready", projects: outcome.projects });
    }
  }

  if (state.status === "loading") {
    return (
      <p className="gallery-status" data-testid="shelf-loading">
        Loading your shelf…
      </p>
    );
  }

  if (state.status === "signed-out") {
    return (
      <p className="gallery-status" data-testid="shelf-signed-out">
        Sign in to keep your own shelf. Circuits you save there stay private to
        your account until you publish one to the gallery.
      </p>
    );
  }

  if (state.status === "unreachable") {
    return (
      <p className="gallery-status" data-testid="shelf-unreachable">
        Could not reach your shelf: {state.message}
      </p>
    );
  }

  if (state.projects.length === 0) {
    return (
      <p className="gallery-status" data-testid="shelf-empty">
        Your shelf is empty. Open the <a href="/editor">editor</a>, draw
        something, and use File → Save to keep it here.
      </p>
    );
  }

  return (
    <section className="gallery-wall" data-testid="shelf-wall">
      <p className="shelf-count" data-testid="shelf-count">
        {state.projects.length} of {CLOUD_PROJECT_LIMIT} saved · only you can
        see these
      </p>
      <Masonry
        aria-label="Circuits on your shelf"
        items={state.projects.map((project) => ({
          key: project.id,
          node: (
            <div className="gallery-tile-wrap">
              <a
                className="gallery-tile"
                href={shelfProjectHref(project.id)}
                data-testid={`shelf-tile-${project.id}`}
              >
                <span className="gallery-tile-preview">
                  <img
                    src={cloudProjectPreviewUrl(project.id, project.revision)}
                    alt={`Preview of ${project.name}`}
                    loading="lazy"
                  />
                </span>
                <span className="gallery-tile-copy">
                  <span className="gallery-tile-name">{project.name}</span>
                  <span className="gallery-tile-meta">
                    <time dateTime={project.updatedAt}>
                      {formatUpdatedAt(project.updatedAt)}
                    </time>
                    {" · "}
                    <span className="shelf-tile-revision">
                      revision {project.revision}
                    </span>
                  </span>
                </span>
              </a>
              <button
                type="button"
                className="shelf-tile-delete"
                data-testid={`shelf-delete-${project.id}`}
                aria-label={`Delete ${project.name} from your shelf`}
                disabled={busyId === project.id}
                onClick={() => void removeProject(project)}
              >
                Delete
              </button>
            </div>
          ),
        }))}
      />
    </section>
  );
}
