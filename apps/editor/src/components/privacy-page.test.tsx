import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AUTH_HANDOFF_COOKIE,
  AUTH_HANDOFF_TTL_MS,
  AUTH_SESSION_COOKIE,
  AUTH_SESSION_TTL_SECONDS,
  AUTH_STATE_COOKIE,
} from "../../../../worker/auth-do";
import { GALLERY_DAILY_OPEN_LIMIT } from "../../../../worker/gallery-store";
import {
  ANALYTICS_OPT_OUT_COOKIE,
  ANALYTICS_PERSISTENCE_IDENTITY,
  OPT_OUT_COOKIE_MAX_AGE,
  RETIRED_ANALYTICS_COOKIES,
  VISITOR_COOKIE_MAX_AGE,
} from "../../analytics/worker";
import { PrivacyPage, SITE_COOKIES } from "./privacy-page";

const lifetime = (name: string) =>
  SITE_COOKIES.find((cookie) => cookie.name === name)?.lifetime;

describe("privacy notice", () => {
  it("lists every cookie the site sets, with the lifetimes the code uses", () => {
    // A new cookie in the Worker without a row here fails this test.
    expect(SITE_COOKIES.map((cookie) => cookie.name).sort()).toEqual(
      [
        AUTH_SESSION_COOKIE,
        AUTH_STATE_COOKIE,
        AUTH_HANDOFF_COOKIE,
        ANALYTICS_PERSISTENCE_IDENTITY.visitorCookie,
        ANALYTICS_OPT_OUT_COOKIE,
      ].sort(),
    );
    expect(lifetime(AUTH_SESSION_COOKIE)).toBe(
      `${AUTH_SESSION_TTL_SECONDS / 86_400} days`,
    );
    expect(lifetime(AUTH_HANDOFF_COOKIE)).toBe(
      `${AUTH_HANDOFF_TTL_MS / 60_000} minute`,
    );
    expect(VISITOR_COOKIE_MAX_AGE).toBe(365 * 86_400);
    expect(lifetime(ANALYTICS_PERSISTENCE_IDENTITY.visitorCookie)).toMatch(
      /^1 year .*never renewed$/u,
    );
    // Thirteen months, the most audience-measurement rules allow.
    expect(OPT_OUT_COOKIE_MAX_AGE).toBeLessThanOrEqual(396 * 86_400);
    expect(lifetime(ANALYTICS_OPT_OUT_COOKIE)).toBe("13 months");
    const markup = renderToStaticMarkup(<PrivacyPage />);
    for (const cookie of SITE_COOKIES)
      expect(markup).toContain(`<code>${cookie.name}</code>`);
    for (const retired of RETIRED_ANALYTICS_COOKIES)
      expect(markup).not.toContain(retired);
  });

  it("states the daily Gallery open allowance the Worker enforces", () => {
    expect(renderToStaticMarkup(<PrivacyPage />)).toContain(
      `to allow up to ${GALLERY_DAILY_OPEN_LIMIT} a day`,
    );
  });

  it("names who runs the site, the contact, and how to delete an account", () => {
    const markup = renderToStaticMarkup(<PrivacyPage />);
    expect(markup).toContain("run by Token Zhang");
    expect(markup).toContain('href="mailto:zzhishuai@ethz.ch"');
    expect(markup).toContain("<strong>Delete account…</strong>");
    expect(markup).toContain("Do Not Track or Global");
  });

  it("describes AnalogArena as its Consent does: what it keeps, the IP hash, publication and account deletion", () => {
    const markup = renderToStaticMarkup(<PrivacyPage />);
    expect(markup).toContain("<h2>AnalogArena</h2>");
    expect(markup).toContain("<strong>Your Votes</strong>");
    expect(markup).toContain("<strong>Timings and interactions</strong>");
    expect(markup).toContain("<strong>Your Voter Profile</strong>");
    expect(markup).toContain(
      "a keyed hash of your IP address, with your country and network operator",
    );
    expect(markup).toContain("pseudonymous research data under CC BY 4.0");
    expect(markup).toContain(
      "names you only by a pseudonym made for that release alone",
    );
    expect(markup).toContain("with their timings and interactions");
    expect(markup).toContain(
      "of your Votes stay with them, unlinked from you, until that Season",
    );
    expect(markup).toContain(
      "Deleting your Analog Canvas account unlinks your Votes from you",
    );
    expect(markup).toContain(
      "Deletion cannot withdraw data already published.",
    );
  });
});
