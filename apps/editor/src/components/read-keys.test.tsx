// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReadKeysSection, type ReadKeyRow } from "./read-keys";

const SECRET = "acrk_secret-value";
let root: Root;
let container: HTMLDivElement;
let calls: { method: string; url: string; body?: Record<string, unknown> }[];
let keys: ReadKeyRow[];
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  calls = [];
  keys = [];
  writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", {
    platform: "MacIntel",
    clipboard: { writeText },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, ...(body ? { body } : {}) });
      if (method === "POST") {
        keys.push({
          id: "k1",
          label: body.label,
          scope: body.scope,
          createdAt: "2026-11-07T10:00:00Z",
          expiresAt: "2099-01-01T00:00:00Z",
          lastUsedAt: null,
          uses: 0,
        });
        return Response.json({ id: "k1", token: SECRET }, { status: 201 });
      }
      if (method === "DELETE") {
        keys = keys.filter((key) => !url.endsWith(key.id));
        return Response.json({ revoked: "k1" });
      }
      return Response.json({ keys });
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
const byTestId = <T extends HTMLElement = HTMLElement>(id: string) =>
  container.querySelector<T>(`[data-testid="${id}"]`)!;
const type = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("the Owner's read keys", () => {
  it("copies a named key with its scope and lifetime, never showing it", async () => {
    act(() => root.render(<ReadKeysSection />));
    await settle();
    expect(byTestId<HTMLButtonElement>("read-key-copy").disabled).toBe(true);
    act(() => type(byTestId<HTMLInputElement>("read-key-label"), "Lu Jie"));
    act(() => byTestId<HTMLInputElement>("read-key-full").click());
    act(() => byTestId<HTMLButtonElement>("read-key-copy").click());
    await settle();
    expect(calls).toContainEqual({
      method: "POST",
      url: "/api/auth/read-keys",
      body: { label: "Lu Jie", scope: "full", days: 90 },
    });
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(container.textContent).not.toContain(SECRET);
    expect(byTestId("read-key-copied").textContent).toContain("Lu Jie");
    expect(byTestId("read-key-list").textContent).toContain(
      "Reviews and history",
    );
  });

  it("revokes a key the clipboard refused, so no secret is left over", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    act(() => root.render(<ReadKeysSection />));
    await settle();
    act(() => type(byTestId<HTMLInputElement>("read-key-label"), "script"));
    act(() => byTestId<HTMLButtonElement>("read-key-copy").click());
    await settle();
    expect(keys).toEqual([]);
    expect(byTestId("read-key-failed").textContent).toContain("Could not copy");
  });

  it("lists use and expiry, and revokes a key", async () => {
    keys = [
      {
        id: "old",
        label: "Rgeph",
        scope: "gallery",
        createdAt: "2026-09-01T00:00:00Z",
        expiresAt: "2026-10-01T00:00:00Z",
        lastUsedAt: "2026-09-20T00:00:00Z",
        uses: 42,
      },
    ];
    act(() => root.render(<ReadKeysSection />));
    await settle();
    const listed = byTestId("read-key-list").textContent!;
    expect(listed).toContain("expired");
    expect(listed).toContain("42 reads, last 2026-09-20");
    act(() => byTestId<HTMLButtonElement>("read-key-revoke").click());
    await settle();
    expect(calls).toContainEqual({
      method: "DELETE",
      url: "/api/auth/read-keys/old",
    });
    expect(container.querySelector('[data-testid="read-key-list"]')).toBeNull();
  });
});
