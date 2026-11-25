// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModeratorsSection, type ModeratorRow } from "./moderators-section";

let root: Root;
let container: HTMLDivElement;
let calls: { method: string; url: string; body?: unknown }[];
let moderators: ModeratorRow[];
let knownUsers: Map<string, ModeratorRow>;
let listFails: boolean;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  calls = [];
  moderators = [];
  listFails = false;
  knownUsers = new Map([
    [
      "tomcajot@gmail.com",
      {
        email: "tomcajot@gmail.com",
        displayName: "Tom Cajot",
        providers: ["google"],
      },
    ],
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, ...(body ? { body } : {}) });
      if (url === "/api/auth/users/moderators" && method === "GET") {
        if (listFails) return Response.json({}, { status: 503 });
        return Response.json({ moderators });
      }
      if (url === "/api/auth/users/role" && method === "POST") {
        const email = String(body.email ?? "")
          .trim()
          .toLowerCase();
        const role = body.role;
        const user = knownUsers.get(email);
        if (!user) {
          return Response.json({ error: "no-such-user" }, { status: 404 });
        }
        if (role === "moderator") {
          if (!moderators.some((row) => row.email === email)) {
            moderators = [...moderators, user];
          }
          return Response.json({ updated: 1, role: "moderator" });
        }
        moderators = moderators.filter((row) => row.email !== email);
        return Response.json({ updated: 1, role: "user" });
      }
      return Response.json({ error: "not-found" }, { status: 404 });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let round = 0; round < 4; round += 1) await act(async () => {});
};
const byTestId = (id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ModeratorsSection", () => {
  it("lists, appoints by verified email, and revokes a moderator", async () => {
    act(() => root.render(<ModeratorsSection />));
    await settle();
    expect(byTestId("moderator-empty")?.textContent).toContain(
      "No moderators appointed.",
    );
    expect(byTestId("moderator-count")?.textContent).toBe("0");

    const input = byTestId("moderator-email-input") as HTMLInputElement;
    act(() => setInputValue(input, "  TomCajot@gmail.com "));
    const form = input.closest("form")!;
    act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await settle();

    expect(calls).toContainEqual({
      method: "POST",
      url: "/api/auth/users/role",
      body: { email: "tomcajot@gmail.com", role: "moderator" },
    });
    expect(byTestId("moderator-notice")?.textContent).toContain(
      "tomcajot@gmail.com is now a moderator.",
    );
    expect(byTestId("moderator-count")?.textContent).toBe("1");
    expect(byTestId("moderator-row-tomcajot@gmail.com")?.textContent).toContain(
      "Tom Cajot",
    );
    expect(byTestId("moderator-row-tomcajot@gmail.com")?.textContent).toContain(
      "Google",
    );

    act(() =>
      (
        byTestId("moderator-revoke-tomcajot@gmail.com") as HTMLButtonElement
      ).click(),
    );
    await settle();

    expect(calls).toContainEqual({
      method: "POST",
      url: "/api/auth/users/role",
      body: { email: "tomcajot@gmail.com", role: "user" },
    });
    expect(byTestId("moderator-notice")?.textContent).toContain(
      "Removed moderator access for tomcajot@gmail.com.",
    );
    expect(byTestId("moderator-empty")).not.toBeNull();
  });

  it("explains when no account exists for that verified email", async () => {
    act(() => root.render(<ModeratorsSection />));
    await settle();

    const input = byTestId("moderator-email-input") as HTMLInputElement;
    act(() => setInputValue(input, "unknown@example.com"));
    act(() => {
      input
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await settle();

    expect(byTestId("moderator-error")?.textContent).toContain(
      "No account found with that verified email.",
    );
  });

  it("retries loading the list after a transient failure", async () => {
    listFails = true;
    moderators = [knownUsers.get("tomcajot@gmail.com")!];
    act(() => root.render(<ModeratorsSection />));
    await settle();
    expect(container.textContent).toContain("Could not load moderators.");

    listFails = false;
    const retry = container.querySelector<HTMLButtonElement>(
      "p[role='alert'] button",
    )!;
    act(() => retry.click());
    await settle();
    expect(byTestId("moderator-row-tomcajot@gmail.com")?.textContent).toContain(
      "Tom Cajot",
    );
  });
});
