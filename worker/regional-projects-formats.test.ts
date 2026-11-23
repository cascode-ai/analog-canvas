import { afterEach, expect, it, vi } from "vitest";
import { projectPayloadHash } from "./project-sync-journal";
import { createEmptyProject } from "@icm/model";
import { environment, makerOf, ORIGIN } from "./gallery.test-support";

// Load the actual Worker and SQLite store twice, as independently built releases.
async function region(
  name: "cn" | "overseas",
  write: number,
  account: ReturnType<typeof environment>,
) {
  vi.resetModules();
  vi.doMock("../packages/project-protocol/src/file-format.json", () => ({
    default: { read: 87, write },
  }));
  const { RegionalProjectDO } = await import("./regional-projects");
  const { route, sqliteState } = await import("./gallery.test-support");
  const { serializeCompactProject, parseProject } =
    await import("@icm/project-protocol");
  const store = new RegionalProjectDO(sqliteState(), { PROJECT_REGION: name });
  const env = {
    ...account,
    PROJECT_SYNC_TOKEN: "peer-secret",
    PROJECT_SYNC_PEER_URL: "https://peer.test",
    PROJECT_SYNC_PEER_TOKEN: "peer-secret",
    PROJECT_IDENTITY_URL: "https://identity.test/identities",
    PROJECT_IDENTITY_TOKEN: "identity-secret",
    PROJECTS: {
      getByName: () => ({
        fetch: (url: string, init?: RequestInit) =>
          store.fetch(new Request(url, init)),
      }),
    },
  };
  return {
    serializeCompactProject,
    parseProject,
    fetch: (path: string, init: RequestInit) =>
      route(env, new Request(ORIGIN + path, init)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../packages/project-protocol/src/file-format.json");
  vi.resetModules();
});

it("replicates both physical formats without rewriting bytes or storing a new feature under an old version", async () => {
  const account = environment();
  const cookie = await makerOf(account);
  const writer = await region("overseas", 87, account);
  const reader = await region("cn", 86, account);
  vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
    if (new URL(url).pathname === "/api/project-sync/quota")
      return writer.fetch("/api/project-sync/quota", init);
    const { userIds } = JSON.parse(String(init.body)) as { userIds: string[] };
    return Response.json({
      identities: userIds.map((id) => ({ id, status: "found", user: { id } })),
    });
  });
  const project = createEmptyProject("rollout", "Mixed release");
  const plain = reader.serializeCompactProject(project);
  expect(JSON.parse(plain).schemaVersion).toBe(86);
  project.documents[0]!.drafting = {
    objects: [
      {
        id: "arc-1",
        kind: "arc",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 0, y: 0 } },
        start: { x: 0, y: 0 },
        through: { x: 20, y: -20 },
        end: { x: 40, y: 0 },
        lineStyle: "solid",
      },
    ],
  };
  const arc = writer.serializeCompactProject(project);
  expect(JSON.parse(arc).schemaVersion).toBe(87);
  const peer = { authorization: "Bearer peer-secret" };
  const save = (text: string) => ({
    method: "POST",
    headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ name: project.name, projectText: text }),
  });
  const replicate = async (
    from: typeof writer,
    to: typeof writer,
    text: string,
    after: number,
  ) => {
    const saved = await from.fetch("/api/projects", save(text));
    expect(saved.status, await saved.clone().text()).toBe(201);
    const {
      project: { id },
    } = await saved.json();
    const { events } = await (
      await from.fetch("/api/project-sync/events?after=" + after, {
        headers: peer,
      })
    ).json();
    expect(events).toHaveLength(1);
    const row = JSON.parse(events[0].payload).project;
    expect(row.project_text).toBe(text);
    expect(row.schema_version).toBe(JSON.parse(text).schemaVersion);
    const received = await to.fetch("/api/project-sync/events", {
      method: "POST",
      headers: peer,
      body: JSON.stringify({ event: events[0] }),
    });
    expect(received.status).toBe(200);
    const opened = await (
      await to.fetch("/api/projects/" + id, { headers: { cookie } })
    ).json();
    expect(opened.project.projectText).toBe(text);
  };
  await replicate(reader, writer, plain, 0);
  await replicate(writer, reader, arc, 1);
  // An old retained revision can have a valid file envelope even though the
  // editor no longer opens its contents. Every reader must retain those bytes.
  await writer.fetch("/api/projects", save(arc));
  const {
    events: [third],
  } = await (
    await writer.fetch("/api/project-sync/events?after=2", { headers: peer })
  ).json();
  const change = JSON.parse(third.payload);
  const file = JSON.parse(plain);
  file.documents[0].instances = null;
  const archived = JSON.stringify(file, null, 2);
  const row = change.project;
  row.revision = 2;
  const version = {
    id: row.id + ":1",
    project_id: row.id,
    revision: 1,
    name: row.name,
    saved_at: row.created_at,
    schema_version: 86,
    project_text: archived,
    preview_svg: "",
  };
  change.versions = [version];
  const deliver = async (change: unknown) => {
    const payload = JSON.stringify(change);
    return reader.fetch("/api/project-sync/events", {
      method: "POST",
      headers: peer,
      body: JSON.stringify({
        event: {
          ...third,
          payload,
          payloadHash: await projectPayloadHash(payload),
        },
      }),
    });
  };
  expect(
    (
      await deliver({
        ...change,
        project: { ...row, schema_version: 86, project_text: archived },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await deliver({
        ...change,
        versions: [{ ...version, schema_version: 88 }],
      })
    ).status,
  ).toBe(400);
  expect((await deliver(change)).status).toBe(200);
  const history = await reader.fetch(
    "/api/projects/" +
      row.id +
      "/versions/" +
      encodeURIComponent(version.id) +
      "/project",
    { headers: { cookie } },
  );
  expect(await history.json()).toEqual({ projectText: archived });
  await replicate(writer, reader, arc, 3);
  expect(() =>
    reader.serializeCompactProject(reader.parseProject(arc)),
  ).toThrow(/writer/i);
  const refused = await reader.fetch("/api/projects", save(arc));
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({
    error: "project-format-not-active",
  });
  const { events } = await (
    await reader.fetch("/api/project-sync/events?after=1", { headers: peer })
  ).json();
  expect(events).toHaveLength(0);
});
