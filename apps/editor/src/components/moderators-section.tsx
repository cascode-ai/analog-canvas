import { useEffect, useState } from "react";

export interface ModeratorRow {
  email: string;
  displayName: string;
  providers: string[];
}

const MODERATORS_URL = "/api/auth/users/moderators";
const ROLE_URL = "/api/auth/users/role";

function providerLabel(provider: string): string {
  if (provider === "github") return "GitHub";
  if (provider === "google") return "Google";
  if (provider === "email") return "Email";
  return provider;
}

async function listModerators(): Promise<ModeratorRow[] | null> {
  try {
    const response = await fetch(MODERATORS_URL, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      moderators?: ModeratorRow[];
    };
    return Array.isArray(payload.moderators) ? payload.moderators : [];
  } catch {
    return null;
  }
}

type RoleChangeResult =
  { ok: true; updated: number } | { ok: false; message: string };

async function changeModeratorRole(
  email: string,
  role: "moderator" | "user",
): Promise<RoleChangeResult> {
  try {
    const response = await fetch(ROLE_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      updated?: number;
    };
    if (response.ok) {
      return { ok: true, updated: Number(payload.updated ?? 0) };
    }
    if (response.status === 404 && payload.error === "no-such-user") {
      return {
        ok: false,
        message:
          "No account found with that verified email. They need to sign in once first.",
      };
    }
    if (response.status === 400) {
      return { ok: false, message: "Enter a valid email address." };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        message: "Admin access is required to change moderator roles.",
      };
    }
    return {
      ok: false,
      message: "Could not update moderator role. Please try again.",
    };
  } catch {
    return {
      ok: false,
      message: "Could not reach the site. Please try again.",
    };
  }
}

/**
 * Super-admin moderator management in the Moderation panel: lists appointed
 * moderators by verified email, appoints new moderators, and revokes access.
 */
export function ModeratorsSection() {
  const [moderators, setModerators] = useState<
    ModeratorRow[] | null | "failed"
  >(null);
  const [retry, setRetry] = useState(0);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listModerators().then((rows) => {
      if (!cancelled) setModerators(rows ?? "failed");
    });
    return () => {
      cancelled = true;
    };
  }, [retry]);

  const reload = () => setRetry((value) => value + 1);

  async function appoint() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || submitting || revoking !== null) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const result = await changeModeratorRole(trimmed, "moderator");
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEmail("");
    setNotice(`${trimmed} is now a moderator.`);
    reload();
  }

  async function revoke(targetEmail: string) {
    if (submitting || revoking !== null) return;
    setRevoking(targetEmail);
    setError(null);
    setNotice(null);
    const result = await changeModeratorRole(targetEmail, "user");
    setRevoking(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(`Removed moderator access for ${targetEmail}.`);
    reload();
  }

  return (
    <section
      className="moderation-collection moderators-section"
      data-testid="moderators-section"
      aria-labelledby="moderators-heading"
    >
      <header className="moderation-collection-heading">
        <h2 id="moderators-heading">Moderators</h2>
        {Array.isArray(moderators) ? (
          <span className="moderation-count" data-testid="moderator-count">
            {moderators.length}
          </span>
        ) : null}
      </header>
      <p className="moderators-note">
        Appointed by verified email. Moderators can edit any circuit, update its
        details, and restore versions; bin deletion and moderation settings stay
        with admins.
      </p>
      <form
        className="moderators-form"
        onSubmit={(event) => {
          event.preventDefault();
          void appoint();
        }}
      >
        <input
          type="email"
          className="moderators-email-input"
          aria-label="Moderator email"
          placeholder="name@example.com"
          autoComplete="off"
          data-testid="moderator-email-input"
          value={email}
          disabled={submitting || revoking !== null}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <button
          type="submit"
          className="moderators-primary"
          data-testid="moderator-add"
          disabled={!email.trim() || submitting || revoking !== null}
        >
          {submitting ? "Adding…" : "Add moderator"}
        </button>
      </form>
      {notice ? (
        <p
          className="moderators-feedback"
          role="status"
          data-testid="moderator-notice"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          className="moderation-load-error moderators-feedback"
          role="alert"
          data-testid="moderator-error"
        >
          {error}
        </p>
      ) : null}
      {moderators === "failed" ? (
        <p className="moderation-load-error" role="alert">
          Could not load moderators.{" "}
          <button type="button" onClick={reload}>
            Retry
          </button>
        </p>
      ) : moderators === null ? (
        <p className="gallery-status" role="status">
          Loading…
        </p>
      ) : moderators.length === 0 ? (
        <p className="gallery-status" data-testid="moderator-empty">
          No moderators appointed.
        </p>
      ) : (
        <ul className="moderators-list" data-testid="moderator-list">
          {moderators.map((moderator) => (
            <li
              key={moderator.email}
              className="moderators-row"
              data-testid={`moderator-row-${moderator.email}`}
            >
              <div className="moderators-identity">
                <span className="moderators-name">{moderator.displayName}</span>
                <span className="moderators-meta">
                  {moderator.email} ·{" "}
                  {moderator.providers.map(providerLabel).join(", ")}
                </span>
              </div>
              <button
                type="button"
                className="entry-action"
                data-testid={`moderator-revoke-${moderator.email}`}
                disabled={submitting || revoking !== null}
                onClick={() => void revoke(moderator.email)}
              >
                {revoking === moderator.email ? "Revoking…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
