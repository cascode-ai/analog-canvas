import { useEffect, useRef, useState, type FormEvent } from "react";
import { accountInitial, type AccountMenuViewProps } from "./account";
import { GitHubMark, GoogleMark } from "./provider-marks";
import { OPEN_SIGN_IN_EVENT, takeSignInRequest } from "./sign-in-request";
import { SITE_PRIVACY_PATH } from "./site-resource-links";

/** Presentational account area; all effects live in `AccountMenu`. */
export default function AccountMenuView({
  state,
  notice,
  inEditor = false,
  onEmailStart,
  onEmailVerify,
  onReturnToOwner,
}: AccountMenuViewProps) {
  const [email, setEmail] = useState("");
  // Signing in by email is two steps: the address, then the emailed code,
  // typed here whichever browser or device read the email.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const signIn = useRef<HTMLDetailsElement | null>(null);
  const { providers, user } = state;

  // An invitation to sign in anywhere on the page opens these choices, also
  // one made while they were still loading.
  useEffect(() => {
    const open = () => {
      const details = signIn.current;
      if (!details || !takeSignInRequest()) return;
      details.open = true;
      details.scrollIntoView({ block: "nearest" });
      details
        .querySelector<HTMLElement>(
          ".account-signin-panel a, .account-signin-panel input",
        )
        ?.focus();
    };
    window.addEventListener(OPEN_SIGN_IN_EVENT, open);
    open();
    return () => window.removeEventListener(OPEN_SIGN_IN_EVENT, open);
  }, []);

  const sendCode = async (address: string) => {
    setBusy(true);
    setMessage(null);
    const result = await onEmailStart(address);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (sentTo === address)
      setMessage("A new code is on its way; the one before no longer works.");
    setSentTo(address);
    setCode("");
  };
  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    if (email.trim() && !busy) void sendCode(email.trim());
  };
  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!sentTo || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await onEmailVerify(sentTo, code.trim());
    setBusy(false);
    if (!result.ok) setMessage(result.message);
  };

  if (user) {
    // The name is the one way into the account: its own page, where the
    // account is managed. In the editor it opens beside the drawing.
    return (
      <div className="account-menu" data-testid="account-menu">
        <a
          className="account-name"
          href="/account"
          data-testid="account-name"
          data-initial={accountInitial(user.displayName)}
          title="Your account"
          {...(inEditor ? { target: "_blank", rel: "noreferrer" } : {})}
        >
          {user.displayName}
        </a>
        {user.switchedFrom ? (
          <button
            type="button"
            className="account-switch-back"
            data-testid="account-switch-back"
            title={`Switch this browser back to ${user.switchedFrom.displayName}`}
            onClick={onReturnToOwner}
          >
            ↩ {user.switchedFrom.displayName}
          </button>
        ) : null}
      </div>
    );
  }

  if (!providers.github && !providers.google && !providers.email) {
    // Dark ship: with no provider configured, sign-in does not exist.
    return null;
  }

  const notes = message ?? notice;
  return (
    <details
      ref={signIn}
      className="account-signin"
      data-testid="account-signin"
    >
      <summary>Sign in</summary>
      <div className="account-signin-panel">
        {providers.github ? (
          <a
            className="account-provider"
            href="/api/auth/github/start"
            data-testid="signin-github"
          >
            <GitHubMark />
            Continue with GitHub
          </a>
        ) : null}
        {providers.google ? (
          <a
            className="account-provider"
            href="/api/auth/google/start"
            data-testid="signin-google"
          >
            <GoogleMark />
            Continue with Google
          </a>
        ) : null}
        {providers.email && (providers.github || providers.google) ? (
          <div className="account-signin-divider" aria-hidden="true">
            <span>or</span>
          </div>
        ) : null}
        {providers.email && sentTo === null ? (
          <form className="account-signin-email" onSubmit={submitEmail}>
            <input
              type="email"
              autoComplete="email"
              aria-label="Email address"
              data-testid="signin-email-input"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <button
              type="submit"
              data-testid="signin-email-send"
              disabled={busy}
            >
              Email me a code
            </button>
          </form>
        ) : null}
        {providers.email && sentTo !== null ? (
          <form
            className="account-signin-email"
            onSubmit={(event) => void submitCode(event)}
          >
            <p className="account-signin-hint" data-testid="signin-code-hint">
              Enter the 6-digit code sent to <strong>{sentTo}</strong>.
            </p>
            <input
              className="account-signin-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Sign-in code"
              data-testid="signin-code-input"
              placeholder="123456"
              maxLength={9}
              autoFocus
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
            <button
              type="submit"
              data-testid="signin-code-verify"
              disabled={busy || code.replace(/[\s-]/gu, "").length !== 6}
            >
              Sign in
            </button>
            <div className="account-signin-links">
              <button
                type="button"
                data-testid="signin-email-change"
                onClick={() => {
                  setSentTo(null);
                  setCode("");
                  setMessage(null);
                }}
              >
                Use another email
              </button>
              <button
                type="button"
                data-testid="signin-code-resend"
                disabled={busy}
                onClick={() => void sendCode(sentTo)}
              >
                Send a new code
              </button>
            </div>
          </form>
        ) : null}
        {notes ? (
          <p className="account-notice" data-testid="account-notice">
            {notes}
          </p>
        ) : null}
        <a
          className="account-signin-privacy"
          href={SITE_PRIVACY_PATH}
          data-testid="signin-privacy"
        >
          Privacy
        </a>
      </div>
    </details>
  );
}
