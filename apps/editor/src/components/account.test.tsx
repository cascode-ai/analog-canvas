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
import {
  AccountDashboard,
  accountTabFromSearch,
  type AccountTab,
} from "./account-page";

function markupFor(
  state: AccountState,
  notice: string | null = null,
  inEditor = false,
): string {
  return renderToStaticMarkup(
    createElement(AccountMenuView, {
      state,
      notice,
      inEditor,
      onEmailStart: async () => ({ ok: true }) as const,
      onEmailVerify: async () => ({ ok: true }) as const,
      onReturnToOwner: () => undefined,
    }),
  );
}

function pageFor(
  user: NonNullable<AccountState["user"]>,
  initialTab?: AccountTab,
): string {
  return renderToStaticMarkup(
    createElement(AccountDashboard, {
      user,
      ...(initialTab ? { initialTab } : {}),
      onRename: () => undefined,
      onSignOut: () => undefined,
      onDeleteAccount: async () => ({ ok: false, message: "unused" }) as const,
      onDeleted: () => undefined,
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

  it("makes the signed-in name the one way into the account page", () => {
    const user = {
      id: "u1",
      displayName: "Ada",
      email: "ada@example.com",
      provider: "email",
      role: "user",
      isAdmin: false,
    };
    const providers = { github: true, google: false, email: true };
    const markup = markupFor({ providers, user });
    expect(markup).toContain(
      '<a class="account-name" href="/account" data-testid="account-name" data-initial="A" title="Your account">Ada</a>',
    );
    // Nothing else of the account is in the header, deleting least of all.
    for (const absent of [
      "⋯",
      "account-privacy",
      "account-delete",
      "account-signout",
    ])
      expect(markup).not.toContain(absent);
    // Account navigation stays with the drawing's window; explicitly opening
    // another browser tab still gives it its own workspace.
    expect(markupFor({ providers, user }, null, true)).toContain(
      'rel="noreferrer"',
    );
    expect(markupFor({ providers, user }, null, true)).not.toContain(
      'target="_blank"',
    );
    expect(markup).not.toContain("account-switch-back");
    // A browser the Owner switched to an AI account shows the way back.
    const seat = markupFor({
      providers,
      user: {
        ...user,
        displayName: "Claude Opus 5.5",
        email: null,
        provider: "ai",
        seat: "ai-designer-1",
        switchedFrom: { displayName: "Token Zhang" },
      },
    });
    expect(seat).toContain(">Claude Opus 5.5</a>");
    expect(seat).toMatch(
      /data-testid="account-switch-back" title="Switch this browser back to Token Zhang">↩ Token Zhang<\/button>/u,
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

  it("opens the account page on the account's circuits, tabs at the side", () => {
    const owner = {
      id: "u1",
      displayName: "Token Zhang",
      email: "owner@example.com",
      provider: "github",
      role: "user",
      isAdmin: true,
    };
    const markup = pageFor(owner);
    expect(markup).toContain(">Token Zhang</h1>");
    expect(markup).toContain("Signed in with GitHub");
    expect(markup).toContain("owner@example.com");
    expect(markup).toContain('data-testid="account-owner">Owner</span>');
    const tabs = [
      'data-testid="account-tab-circuits"',
      'data-testid="account-tab-projects"',
      'data-testid="account-tab-moderation"',
      'data-testid="account-tab-ai"',
      'data-testid="account-tab-settings"',
    ].map((needle) => markup.indexOf(needle));
    expect(tabs.every((index) => index >= 0)).toBe(true);
    expect([...tabs].sort((left, right) => left - right)).toEqual(tabs);
    // One click in, the circuits are already there; nothing else is open.
    expect(markup).toContain(
      'aria-selected="true" data-testid="account-tab-circuits"',
    );
    expect(markup).toContain('data-testid="account-panel-circuits"');
    expect(markup).toContain('data-testid="mine-content"');
    expect(markup).not.toContain('data-testid="account-delete"');
    expect(markup).not.toContain("/privacy");
    // Moderation is a tab of its own, not a page behind a link.
    expect(pageFor(owner, "moderation")).toContain(
      'data-testid="rejected-list"',
    );
  });

  it("shows Data to the Owner's own accounts alone (#1446)", () => {
    const account = {
      id: "u1",
      displayName: "Token Zhang",
      email: "owner@example.com",
      provider: "google",
      role: "user",
      isAdmin: true,
    };
    // Another administrator has no Data tab, and its link opens the circuits.
    const admin = pageFor(account, "data");
    expect(admin).not.toContain("account-tab-data");
    expect(admin).toContain('data-testid="account-panel-circuits"');
    const owner = pageFor({ ...account, isOwner: true }, "data");
    const tabs = [
      'data-testid="account-tab-moderation"',
      'data-testid="account-tab-data"',
      'data-testid="account-tab-ai"',
    ].map((needle) => owner.indexOf(needle));
    expect(tabs.every((index) => index >= 0)).toBe(true);
    expect([...tabs].sort((left, right) => left - right)).toEqual(tabs);
    expect(owner).toContain('data-testid="account-panel-data"');
    expect(owner).toContain("Loading the Gallery&#x27;s numbers…");
    // An Owner account that is no administrator still has it.
    const plain = pageFor({ ...account, isAdmin: false, isOwner: true });
    expect(plain).toContain("account-tab-data");
    expect(plain).not.toContain("account-tab-moderation");
  });

  it("keeps deleting the account last, in Settings", () => {
    const markup = pageFor(
      {
        id: "u1",
        displayName: "Token Zhang",
        email: null,
        provider: "email",
        role: "user",
        isAdmin: false,
      },
      "settings",
    );
    const order = [
      'id="account-profile"',
      'data-testid="account-rename"',
      'data-testid="account-signout"',
      'id="account-danger"',
      'data-testid="account-delete"',
    ].map((needle) => markup.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    expect(markup).not.toContain('data-testid="mine-content"');
  });

  it("shows Moderation to the Owner alone; a moderator keeps the badge", () => {
    const member = pageFor(
      {
        id: "member",
        displayName: "Member",
        email: null,
        provider: "google",
        role: "user",
        isAdmin: false,
      },
      "moderation",
    );
    expect(member).toContain("Signed in with Google");
    expect(member).not.toContain("account-tab-moderation");
    expect(member).not.toContain("account-tab-ai");
    expect(member).not.toContain("account-owner");
    // A link to a tab this account lacks opens the circuits instead.
    expect(member).toContain('data-testid="account-panel-circuits"');
    const moderator = pageFor(
      {
        id: "mod",
        displayName: "Mod",
        email: null,
        provider: "email",
        role: "moderator",
        isAdmin: false,
      },
      "moderation",
    );
    expect(moderator).toContain('data-testid="account-mod">Moderator</span>');
    expect(moderator).not.toContain("account-tab-moderation");
    expect(moderator).toContain('data-testid="account-panel-circuits"');
  });

  it("names an AI account by its seat and keeps its deletion with the Owner", () => {
    const markup = pageFor(
      {
        id: "ai-1",
        displayName: "Claude Opus 5.5",
        email: null,
        provider: "ai",
        role: "user",
        isAdmin: false,
        seat: "ai-designer-1",
      },
      "settings",
    );
    expect(markup).toContain("AI account ai-designer-1");
    expect(markup).toContain('data-testid="account-signout"');
    expect(markup).not.toContain('data-testid="account-delete"');
  });

  it("reads the open tab from the address", () => {
    expect(accountTabFromSearch("")).toBe("circuits");
    expect(accountTabFromSearch("?tab=projects")).toBe("projects");
    expect(accountTabFromSearch("?tab=moderation")).toBe("moderation");
    expect(accountTabFromSearch("?tab=ai")).toBe("ai");
    expect(accountTabFromSearch("?tab=settings")).toBe("settings");
    expect(accountTabFromSearch("?tab=elsewhere")).toBe("circuits");
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
