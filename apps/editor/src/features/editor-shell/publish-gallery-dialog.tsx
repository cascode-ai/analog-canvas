import { useEffect, useState } from "react";

import type { SubmissionGateReport } from "@icm/derived";

import {
  describePublishOutcome,
  forgetOnUnauthorized,
  rememberedPublishAuthor,
  rememberedPublishToken,
  rememberPublishAuthor,
  rememberPublishToken,
  type GalleryPublishFields,
  type GalleryPublishOutcome,
  type PublishSessionUser,
} from "./gallery-publish";

export interface PublishGalleryDialogProps {
  defaultName: string;
  /** The signed-in user, if any; admins and moderators publish directly. */
  session?: PublishSessionUser | null;
  /** Quality-gate evaluation of the live Project (phase G3). */
  gateReport?: SubmissionGateReport | null;
  /** Present when the open circuit came from a gallery entry the signed-in
   * user may update (owner, admin, or moderator). */
  updateTarget?: { id: string } | null;
  publish: (fields: GalleryPublishFields) => Promise<GalleryPublishOutcome>;
  publishUpdate?:
    | ((fields: GalleryPublishFields) => Promise<GalleryPublishOutcome>)
    | undefined;
  onPublished: (outcome: {
    id: string;
    name: string;
    pending: boolean;
    updated: boolean;
  }) => void;
  onClose: () => void;
}

/**
 * File > "Publish to Gallery…". Admin and moderator sessions publish
 * directly; an ordinary signed-in user submits into the review queue and
 * must pass the quality gates (listed live, blocking). Without a session
 * the owner-passphrase path remains (remembered per browser session,
 * forgotten on a 401). The author byline prefills from the account's
 * display name, else from the last successful publish.
 */
export function PublishGalleryDialog({
  defaultName,
  session = null,
  gateReport = null,
  updateTarget = null,
  publish,
  publishUpdate,
  onPublished,
  onClose,
}: PublishGalleryDialogProps) {
  const privileged = session?.isAdmin === true || session?.role === "moderator";
  const ordinary = session !== null && !privileged;
  const anonymous = session === null;
  const gatesBlock = ordinary && gateReport !== null && !gateReport.ok;
  const canUpdate = updateTarget !== null && publishUpdate !== undefined;
  const [mode, setMode] = useState<"update" | "new">(
    canUpdate ? "update" : "new",
  );
  const updating = canUpdate && mode === "update";
  const [name, setName] = useState(defaultName);
  const [author, setAuthor] = useState(
    () => rememberedPublishAuthor() || session?.displayName || "",
  );
  const [description, setDescription] = useState("");
  const [token, setToken] = useState(() => rememberedPublishToken());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The session usually arrives after mount; fill the untouched author
  // byline with the account name once it does.
  const sessionDisplayName = session?.displayName;
  useEffect(() => {
    if (sessionDisplayName) {
      setAuthor((previous) => previous || sessionDisplayName);
    }
  }, [sessionDisplayName]);

  // The update permission also arrives with the session; default to
  // updating the opened entry unless the user already chose a mode.
  const [modeTouched, setModeTouched] = useState(false);
  useEffect(() => {
    if (canUpdate && !modeTouched) setMode("update");
  }, [canUpdate, modeTouched]);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const send = updating ? (publishUpdate ?? publish) : publish;
    const outcome = await send({
      name,
      author,
      description,
      token: anonymous ? token : "",
    });
    if (outcome.status === "published" || outcome.status === "pending-review") {
      if (anonymous) rememberPublishToken(token);
      rememberPublishAuthor(author);
      onPublished({
        id: outcome.id,
        name: name.trim(),
        pending: outcome.status === "pending-review",
        updated: updating,
      });
      return;
    }
    if (forgetOnUnauthorized(outcome)) setToken("");
    setBusy(false);
    setError(describePublishOutcome(outcome));
  }

  return (
    <div
      className="insert-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="publish-gallery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-gallery-title"
        data-testid="publish-gallery-dialog"
      >
        <header className="publish-gallery-header">
          <p>Share this circuit on the public wall</p>
          <h2 id="publish-gallery-title">Publish to Gallery</h2>
        </header>
        {canUpdate ? (
          <div className="publish-gallery-mode" data-testid="publish-mode">
            <label>
              <input
                type="radio"
                name="publish-mode"
                checked={mode === "update"}
                onChange={() => {
                  setMode("update");
                  setModeTouched(true);
                }}
              />
              Update the opened gallery entry
            </label>
            <label>
              <input
                type="radio"
                name="publish-mode"
                checked={mode === "new"}
                onChange={() => {
                  setMode("new");
                  setModeTouched(true);
                }}
              />
              Publish as a new entry
            </label>
          </div>
        ) : null}
        <div className="publish-gallery-fields">
          <label>
            Circuit name
            <input
              aria-label="Circuit name"
              value={name}
              maxLength={120}
              autoFocus
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>
              Author <span className="publish-gallery-optional">optional</span>
            </span>
            <input
              aria-label="Author"
              value={author}
              maxLength={40}
              placeholder="Shown on your tile"
              onChange={(event) => setAuthor(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>
              Description{" "}
              <span className="publish-gallery-optional">optional</span>
            </span>
            <textarea
              aria-label="Description"
              value={description}
              maxLength={300}
              rows={3}
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
          </label>
          {anonymous ? (
            <label>
              Owner passphrase
              <input
                aria-label="Owner passphrase"
                type="password"
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
              />
            </label>
          ) : null}
        </div>
        {gateReport && gateReport.failures.length > 0 ? (
          <div
            className={
              gatesBlock
                ? "publish-gallery-gates publish-gallery-gates-blocking"
                : "publish-gallery-gates"
            }
            data-testid="publish-gallery-gates"
          >
            <p>
              {gatesBlock
                ? "Fix these before submitting:"
                : "Quality checks (informational for your role):"}
            </p>
            <ul>
              {gateReport.failures.map((failure) => (
                <li key={failure.code}>
                  {failure.message}
                  {failure.count > 1 ? ` (${failure.count})` : ""}
                  {failure.examples.length > 0
                    ? ` — ${failure.examples.join(", ")}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="publish-gallery-note">
          {privileged
            ? updating
              ? `Signed in as ${session?.displayName} — this updates the entry in place.`
              : `Signed in as ${session?.displayName} — this publishes directly.`
            : ordinary
              ? updating
                ? `Signed in as ${session?.displayName} — your update replaces the entry and re-enters review.`
                : `Signed in as ${session?.displayName} — your circuit enters the review queue and appears once a reviewer approves it.`
              : "Publishing is owner-approved for now: it needs the gallery owner's passphrase, or sign in on the gallery page to submit for review."}
        </p>
        {error ? (
          <p role="alert" className="publish-gallery-error">
            {error}
          </p>
        ) : null}
        <div className="publish-gallery-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="publish-gallery-primary"
            disabled={
              busy ||
              name.trim() === "" ||
              (anonymous && token.trim() === "") ||
              gatesBlock
            }
            onClick={() => void submit()}
          >
            {busy
              ? "Publishing…"
              : updating
                ? ordinary
                  ? "Submit update for review"
                  : "Update entry"
                : ordinary
                  ? "Submit for review"
                  : "Publish"}
          </button>
        </div>
      </section>
    </div>
  );
}
