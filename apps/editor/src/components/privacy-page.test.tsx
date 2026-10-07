import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AUTH_SESSION_COOKIE,
  AUTH_SESSION_TTL_SECONDS,
  AUTH_STATE_COOKIE,
} from "../../../../worker/auth-do";
import { GALLERY_DAILY_OPEN_LIMIT } from "../../../../worker/gallery-do";
import { SIMULATION_SESSION_COOKIE } from "../../../../worker/simulation-control-do";
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
        SIMULATION_SESSION_COOKIE,
        ANALYTICS_PERSISTENCE_IDENTITY.visitorCookie,
        ANALYTICS_OPT_OUT_COOKIE,
      ].sort(),
    );
    expect(lifetime(AUTH_SESSION_COOKIE)).toBe(
      `${AUTH_SESSION_TTL_SECONDS / 86_400} days`,
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
});
