import { afterEach, describe, expect, it, vi } from "vitest";
import { RegionalProjectDO } from "./regional-projects";
import { projectPayloadHash } from "./project-sync-journal";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  environment,
  makerOf,
  route,
  saveRequest,
  sqliteState,
  ORIGIN,
  projectText,
  adminOf,
  testbenchProjectText,
} from "./gallery.test-support";

function regional(
  env: ReturnType<typeof environment>,
  region: "cn" | "overseas",
) {
  const store = new RegionalProjectDO(sqliteState(), {
    PROJECT_REGION: region,
  });
  return {
    ...env,
    PROJECT_SYNC_TOKEN: "peer-secret",
    PROJECT_IDENTITY_URL: "https://identity.test/identities",
    PROJECT_IDENTITY_TOKEN: "identity-secret",
    PROJECTS: {
      getByName: () => ({
        fetch: (url: string, init?: RequestInit) =>
          store.fetch(new Request(url, init)),
      }),
    },
  };
}
function regions(env: ReturnType<typeof environment>) {
  return [regional(env, "overseas"), regional(env, "cn")] as const;
}
const peerHeaders = { Authorization: "Bearer peer-secret" };
async function exported(env: ReturnType<typeof regions>[0], after = 0) {
  return (
    await (
      await route(
        env,
        new Request(`${ORIGIN}/api/project-sync/events?after=${after}`, {
          headers: peerHeaders,
        }),
      )
    ).json()
  ).events[0];
}
function deliver(env: ReturnType<typeof regions>[0], event: unknown) {
  return route(
    env,
    new Request(`${ORIGIN}/api/project-sync/events`, {
      method: "POST",
      headers: peerHeaders,
      body: JSON.stringify({ event }),
    }),
  );
}
describe("regional replication rejection and history over HTTP", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  function identity() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const { userIds } = JSON.parse(String(init?.body));
        return Response.json({
          identities: userIds.map((id: string) => ({
            id,
            status: "found",
            user: { id },
          })),
        });
      }),
    );
  }
  it("returns a token for exactly the opened snapshot while another save commits", async () => {
    const env = environment(),
      cookie = await makerOf(env),
      [a] = regions(env);
    const first = (await (await route(a, saveRequest(cookie, "Base"))).json())
      .project;
    let held = false,
      release!: () => void,
      entered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const json = Response.prototype.json;
    vi.spyOn(Response.prototype, "json").mockImplementation(async function (
      this: Response,
    ) {
      const payload = await json.call(this);
      if (!held && this.status === 200 && payload.project?.name === "Base") {
        held = true;
        entered();
        await barrier;
      }
      return payload;
    });
    const pending = route(
      a,
      new Request(`${ORIGIN}/api/projects/${first.id}`, {
        headers: { Cookie: cookie },
      }),
    );
    await waiting;
    const saved = await route(
      a,
      new Request(`${ORIGIN}/api/projects/${first.id}`, {
        method: "PUT",
        headers: {
          Cookie: cookie,
          Origin: ORIGIN,
          "If-Match": first.saveToken,
        },
        body: JSON.stringify({
          name: "Newer",
          projectText: projectText("Newer"),
        }),
      }),
    );
    expect(saved.status).toBe(200);
    release();
    const opened = await (await pending).json();
    expect(opened.project.name).toBe("Base");
    expect(opened.project.saveToken).toBe(first.saveToken);
  });
  it("recovers a lost PUT reply without adding history and rejects divergent stale writes", async () => {
    const env = environment(),
      cookie = await makerOf(env),
      [a] = regions(env);
    const first = (
      await (await route(a, saveRequest(cookie, "Initial"))).json()
    ).project;
    const save = (name: string) =>
      route(
        a,
        new Request(`${ORIGIN}/api/projects/${first.id}`, {
          method: "PUT",
          headers: {
            Cookie: cookie,
            Origin: ORIGIN,
            "If-Match": first.saveToken,
          },
          body: JSON.stringify({ name, projectText: projectText(name) }),
        }),
      );
    const changed = (await (await save("Changed")).json()).project;
    const retry = await save("Changed");
    expect(retry.status).toBe(200);
    const retried = (await retry.json()).project;
    expect(retried.saveToken).toBe(changed.saveToken);
    expect(retried).not.toHaveProperty("projectText");
    expect((await save("Divergent")).status).toBe(409);
    const history = await (
      await route(
        a,
        new Request(`${ORIGIN}/api/projects/${first.id}/versions`, {
          headers: { Cookie: cookie },
        }),
      )
    ).json();
    expect(history.versions).toHaveLength(1);
  });
  it("saves and replicates accumulated history larger than one runtime SQLite row", async () => {
    const env = environment(),
      cookie = await makerOf(env);
    const make = (region: "cn" | "overseas") => {
      const store = new RegionalProjectDO(
        sqliteState(undefined, 2 * 1024 * 1024),
        { PROJECT_REGION: region },
      );
      return {
        ...regional(env, region),
        PROJECTS: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              store.fetch(new Request(url, init)),
          }),
        },
      };
    };
    const a = make("overseas"),
      b = make("cn");
    identity();
    const document = parseProject(testbenchProjectText("Large"));
    const folder = document.simulationFolders![0]!;
    if (folder.input.kind !== "source")
      throw new Error("expected source fixture");
    folder.input.files[0]!.text =
      "* " + "large fixture ".repeat(50000) + "\n.end\n";
    let saved: { id: string; saveToken: string } | undefined;
    for (let index = 0; index < 4; index++) {
      document.name = `Large ${index}`;
      const response = await route(
        a,
        new Request(`${ORIGIN}/api/projects${saved ? "/" + saved.id : ""}`, {
          method: saved ? "PUT" : "POST",
          headers: {
            Cookie: cookie,
            Origin: ORIGIN,
            ...(saved ? { "If-Match": saved.saveToken } : {}),
          },
          body: JSON.stringify({
            name: document.name,
            projectText: serializeProject(document),
          }),
        }),
      );
      expect(response.status).toBe(saved ? 200 : 201);
      saved = (await response.json()).project;
      expect((await deliver(b, await exported(a, index))).status).toBe(200);
    }
    const history = await (
      await route(
        b,
        new Request(`${ORIGIN}/api/projects/${saved!.id}/versions`, {
          headers: { Cookie: cookie },
        }),
      )
    ).json();
    expect(history.versions).toHaveLength(3);
  });
  it("does not release another owner's pending creation grant on a rejected delete", async () => {
    const env = environment(),
      cookie = await makerOf(env),
      stranger = await adminOf(env),
      [a] = regions(env);
    identity();
    await route(a, saveRequest(cookie, "Existing"));
    const ownerUserId = JSON.parse((await exported(a)).payload).ownerUserId;
    for (let index = 0; index < 19; index++)
      expect(
        (
          await route(
            a,
            new Request(`${ORIGIN}/api/project-sync/quota`, {
              method: "POST",
              headers: peerHeaders,
              body: JSON.stringify({ id: `reserved-${index}`, ownerUserId }),
            }),
          )
        ).status,
      ).toBe(200);
    expect(
      (
        await route(
          a,
          new Request(`${ORIGIN}/api/projects/reserved-0`, {
            method: "DELETE",
            headers: { Cookie: stranger, Origin: ORIGIN },
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await route(a, saveRequest(cookie, "Beyond global quota"))).status,
    ).toBe(409);
  });
  it("holds its cursor at gaps and rejects corrupted, colliding and foreign-epoch events", async () => {
    const env = environment(),
      cookie = await makerOf(env),
      [a, b] = regions(env);
    identity();
    await route(a, saveRequest(cookie, "One"));
    await route(a, saveRequest(cookie, "Two"));
    const first = await exported(a),
      second = await exported(a, 1);
    expect((await deliver(b, second)).status).toBe(409);
    expect((await deliver(b, { ...first, payloadHash: "wrong" })).status).toBe(
      400,
    );
    expect((await deliver(b, { ...first, origin: "cn" })).status).toBe(400);
    expect((await deliver(b, first)).status).toBe(200);
    expect((await deliver(b, { ...second, sequence: 1 })).status).toBe(409);
    expect(
      (await deliver(b, { ...second, epoch: "replacement-epoch" })).status,
    ).toBe(409);
    const snapshot = JSON.parse(second.payload);
    snapshot.versions = [
      {
        ...snapshot.project,
        id: "duplicate",
        project_id: snapshot.id,
        saved_at: snapshot.project.updated_at,
        revision: 1,
      },
      {
        ...snapshot.project,
        id: "duplicate",
        project_id: snapshot.id,
        saved_at: snapshot.project.updated_at,
        revision: 1,
      },
    ];
    const payload = JSON.stringify(snapshot);
    expect(
      (
        await deliver(b, {
          ...second,
          payload,
          payloadHash: await projectPayloadHash(payload),
        })
      ).status,
    ).toBe(400);
    const status = await (
      await route(
        b,
        new Request(`${ORIGIN}/api/project-sync/status`, {
          headers: peerHeaders,
        }),
      )
    ).json();
    expect(status.received.sequence).toBe(1);
    expect((await deliver(b, second)).status).toBe(200);
    expect((await deliver(b, first)).status).toBe(200);
  });
  it("stops reading an oversized peer stream and does not expose responses to shared caches", async () => {
    const [a] = regions(environment());
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await route(
      a,
      new Request(`${ORIGIN}/api/project-sync/events`, {
        method: "POST",
        headers: peerHeaders,
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("replicates retained history and keeps a deleted Project deleted after a late regional save", async () => {
    const env = environment(),
      cookie = await makerOf(env),
      [a, b] = regions(env);
    identity();
    let project = (
      await (await route(a, saveRequest(cookie, "Initial"))).json()
    ).project;
    expect((await deliver(b, await exported(a))).status).toBe(200);
    const update = (region: typeof a, name: string, token: string) =>
      route(
        region,
        new Request(`${ORIGIN}/api/projects/${project.id}`, {
          method: "PUT",
          headers: { Cookie: cookie, Origin: ORIGIN, "If-Match": token },
          body: JSON.stringify({ name, projectText: projectText(name) }),
        }),
      );
    for (let index = 1; index <= 4; index++) {
      project = (
        await (await update(a, `Save ${index}`, project.saveToken)).json()
      ).project;
      expect((await deliver(b, await exported(a, index))).status).toBe(200);
    }
    const history = await (
      await route(
        b,
        new Request(`${ORIGIN}/api/projects/${project.id}/versions`, {
          headers: { Cookie: cookie },
        }),
      )
    ).json();
    expect(history.versions.map((v: { name: string }) => v.name)).toEqual([
      "Save 3",
      "Save 2",
      "Save 1",
    ]);
    const old = await route(
      b,
      new Request(
        `${ORIGIN}/api/projects/${project.id}/versions/${history.versions[0].versionId}/project`,
        { headers: { Cookie: cookie } },
      ),
    );
    expect((await old.json()).projectText).toBe(projectText("Save 3"));
    expect((await update(b, "Late edit", project.saveToken)).status).toBe(200);
    expect(
      (
        await route(
          a,
          new Request(`${ORIGIN}/api/projects/${project.id}`, {
            method: "DELETE",
            headers: { Cookie: cookie, Origin: ORIGIN },
          }),
        )
      ).status,
    ).toBe(200);
    expect((await deliver(a, await exported(b))).status).toBe(200);
    expect((await deliver(b, await exported(a, 5))).status).toBe(200);
    for (const region of [a, b])
      expect(
        (
          await route(
            region,
            new Request(`${ORIGIN}/api/projects/${project.id}`, {
              headers: { Cookie: cookie },
            }),
          )
        ).status,
      ).toBe(404);
  });
});
