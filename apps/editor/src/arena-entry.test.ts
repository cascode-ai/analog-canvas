import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import { arenaProjectCopy, loadArenaEntryProject } from "./arena-entry";
import {
  arenaEntryOf,
  arenaEntryRedirect,
  rememberArenaEntryOnSignIn,
} from "./arena-entry-address";

/** A tab's sessionStorage, as far as the entry uses it. */
function tabStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe("the Schematic Arena's Draw it yourself entry (#1695)", () => {
  it("reads one side of one Battle from the address, and nothing else", () => {
    expect(arenaEntryOf("?arena-battle=b-12_x&arena-side=a")).toEqual({
      battle: "b-12_x",
      side: "a",
    });
    expect(arenaEntryOf("?arena-battle=b1&arena-side=c")).toBeNull();
    expect(arenaEntryOf("?arena-battle=../x&arena-side=b")).toBeNull();
    expect(arenaEntryOf("?arena-side=b")).toBeNull();
  });

  it("opens the editor from the Gallery's address, and after a sign-in that returned there", () => {
    const storage = tabStorage();
    // The Arena may link the Gallery's address; the editor opens instead.
    expect(
      arenaEntryRedirect(
        { pathname: "/", search: "?arena-battle=b7&arena-side=b" },
        storage,
      ),
    ).toBe("/editor?arena-battle=b7&arena-side=b");
    // The editor itself, or the Gallery with nothing waiting, stays.
    expect(
      arenaEntryRedirect(
        { pathname: "/editor", search: "?arena-battle=b7&arena-side=b" },
        storage,
      ),
    ).toBeNull();
    expect(arenaEntryRedirect({ pathname: "/", search: "" }, storage)).toBe(
      null,
    );
    // A sign-in chosen from the entry ends on the Gallery: it continues,
    // once. A Voter who declines finds the Gallery as usual.
    let now = 1_000;
    const clicks: Array<(event: { target: unknown }) => void> = [];
    rememberArenaEntryOnSignIn(
      { battle: "b7", side: "a" },
      {
        addEventListener: (_type: string, listener: unknown) =>
          void clicks.push(listener as (typeof clicks)[number]),
      } as unknown as Document,
      storage,
      () => now,
    );
    const click = (href: string | null) =>
      clicks.forEach((listener) =>
        listener({
          target: {
            closest: (selector: string) =>
              href?.startsWith("/api/auth/") &&
              selector === 'a[href^="/api/auth/"]'
                ? {}
                : null,
          },
        }),
      );
    click(null);
    click("/arena");
    expect(arenaEntryRedirect({ pathname: "/", search: "" }, storage)).toBe(
      null,
    );
    click("/api/auth/github/start");
    expect(
      arenaEntryRedirect({ pathname: "/", search: "" }, storage, 2_000),
    ).toBe("/editor?arena-battle=b7&arena-side=a");
    expect(
      arenaEntryRedirect({ pathname: "/", search: "" }, storage, 3_000),
    ).toBeNull();
    // An entry left waiting too long is dropped.
    now = 0;
    click("/api/auth/google/start");
    expect(
      arenaEntryRedirect({ pathname: "/", search: "" }, storage, 16 * 60_000),
    ).toBeNull();
  });

  it("asks the Arena for the side's project and names each refusal", async () => {
    const project = createEmptyProject("arena-cs", "Common-source amplifier");
    const answer = (status: number, body: unknown) =>
      vi.fn(async () =>
        typeof body === "string"
          ? new Response(body, { status })
          : Response.json(body, { status }),
      ) as unknown as typeof fetch;
    const entry = { battle: "b7", side: "b" } as const;
    const ok = answer(200, serializeProject(project));
    const loaded = await loadArenaEntryProject(entry, ok);
    expect(ok).toHaveBeenCalledWith("/api/arena/battles/b7/b.icproj.json", {
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(loaded.ok && loaded.project.name).toBe("Common-source amplifier");
    for (const [status, body, reason] of [
      [401, { error: "sign-in-required" }, "sign-in"],
      [409, { error: "vote-required" }, "vote-required"],
      [404, { error: "battle-unknown" }, "battle-unknown"],
      [404, { error: "project-unknown" }, "project-unknown"],
      [502, "bad gateway", "unreachable"],
      [200, "not a project", "unreachable"],
    ] as const)
      expect(await loadArenaEntryProject(entry, answer(status, body))).toEqual({
        ok: false,
        reason,
      });
    const offline = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await loadArenaEntryProject(entry, offline)).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("makes the Voter's own copy, leaving the Arena's project as it was", () => {
    const project = createEmptyProject("arena-cs", "Common-source amplifier");
    const copy = arenaProjectCopy(project);
    expect(copy.id).not.toBe(project.id);
    expect(copy.name).toBe("Common-source amplifier (from Arena)");
    expect(copy.structureRevision).toBe(0);
    expect(copy.documents).toEqual(project.documents);
    expect(project.name).toBe("Common-source amplifier");
  });
});
