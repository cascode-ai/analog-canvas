import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  deleteAccount,
  fetchSessionUser,
  requestEmailCode,
  verifyEmailCode,
  type AccountState,
} from "./account";
import AccountMenuView from "./account-menu-view";

function markupFor(
  state: AccountState,
  notice: string | null = null,
  showGalleryLinks = true,
): string {
  return renderToStaticMarkup(
    createElement(AccountMenuView, {
      state,
      notice,
      showGalleryLinks,
      onEmailStart: async () => ({ ok: true }) as const,
      onEmailVerify: async () => ({ ok: true }) as const,
      onRename: () => undefined,
      onSignOut: () => undefined,
      onDeleteAccount: async () => ({ ok: false, message: "unused" }) as const,
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
    // Each provider shows its mark; email asks for a code, not a link.
    expect(markup).toContain('class="account-provider-logo"');
    expect(markup).toContain("Email me a code");
    expect(markup).not.toMatch(/Email me a link/u);
    // Before signing in, the panel says where to read what it keeps.
    expect(markup).toContain('href="/privacy" data-testid="signin-privacy"');
  });

  it("offers the privacy notice and account deletion to a signed-in member", () => {
    const markup = markupFor({
      providers: { github: true, google: false, email: true },
      user: {
        id: "u1",
        displayName: "Ada",
        email: "ada@example.com",
        provider: "email",
        role: "user",
        isAdmin: false,
      },
    });
    expect(markup).toContain('href="/privacy" data-testid="account-privacy"');
    expect(markup).toContain(
      'data-testid="account-delete" aria-haspopup="dialog">Delete account…</button>',
    );
  });

  it("reads each answer the server gives to an account deletion", async () => {
    const reply =
      (status: number, body: unknown = {}): typeof fetch =>
      async () =>
        Response.json(body, { status });
    const deleted = { circuits: 2, likes: 0, projects: 1, components: 0 };
    expect(await deleteAccount(reply(200, { deleted }))).toEqual({
      ok: true,
      deleted,
    });
    expect(await deleteAccount(reply(401))).toEqual({
      ok: false,
      message: "You are signed out. Sign in again.",
    });
    expect(await deleteAccount(reply(503))).toMatchObject({
      ok: false,
      message: expect.stringContaining("You are still signed in"),
    });
    expect(
      await deleteAccount(async () => {
        throw new TypeError("offline");
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("Could not reach the site"),
    });
  });

  it("asks for a code and reads each answer the server gives", async () => {
    const reply =
      (status: number, body: unknown = {}): typeof fetch =>
      async () =>
        Response.json(body, { status });
    expect(await requestEmailCode("a@b.co", reply(202))).toEqual({ ok: true });
    expect(await requestEmailCode("a@b.co", reply(429))).toEqual({
      ok: false,
      message: "Daily limit reached — try tomorrow.",
    });
    expect(await verifyEmailCode("a@b.co", "123456", reply(200))).toEqual({
      ok: true,
    });
    expect(
      await verifyEmailCode(
        "a@b.co",
        "123456",
        reply(400, { error: "invalid-code", attemptsLeft: 1 }),
      ),
    ).toEqual({ ok: false, message: "That code is not right — 1 try left." });
    expect(
      await verifyEmailCode(
        "a@b.co",
        "123456",
        reply(400, { error: "expired-code" }),
      ),
    ).toEqual({
      ok: false,
      message: "That code has expired or was used — send a new one.",
    });
    expect(
      await verifyEmailCode(
        "a@b.co",
        "123456",
        reply(429, { error: "too-many-attempts" }),
      ),
    ).toEqual({ ok: false, message: "Too many wrong codes — send a new one." });
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

  it("can reuse the account control without exposing Gallery-only links", () => {
    const markup = markupFor(
      {
        providers: { github: false, google: true, email: false },
        user: {
          id: "preview-user",
          displayName: "Preview Tester",
          email: "tester@example.com",
          provider: "google",
          role: "moderator",
          isAdmin: false,
        },
      },
      null,
      false,
    );

    expect(markup).toContain('data-testid="account-signout"');
    expect(markup).not.toContain('data-testid="account-mine"');
    expect(markup).not.toContain('data-testid="account-moderation-link"');
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
