import { createEmptyProject } from "@icm/model";
import { readFileSync } from "node:fs";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";

import {
  deleteCloudProject,
  listCloudProjects,
  openCloudProject,
  saveCloudProject,
  editShelfProject,
  setShelfFavorite,
} from "./cloud-projects";

const project = createEmptyProject("portable-project", "Cloud Circuit");
const summary = {
  id: "cloud-1",
  name: "Cloud Circuit",
  updatedAt: "2026-08-28T10:00:00.000Z",
  revision: 1,
  schemaVersion: project.schemaVersion,
  galleryEntryId: null,
  favorite: false,
};

function respondWith(status: number, body: unknown) {
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

describe("Cloud Project client", () => {
  it("creates an unbound Project and updates a bound revision", async () => {
    const created = respondWith(201, { project: summary });
    expect(await saveCloudProject(project, null, created.fetchLike)).toEqual({
      status: "saved",
      project: summary,
    });
    expect(created.calls[0]).toMatchObject({
      url: "/api/projects",
      init: { method: "POST", credentials: "same-origin" },
    });

    const updatedSummary = { ...summary, revision: 2 };
    const updated = respondWith(200, { project: updatedSummary });
    expect(
      await saveCloudProject(
        project,
        { id: summary.id, revision: 1 },
        updated.fetchLike,
      ),
    ).toEqual({ status: "saved", project: updatedSummary });
    expect(updated.calls[0]!.url).toBe("/api/projects/cloud-1");
    expect(updated.calls[0]!.init?.method).toBe("PUT");
    expect(new Headers(updated.calls[0]!.init?.headers).get("if-match")).toBe(
      "revision-1",
    );
  });

  it("reports conflict, capacity, sign-in, size, and network failures", async () => {
    expect(
      await saveCloudProject(
        project,
        { id: summary.id, revision: 1 },
        respondWith(409, {
          error: "revision-conflict",
          project: { ...summary, revision: 2 },
        }).fetchLike,
      ),
    ).toMatchObject({ status: "conflict", project: { revision: 2 } });
    expect(
      await saveCloudProject(
        project,
        null,
        respondWith(409, {
          error: "project-limit",
          projects: [summary],
        }).fetchLike,
      ),
    ).toEqual({ status: "limit", projects: [summary] });
    for (const [status, expected] of [
      [401, "signed-out"],
      [413, "too-large"],
      [500, "rejected"],
    ] as const) {
      expect(
        (
          await saveCloudProject(
            project,
            null,
            respondWith(status, {}).fetchLike,
          )
        ).status,
      ).toBe(expected);
    }
    const offline = (() =>
      Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await saveCloudProject(project, null, offline)).toEqual({
      status: "unreachable",
      message: "offline",
    });
  });

  it("distinguishes a missing bound Project from an unavailable create endpoint", async () => {
    expect(
      await saveCloudProject(
        project,
        { id: summary.id, revision: 1 },
        respondWith(404, {}).fetchLike,
      ),
    ).toEqual({ status: "not-found" });
    expect(
      await saveCloudProject(project, null, respondWith(404, {}).fetchLike),
    ).toEqual({
      status: "unreachable",
      message: "Cloud Project service is unavailable (404)",
    });
  });

  it("lists summaries and opens one private Project", async () => {
    expect(
      await listCloudProjects(
        respondWith(200, { projects: [summary] }).fetchLike,
      ),
    ).toEqual({ status: "listed", projects: [summary] });
    expect(await listCloudProjects(respondWith(401, {}).fetchLike)).toEqual({
      status: "signed-out",
    });
    expect(await listCloudProjects(respondWith(503, {}).fetchLike)).toEqual({
      status: "unreachable",
      message: "Cloud Project list is unavailable (503)",
    });
    const opened = respondWith(200, {
      project: { ...summary, projectText: "{}" },
    });
    expect(await openCloudProject("cloud 1", opened.fetchLike)).toEqual({
      status: "opened",
      project: { ...summary, projectText: "{}" },
    });
    expect(opened.calls[0]!.url).toBe("/api/projects/cloud%201");

    const deleted = respondWith(200, { projects: [] });
    expect(await deleteCloudProject("cloud 1", deleted.fetchLike)).toEqual({
      status: "deleted",
      projects: [],
    });
    expect(deleted.calls[0]).toMatchObject({
      url: "/api/projects/cloud%201",
      init: { method: "DELETE", credentials: "same-origin" },
    });
  });
});

describe("Shelf card operations", () => {
  it("duplicates all Project data with an independent identity and no Gallery binding", async () => {
    const source = parseProject(
      serializeProject(
        parseProject(
          readFileSync(
            new URL(
              "../../examples/five-transistor-ota-sky130.icproj.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      ),
    );
    let sent: any;
    const result = await editShelfProject(
      "cloud-1",
      { kind: "duplicate" },
      async (_url, init) => {
        if (init?.method !== "POST")
          return new Response(
            JSON.stringify({
              project: {
                ...summary,
                galleryEntryId: "published",
                favorite: true,
                projectText: serializeProject(source),
              },
            }),
          );
        sent = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({ project: { ...summary, id: "copy" } }),
          { status: 201 },
        );
      },
    );
    expect(result.status).toBe("saved");
    const copied = parseProject(sent.projectText);
    expect(copied.id).not.toBe(source.id);
    expect({ ...copied, id: source.id, name: source.name }).toEqual(source);
    expect(sent).not.toHaveProperty("galleryEntryId");
    expect(sent).not.toHaveProperty("favorite");
  });
  it("renames the latest revision and surfaces conflicts without retrying over new edits", async () => {
    const calls: RequestInit[] = [];
    const result = await editShelfProject(
      "cloud-1",
      { kind: "rename", name: "New name" },
      async (_url, init) => {
        calls.push(init!);
        if (init?.method !== "PUT")
          return new Response(
            JSON.stringify({
              project: {
                ...summary,
                revision: 7,
                projectText: serializeProject(project),
              },
            }),
          );
        expect(new Headers(init.headers).get("if-match")).toBe("revision-7");
        const sent = JSON.parse(String(init.body));
        const changed = parseProject(sent.projectText);
        expect({ ...changed, name: project.name }).toEqual(project);
        expect(changed.name).toBe("New name");
        return new Response(
          JSON.stringify({
            error: "revision-conflict",
            project: { ...summary, revision: 8 },
          }),
          { status: 409 },
        );
      },
    );
    expect(result.status).toBe("conflict");
    expect(calls).toHaveLength(2);
  });
  it("changes only the favorite metadata and reports permission failures", async () => {
    const saved = respondWith(200, { project: { ...summary, favorite: true } });
    expect(
      (await setShelfFavorite("cloud-1", true, saved.fetchLike)).favorite,
    ).toBe(true);
    expect(JSON.parse(String(saved.calls[0]!.init?.body))).toEqual({
      favorite: true,
    });
    await expect(
      setShelfFavorite("cloud-1", true, respondWith(403, {}).fetchLike),
    ).rejects.toThrow("403");
  });
});
