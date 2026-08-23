import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  listWorkspaceShelf,
  openWorkspaceSlot,
  saveToWorkspaceShelf,
} from "./workspace-shelf";

const project = createEmptyProject("shelf", "Shelved Circuit");

function respondWith(
  status: number,
  body: unknown,
): {
  fetchLike: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchLike = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return { fetchLike, calls };
}

describe("account workspace shelf client", () => {
  it("posts the serialized project with the session cookie", async () => {
    const { fetchLike, calls } = respondWith(200, {
      slots: [
        { id: "s1", name: "Shelved Circuit", savedAt: "z", schemaVersion: 1 },
      ],
    });
    const outcome = await saveToWorkspaceShelf(project, fetchLike);
    expect(outcome).toEqual({
      status: "saved",
      slots: [
        { id: "s1", name: "Shelved Circuit", savedAt: "z", schemaVersion: 1 },
      ],
    });
    expect(calls[0]!.url).toBe("/api/workspace/recent");
    expect(calls[0]!.init?.credentials).toBe("same-origin");
    const body = JSON.parse(String(calls[0]!.init?.body)) as { name: string };
    expect(body.name).toBe("Shelved Circuit");
  });

  it("names the reason a save did not land", async () => {
    for (const [status, expected] of [
      [401, "signed-out"],
      [413, "too-large"],
      [500, "rejected"],
    ] as const) {
      const { fetchLike } = respondWith(status, {});
      const outcome = await saveToWorkspaceShelf(project, fetchLike);
      expect(outcome.status).toBe(expected);
    }
  });

  it("treats an unreachable shelf as empty rather than as a failure", async () => {
    const offline = (() =>
      Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await listWorkspaceShelf(offline)).toEqual([]);
    expect(await saveToWorkspaceShelf(project, offline)).toEqual({
      status: "unreachable",
      message: "offline",
    });
  });

  it("reads one slot by id and reports a missing one", async () => {
    const { fetchLike, calls } = respondWith(200, {
      name: "Shelved Circuit",
      projectText: "{}",
    });
    expect(await openWorkspaceSlot("s 1", fetchLike)).toEqual({
      status: "opened",
      name: "Shelved Circuit",
      projectText: "{}",
    });
    expect(calls[0]!.url).toBe("/api/workspace/recent/s%201");

    const { fetchLike: missing } = respondWith(404, {});
    expect(await openWorkspaceSlot("gone", missing)).toEqual({
      status: "not-found",
    });
  });
});
