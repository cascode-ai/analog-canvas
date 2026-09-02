import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AccountMenuView,
  fetchSessionUser,
  type AccountState,
} from "./account";

function markupFor(state: AccountState, notice: string | null = null): string {
  return renderToStaticMarkup(
    createElement(AccountMenuView, {
      state,
      notice,
      onEmailStart: () => undefined,
      onRename: () => undefined,
      onSignOut: () => undefined,
    }),
  );
}

describe("AccountMenuView", () => {
  it("renders nothing while no provider is configured (dark ship)", () => {
    expect(
      markupFor({
        providers: { github: false, google: false, email: false },
        user: null,
      }),
    ).toBe("");
  });

  it("offers exactly the enabled providers to signed-out visitors", () => {
    const markup = markupFor(
      {
        providers: { github: true, google: false, email: true },
        user: null,
      },
      "Sign-in failed — try again.",
    );
    expect(markup).toContain('data-testid="account-signin"');
    expect(markup).toContain('href="/api/auth/github/start"');
    expect(markup).not.toContain("google/start");
    expect(markup).toContain('data-testid="signin-email-input"');
    expect(markup).toContain("Sign-in failed — try again.");
  });

  it("shows the signed-in identity with rename, badge, and sign out", () => {
    const markup = markupFor({
      providers: { github: true, google: true, email: true },
      user: {
        id: "u1",
        displayName: "Token Zhang",
        email: "owner@example.com",
        provider: "github",
        role: "user",
        isAdmin: true,
      },
    });
    expect(markup).toContain('data-testid="account-name"');
    expect(markup).toContain("Token Zhang");
    expect(markup).toContain('data-testid="account-owner"');
    expect(markup).toContain('data-testid="account-signout"');
    expect(markup).not.toContain("account-signin");
  });
});

describe("fetchSessionUser", () => {
  it("coalesces concurrent and nearby consumers onto one session request", async () => {
    let requests = 0;
    const fetchLike = (async () => {
      requests += 1;
      return new Response(JSON.stringify({ user: null }), { status: 200 });
    }) as typeof fetch;

    const [first, second] = await Promise.all([
      fetchSessionUser(fetchLike),
      fetchSessionUser(fetchLike),
    ]);
    const third = await fetchSessionUser(fetchLike);

    expect([first, second, third]).toEqual([null, null, null]);
    expect(requests).toBe(1);
  });
});
