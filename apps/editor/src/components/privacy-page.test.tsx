import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AUTH_HANDOFF_COOKIE,
  AUTH_HANDOFF_TTL_MS,
  AUTH_SESSION_COOKIE,
  AUTH_SESSION_TTL_SECONDS,
  AUTH_STATE_COOKIE,
} from "../../../../worker/auth-do";
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
});
