// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultTokenLabel, OwnerTokensSection } from "./owner-tokens";

const SECRET = "acot_secret-value";
let root: Root;
let container: HTMLDivElement;
let calls: { method: string; url: string; body?: unknown }[];
let tokens: {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: null;
}[];
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  calls = [];
  tokens = [];
  writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", {
    platform: "MacIntel",
    clipboard: { writeText },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url,
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (method === "POST") {
        const { label } = JSON.parse(String(init!.body));
        tokens.push({
          id: "t1",
          label,
          createdAt: "2026-11-06T10:00:00Z",
          lastUsedAt: null,
        });
        return Response.json(
          { id: "t1", label, token: SECRET },
          { status: 201 },
        );
      }
      if (method === "DELETE") {
        tokens = tokens.filter((token) => !url.endsWith(token.id));
        return Response.json({ revoked: "t1" });
      }
      return Response.json({ tokens });
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

describe("the Owner's upload token", () => {
  it("names a new token after this computer and today", () => {
    expect(defaultTokenLabel("MacIntel", "2026-11-06T09:00:00Z")).toBe(
      "Mac 2026-11-06",
    );
    expect(defaultTokenLabel("Win32", "2026-11-06T09:00:00Z")).toBe(
      "Windows 2026-11-06",
    );
  });

  it("copies a new token without showing it, then lists it", async () => {
    act(() => root.render(<OwnerTokensSection />));
    await settle();
    expect((byTestId("owner-token-label") as HTMLInputElement).value).toMatch(
      /^Mac \d{4}-\d{2}-\d{2}$/u,
    );
    act(() => (byTestId("owner-token-copy") as HTMLButtonElement).click());
    await settle();
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(byTestId("owner-token-copied")?.textContent).toContain(
      "~/.config/analog-canvas/owner-token",
    );
    expect(container.textContent).not.toContain(SECRET);
    expect(byTestId("owner-token-list")?.textContent).toContain("never used");
  });

  it("revokes a token the clipboard refused, so no secret is left over", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    act(() => root.render(<OwnerTokensSection />));
    await settle();
    act(() => (byTestId("owner-token-copy") as HTMLButtonElement).click());
    await settle();
    expect(calls.map((call) => call.method)).toContain("DELETE");
    expect(tokens).toEqual([]);
    expect(byTestId("owner-token-failed")?.textContent).toContain(
      "Could not copy",
    );
  });

  it("revokes a listed token", async () => {
    tokens = [
      {
        id: "old",
        label: "Mac 2026-10-01",
        createdAt: "2026-10-01T00:00:00Z",
        lastUsedAt: null,
      },
    ];
    act(() => root.render(<OwnerTokensSection />));
    await settle();
    act(() => (byTestId("owner-token-revoke") as HTMLButtonElement).click());
    await settle();
    expect(calls).toContainEqual({
      method: "DELETE",
      url: "/api/auth/owner-tokens/old",
    });
    expect(byTestId("owner-token-list")).toBeNull();
  });
});
