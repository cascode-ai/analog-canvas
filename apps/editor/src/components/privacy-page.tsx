import "../styles/gallery-entry.css";
import "../styles/privacy.css";

import { useEffect, useState } from "react";

import { ANALYTICS_OPT_OUT_PATH } from "../../analytics/client";
import { GalleryChrome } from "./gallery-chrome";
import {
  SITE_OPERATOR,
  SITE_PRIVACY_CONTACT,
  SITE_REPOSITORY_URL,
} from "./site-resource-links";

/** When the notice last changed; update it with the text. */
export const PRIVACY_UPDATED = "1 October 2026";

/**
 * Every cookie the site sets. All but `canvas_vid` belong to a feature you
 * use; that one only counts returning visitors, and can be refused.
 */
export const SITE_COOKIES = [
  {
    name: "canvas_vid",
    purpose:
      "Counts a returning browser once. It holds a random number; the server keeps only its hash.",
    lifetime: "1 year from your first visit, never renewed",
    when: "On your first visit, unless you refused it or your browser asks not to be tracked",
  },
  {
    name: "canvas_optout",
    purpose: "Remembers that you asked not to be counted.",
    lifetime: "13 months",
    when: "When you choose Stop counting me",
  },
  {
    name: "icm_session",
    purpose: "Keeps you signed in.",
    lifetime: "30 days",
    when: "After you sign in",
  },
  {
    name: "icm_oauth_state",
    purpose: "Protects GitHub and Google sign-in against forged requests.",
    lifetime: "10 minutes",
    when: "While you sign in with GitHub or Google",
  },
  {
    name: "icm_simulation_session",
    purpose: "Connects your simulation runs to this browser.",
    lifetime: "24 hours",
    when: "When you run a simulation without signing in",
  },
  {
    name: "icm_topology_session",
    purpose: "Connects a duplicate check to this browser.",
    lifetime: "7 days",
    when: "When you check a circuit for duplicates without signing in",
  },
] as const;

function browserRefusesTracking(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true
  );
}

/**
 * "Stop counting me": the visitor cookie goes and the choice is remembered.
 * Hidden where the site's counting does not run, such as a local preview.
 */
