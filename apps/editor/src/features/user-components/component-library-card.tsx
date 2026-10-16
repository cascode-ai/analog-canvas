import { useState } from "react";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import { ComponentPopover } from "./component-popover";
import { LibraryPreview } from "./library-preview";

export function ComponentLibraryCard({
  entry,
  user,
  busy,
  choose,
  manage,
  filter,
}: {
  entry: ComponentLibrarySummary;
  user: { id: string; isAdmin?: boolean } | null;
  busy: boolean;
  choose(action: "details" | "place" | "new" | "update" | "raw"): void;
  manage(action: "delete" | "restore"): Promise<void>;
  filter(): void;
}) {
  const [menu, setMenu] = useState<{
    anchor: HTMLElement;
    kind: "menu" | "delete";
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const invalid = entry.capability === "needs-repair";
  const deleted = entry.status === "deleted";
  const canManage = !!user && (user.isAdmin || user.id === entry.authorId);
  const canRestore =
    canManage && (user?.isAdmin || entry.deletion?.by === "author");
  async function lifecycle(action: "delete" | "restore") {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await manage(action);
      setMenu(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <article
      className="user-component-tile"
      data-testid={invalid ? "rejected-user-component" : undefined}
    >
      <div className="component-card-tools">
        <button
          type="button"
          aria-label={"Actions for " + entry.name}
          title="Actions"
          onClick={(e) => {
            setError("");
            setMenu({ anchor: e.currentTarget, kind: "menu" });
          }}
        >
          ⋯
        </button>
        {canManage && !deleted ? (
          <button
            type="button"
            aria-label={"Delete " + entry.name}
            title="Delete from library"
            onClick={(e) => {
              setError("");
              setMenu({ anchor: e.currentTarget, kind: "delete" });
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      {invalid ? (
        <div className="component-card-invalid">Invalid definition</div>
      ) : (
        <button
          type="button"
          className="user-component-place"
          disabled={deleted || busy}
          aria-label={"Place " + entry.name}
          title={entry.name + " · " + entry.author}
          onClick={() => choose("place")}
        >
          <LibraryPreview entry={entry} />
        </button>
      )}
      <div className="user-component-caption">
        <div className="component-card-title">
          <strong title={entry.name}>{entry.name}</strong>
          <small
            title={
              entry.status === "official" ? "Official component" : undefined
            }
          >
            {invalid
              ? "Invalid"
              : entry.capability === "symbol-only"
                ? "Symbol only"
                : "Circuit"}
          </small>
        </div>
        <button
          type="button"
          className="user-component-author"
          title={entry.author}
          aria-label={"Filter by author " + entry.author}
          onClick={filter}
        >
          {entry.author.trim() || "Unknown author"}
        </button>
        {invalid ? (
          <small title={entry.diagnostic}>{entry.diagnostic}</small>
        ) : null}
      </div>
      {menu ? (
        <ComponentPopover
          anchor={menu.anchor}
          label={
            menu.kind === "delete" ? "Delete from library" : "Component actions"
          }
          onClose={() => {
            if (!pending) setMenu(null);
          }}
        >
          {menu.kind === "delete" ? (
            <>
              <span>Delete from library?</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => void lifecycle("delete")}
              >
                Delete
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setMenu(null)}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                aria-label={
                  (invalid ? "Copy raw record for " : "Details for ") +
                  entry.name
                }
                onClick={() => {
                  setMenu(null);
                  choose(invalid ? "raw" : "details");
                }}
              >
                {invalid ? "Copy raw record" : "Details"}
              </button>
              {!invalid && !deleted ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={"Create from " + entry.name}
                  onClick={() => {
                    setMenu(null);
                    choose("new");
                  }}
                >
                  Create from…
                </button>
              ) : null}
              {!invalid &&
              !deleted &&
              ((user?.id === entry.authorId && entry.status === "shared") ||
                user?.isAdmin) ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={
                    user?.isAdmin
                      ? "Manage " + entry.name
                      : "Edit " + entry.name + " definition"
                  }
                  onClick={() => {
                    setMenu(null);
                    choose("update");
                  }}
                >
                  {user?.isAdmin ? "Manage" : "Edit"}
                </button>
              ) : null}
              {deleted && canRestore ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void lifecycle("restore")}
                >
                  Restore
                </button>
              ) : null}
            </>
          )}
          {error ? <small role="status">{error}</small> : null}
        </ComponentPopover>
      ) : null}
    </article>
  );
}
