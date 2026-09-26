import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSessionUser } from "../components/account";
import { createWebEditorServices } from "./web-editor-services";

afterEach(() => vi.unstubAllGlobals());

describe("Web editor composition", () => {
  it("starts no requests and shares the account session cache with existing chrome", async () => {
    const user = { id: "member", displayName: "Member" };
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ user }));
    const services = createWebEditorServices(transport);
    expect(transport).not.toHaveBeenCalled();
    expect(await services.identity.getSessionUser()).toEqual(user);
    expect(await fetchSessionUser(transport)).toEqual(user);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("uses the supplied transport for the complete Cloud store and preserves revision conflicts", async () => {
    const project = createEmptyProject("source", "Source");
    const summary = {
      id: "cloud/source",
      name: project.name,
      revision: 8,
      schemaVersion: project.schemaVersion,
      updatedAt: "2026-09-26T00:00:00Z",
      galleryEntryId: "published",
      favorite: false,
    };
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ projects: [summary] }))
      .mockResolvedValueOnce(
        Response.json({
          project: { ...summary, projectText: serializeProject(project) },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: "revision-conflict", project: summary },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ project: summary }, { status: 201 }),
      )
      .mockResolvedValueOnce(Response.json({ projects: [] }));
    const globalTransport = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", globalTransport);
    const { projectStore: store } = createWebEditorServices(transport);

    expect(await store.list()).toEqual({
      status: "listed",
      projects: [summary],
    });
    expect(await store.open(summary.id)).toMatchObject({
      status: "opened",
      project: { projectText: serializeProject(project) },
    });
    expect(await store.save(project, { id: summary.id, revision: 7 })).toEqual({
      status: "conflict",
      project: summary,
    });
    await store.save(project, null, "published");
    expect(await store.delete(summary.id)).toEqual({
      status: "deleted",
      projects: [],
    });

    expect(globalTransport).not.toHaveBeenCalled();
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      "/api/projects",
      "/api/projects/cloud%2Fsource",
      "/api/projects/cloud%2Fsource",
      "/api/projects",
      "/api/projects/cloud%2Fsource",
    ]);
    const update = transport.mock.calls[2]![1]!;
    expect(update.method).toBe("PUT");
    expect(new Headers(update.headers).get("if-match")).toBe("revision-7");
    const creation = transport.mock.calls[3]![1]!;
    expect(creation.method).toBe("POST");
    expect(JSON.parse(creation.body as string).galleryEntryId).toBe(
      "published",
    );
  });

  it("keeps the default browser transport lazy until an action runs", async () => {
    const services = createWebEditorServices();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", transport);
    expect(await services.projectStore.list()).toEqual({
      status: "signed-out",
    });
    expect(transport).toHaveBeenCalledOnce();
  });
});