function CountingChoice() {
  const [optedOut, setOptedOut] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const refused = browserRefusesTracking();
  useEffect(() => {
    let cancelled = false;
    void fetch(ANALYTICS_OPT_OUT_PATH, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { optedOut?: unknown } | null) => {
        if (!cancelled && typeof body?.optedOut === "boolean")
          setOptedOut(body.optedOut);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (refused)
    return (
      <p className="privacy-choice" data-testid="privacy-counting-choice">
        Your browser asks sites not to track it, so it is not counted.
      </p>
    );
  if (optedOut === null) return null;
  const choose = async (optOut: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(ANALYTICS_OPT_OUT_PATH, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ optOut }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setOptedOut(((await response.json()) as { optedOut: boolean }).optedOut);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <p className="privacy-choice" data-testid="privacy-counting-choice">
      {optedOut ? "This browser is not counted." : "This browser is counted."}{" "}
      <button
        type="button"
        disabled={busy}
        onClick={() => void choose(!optedOut)}
      >
        {optedOut ? "Count me again" : "Stop counting me"}
      </button>
      {failed ? (
        <span role="alert"> Your choice was not saved; try again.</span>
      ) : null}
    </p>
  );
}

/** `/privacy`: who runs the site, what it keeps, and how to remove it. */
export function PrivacyPage() {
  const contact = (
    <a href={`mailto:${SITE_PRIVACY_CONTACT}`}>{SITE_PRIVACY_CONTACT}</a>
  );
  return (
    <main className="review-shell" data-testid="privacy-page">
      <GalleryChrome subtitle="Privacy" />
      <article className="page-body privacy-document">
        <h1>Privacy and cookies</h1>
        <p className="privacy-updated">Last updated {PRIVACY_UPDATED}</p>

        <p>
          Analog Canvas (analog-canvas.tokenzhang.com) is run by {SITE_OPERATOR}
          , a private individual, who decides what the site keeps and why. Write
          to {contact} with any question or request about your data.
        </p>
        <p>
          In short: you can draw without an account, and your drawings stay in
          your browser until you save them to the cloud or publish them. The
          site counts returning visitors with one cookie of its own, which you
          can refuse. It has no advertising, no third-party trackers, and no
          cookie that follows you across sites.
        </p>

        <h2>Visit statistics</h2>
        <p>
          For each page view the site records the page, your country and an
          approximate location (to about 100 km, from Cloudflare&rsquo;s
          network), and where the visit came from: a search engine, another
          website, or a campaign tag.
        </p>
        <p>
          To count a returning visitor only once, the site sets one cookie of
          its own, <code>canvas_vid</code>, holding a random number. It lasts a
          year from your first visit and is not renewed. The server keeps only a
          hash of that number, with the last day it was seen, and deletes it
          once the cookie can no longer exist; each day&rsquo;s list of visitors
          becomes a plain count the next day. The site does not store your IP
          address for statistics, shares nothing, and shows the statistics only
          as totals.
        </p>
        <p>
          If your browser asks sites not to track it (Do Not Track or Global
          Privacy Control), you are not counted and get no cookie. You can also
          refuse here:
        </p>
        <CountingChoice />
        <p>
          The site counts visits because it has a legitimate interest in knowing
          how it is used.
        </p>

        <h2>Your account</h2>
        <p>
          Signing in is optional; you need it to save to the cloud, publish to
          the Gallery, share components or like circuits. You can sign in with
          GitHub, Google or a code sent to your email. The site then keeps your
          email address, your display name, the sign-in method and that
          method&rsquo;s account number, and a sign-in session.
        </p>
        <ul>
          <li>
            Sign-in codes are sent by Resend, an email service. They work for 10
            minutes.
          </li>
          <li>
            With GitHub or Google, you approve on their page what they share:
            your name and email address.
          </li>
          <li>
            Each sign-in method is its own account. If you used more than one,
            each has its own data.
          </li>
        </ul>
        <p>
          The site uses this information to provide the account you asked for.
        </p>

        <h2>What you save and publish</h2>
        <ul>
          <li>
            <strong>Cloud Projects</strong> are private to your account. The
            site keeps the current version and the three before it.
          </li>
          <li>
            <strong>Circuits you publish to the Gallery</strong> are public,
            under your display name, with their earlier versions. The site also
            records which account published each one, including its email
            address and sign-in method; only moderators see those.
          </li>
          <li>
            <strong>Components you share</strong> are public, under your display
            name.
          </li>
          <li>
            <strong>Likes</strong> are stored with your account.
          </li>
          <li>
            <strong>Simulations</strong> run on the site&rsquo;s servers. Runs
            and their results are deleted 24 hours after they finish.
          </li>
          <li>
            <strong>Duplicate checks</strong> before publishing keep their
            results for 7 days.
          </li>
          <li>
            <strong>Agent connections</strong> pass your drawing between the
            editor and an agent you run yourself. A session lasts 30 minutes
            unless renewed, and its data is deleted when it ends. The site sends
            your drawings to no AI provider.
          </li>
        </ul>

        <h2>Cookies and browser storage</h2>
        <p>
          The site sets only these cookies, all its own. Each of the sign-in,
          simulation and duplicate-check cookies is set only when you use that
          feature, which needs it. <code>canvas_vid</code> only counts returning
          visitors to this site: it is never shared or combined with other data,
          lasts at most a year, and you can refuse it at any time. That is why
          the site shows no cookie banner.
        </p>
        <div className="privacy-table-scroll">
          <table className="privacy-cookies">
            <thead>
              <tr>
                <th scope="col">Cookie</th>
                <th scope="col">Purpose</th>
                <th scope="col">Lifetime</th>
                <th scope="col">Set</th>
              </tr>
            </thead>
            <tbody>
              {SITE_COOKIES.map((cookie) => (
                <tr key={cookie.name}>
                  <td>
                    <code>{cookie.name}</code>
                  </td>
                  <td>{cookie.purpose}</td>
                  <td>{cookie.lifetime}</td>
                  <td>{cookie.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          The editor also keeps your open tabs, unsaved work (so it can recover
          it) and view settings in your browser&rsquo;s own storage. That data
          stays on your device; the site never reads it.
        </p>

        <h2>Who else handles data</h2>
        <ul>
          <li>
            <strong>Cloudflare</strong> hosts the site and stores its data. As
            its network carries every request, it may log IP addresses for
            security.
          </li>
          <li>
            <strong>Resend</strong> sends sign-in codes.
          </li>
          <li>
            <strong>GitHub</strong> and <strong>Google</strong>, only if you
            sign in with them.
          </li>
          <li>
            <strong>GitHub</strong> also hosts the{" "}
            <a href={SITE_REPOSITORY_URL}>source code</a> and the public bug
            reports. Anything you write in a bug report is public.
          </li>
        </ul>
        <p>
          Cloudflare, Resend, GitHub and Google may handle data in the United
          States.
        </p>

        <h2>Deleting your data and your rights</h2>
        <p>
          You can delete your account at any time: select your name at the top
          right, and at the foot of your account choose{" "}
          <strong>Delete account…</strong>. This at once deletes the account and
          everything kept for it: your Cloud Projects, the circuits you
          published with their history, the components you shared, and your
          likes. Export anything you want to keep first. Drawings stored only in
          your browser are not affected.
        </p>
        <p>
          You may also ask what data the site keeps about you, have it corrected
          or deleted, or object to its use. Write to {contact}. You can also
          complain to a data protection authority, for example the Swiss FDPIC
          or the authority where you live in the EU.
        </p>

        <h2>Changes</h2>
        <p>When this notice changes, the date at the top changes with it.</p>
      </article>
    </main>
  );
}
