import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import {
  GALLERY_DAILY_SUBMISSION_LIMIT,
  GALLERY_MAX_PROJECT_BYTES,
  GalleryDO,
  routeGalleryRequest,
  type GalleryEnv,
} from "./gallery";
import { AuthDO, type AuthEnv } from "./auth";

function sqliteState() {
  const db = new DatabaseSync(":memory:");
  return {
    storage: {
      sql: {
        exec<T>(query: string, ...bindings: unknown[]) {
          const statement = db.prepare(query);
          if (/^\s*(select|with|pragma)/iu.test(query)) {
            const rows = statement.all(
              ...(bindings as (string | number | null)[]),
            ) as T[];
            return {
              toArray: () => rows,
              one: () => {
                if (rows.length !== 1) throw new Error("expected one row");
                return rows[0]!;
              },
            };
          }
          statement.run(...(bindings as (string | number | null)[]));
          return {
            toArray: () => [] as T[],
            one: () => {
              throw new Error("no rows");
            },
          };
        },
      },
      transactionSync<T>(callback: () => T): T {
        return callback();
      },
    },
  };
}

function environment(adminToken?: string): GalleryEnv {
  const durable = new GalleryDO(sqliteState());
  return {
    GALLERY: {
      getByName: () => ({
        fetch: (input: string, init?: RequestInit) =>
          durable.fetch(new Request(input, init)),
      }),
    },
    ...(adminToken ? { GALLERY_ADMIN_TOKEN: adminToken } : {}),
  };
}

const ORIGIN = "https://gallery.test";
const ADMIN_TOKEN = "secret-token";

function submissionRequest(
  body: unknown,
  overrides: {
    ip?: string;
    origin?: string | null;
    token?: string | null;
    cookie?: string;
  } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (overrides.origin !== null) {
    headers.set("Origin", overrides.origin ?? ORIGIN);
  }
  if (overrides.token !== null) {
    headers.set("Authorization", `Bearer ${overrides.token ?? ADMIN_TOKEN}`);
  }
  if (overrides.cookie) headers.set("Cookie", overrides.cookie);
  headers.set("CF-Connecting-IP", overrides.ip ?? "203.0.113.7");
  return new Request(`${ORIGIN}/api/gallery/submissions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function projectText(name = "Fixture"): string {
  return serializeProject(createEmptyProject("gallery-fixture", name));
}

function previousVersionText(): string {
  const raw = JSON.parse(projectText()) as { schemaVersion: number };
  raw.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION - 1;
  return JSON.stringify(raw);
}

async function route(env: GalleryEnv, request: Request) {
  const response = await routeGalleryRequest(request, env);
  if (!response) throw new Error("gallery route did not match");
  return response;
}

function adminHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function submitOne(
  env: GalleryEnv,
  name: string,
  overrides: { ip?: string; text?: string } = {},
): Promise<string> {
  const response = await route(
    env,
    submissionRequest(
      {
        name,
        author: "tz",
        description: "d",
        projectText: overrides.text ?? projectText(name),
      },
      { ip: overrides.ip ?? "203.0.113.7" },
    ),
  );
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { id: string };
  return payload.id;
}

describe("gallery submissions", () => {
  it("publishes immediately with canonical text and a server preview", async () => {
    const env = environment(ADMIN_TOKEN);
    const id = await submitOne(env, "Ring Oscillator");

    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    const listed = (await list.json()) as {
      entries: { id: string; name: string; schemaVersion: number }[];
    };
    expect(listed.entries.map((entry) => entry.id)).toEqual([id]);
    expect(listed.entries[0]).toMatchObject({
      name: "Ring Oscillator",
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    });

    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    expect(JSON.parse(payload.projectText)).toMatchObject({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      name: "Ring Oscillator",
    });

    const preview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );
    expect(preview.headers.get("content-type")).toBe("image/svg+xml");
    expect(await preview.text()).toContain("<svg");
  });

  it("upgrades a previous-schema submission through the protocol", async () => {
    const env = environment(ADMIN_TOKEN);
    const id = await submitOne(env, "Old Schema", {
      text: previousVersionText(),
    });
    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    expect(JSON.parse(payload.projectText).schemaVersion).toBe(
      CURRENT_PROJECT_SCHEMA_VERSION,
    );
  });

  it("refuses publishing without the admin bearer while sign-in is pending", async () => {
    const env = environment(ADMIN_TOKEN);
    const anonymous = await route(
      env,
      submissionRequest(
        { name: "X", projectText: projectText() },
        { token: null },
      ),
    );
    expect(anonymous.status).toBe(401);
    const wrongToken = await route(
      env,
      submissionRequest(
        { name: "X", projectText: projectText() },
        { token: "wrong" },
      ),
    );
    expect(wrongToken.status).toBe(401);
  });

  it("rejects invalid fields, foreign origins, oversized and invalid projects", async () => {
    const env = environment(ADMIN_TOKEN);
    const noName = await route(
      env,
      submissionRequest({ name: "  ", projectText: projectText() }),
    );
    expect(noName.status).toBe(400);

    const foreign = await route(
      env,
      submissionRequest(
        { name: "X", projectText: projectText() },
        { origin: "https://evil.example" },
      ),
    );
    expect(foreign.status).toBe(403);

    const oversized = await route(
      env,
      submissionRequest({
        name: "X",
        projectText: "x".repeat(GALLERY_MAX_PROJECT_BYTES + 1),
      }),
    );
    expect(oversized.status).toBe(413);

    const invalid = await route(
      env,
      submissionRequest({ name: "X", projectText: '{"schemaVersion":99}' }),
    );
    expect(invalid.status).toBe(400);
  });

  it("rate-limits one submitter per day without touching others", async () => {
    const env = environment(ADMIN_TOKEN);
    for (let index = 0; index < GALLERY_DAILY_SUBMISSION_LIMIT; index += 1) {
      await submitOne(env, `Entry ${index}`);
    }
    const overflow = await route(
      env,
      submissionRequest({ name: "One more", projectText: projectText() }),
    );
    expect(overflow.status).toBe(429);

    const other = await route(
      env,
      submissionRequest(
        { name: "Other submitter", projectText: projectText() },
        { ip: "198.51.100.2" },
      ),
    );
    expect(other.status).toBe(201);
  });
});

describe("gallery review queue with quality gates (phase G3)", () => {
  it("walks submit → pending (invisible) → approve → public", async () => {
    const { authDurable, env } = reviewHarness();
    const userCookie = await signIn(authDurable, "maker@example.com");
    const adminCookie = await signIn(authDurable, "owner@example.com");

    const submitted = await route(
      env,
      submissionRequest(
        { name: "Queued", projectText: wiredProjectText("Queued") },
        { token: null, cookie: userCookie },
      ),
    );
    expect(submitted.status).toBe(201);
    const { id, status } = (await submitted.json()) as {
      id: string;
      status: string;
    };
    expect(status).toBe("pending");

    // Invisible on every public surface.
    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    expect(((await list.json()) as { entries: unknown[] }).entries).toEqual([]);
    const anonymousDetail = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`),
    );
    expect(anonymousDetail.status).toBe(404);
    const anonymousPreview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );
    expect(anonymousPreview.status).toBe(404);

    // The owner and reviewers can see it; the queue lists it.
    const ownerPreview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`, {
        headers: { Cookie: userCookie },
      }),
    );
    expect(ownerPreview.status).toBe(200);
    const queue = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/review`, {
        headers: { Cookie: adminCookie },
      }),
    );
    const queued = (await queue.json()) as { entries: { id: string }[] };
    expect(queued.entries.map((entry) => entry.id)).toEqual([id]);
    const deniedQueue = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/review`, {
        headers: { Cookie: userCookie },
      }),
    );
    expect(deniedQueue.status).toBe(401);

    const approved = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/approve`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: adminCookie },
      }),
    );
    expect(approved.status).toBe(200);
    const publicList = await route(env, new Request(`${ORIGIN}/api/gallery`));
    expect(
      ((await publicList.json()) as { entries: { id: string }[] }).entries.map(
        (entry) => entry.id,
      ),
    ).toEqual([id]);
  });

  it("rejects with a stored reason the owner sees; moderators can review", async () => {
    const { authDurable, env } = reviewHarness();
    const userCookie = await signIn(authDurable, "maker@example.com");
    const modCookie = await signIn(authDurable, "reviewer@example.com");
    const adminCookie = await signIn(authDurable, "owner@example.com");
    await authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/users/role`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: adminCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "reviewer@example.com",
          role: "moderator",
        }),
      }),
    );

    const submitted = await route(
      env,
      submissionRequest(
        { name: "Refused", projectText: wiredProjectText("Refused") },
        { token: null, cookie: userCookie },
      ),
    );
    const { id } = (await submitted.json()) as { id: string };

    const rejected = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/reject`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: modCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "Needs net labels" }),
      }),
    );
    expect(rejected.status).toBe(200);

    const mine = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/mine`, {
        headers: { Cookie: userCookie },
      }),
    );
    const entries = (await mine.json()) as {
      entries: { id: string; status: string; rejectReason: string | null }[];
    };
    expect(entries.entries).toMatchObject([
      { id, status: "rejected", rejectReason: "Needs net labels" },
    ]);

    // A decided entry cannot be re-reviewed.
    const again = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/approve`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: modCookie },
      }),
    );
    expect(again.status).toBe(409);
  });

  it("blocks gate failures for ordinary users and bypasses them for admins", async () => {
    const { authDurable, env } = reviewHarness();
    const userCookie = await signIn(authDurable, "maker@example.com");

    const gated = await route(
      env,
      submissionRequest(
        { name: "Empty", projectText: projectText("Empty") },
        { token: null, cookie: userCookie },
      ),
    );
    expect(gated.status).toBe(422);
    const payload = (await gated.json()) as {
      error: string;
      failures: { code: string }[];
    };
    expect(payload.error).toBe("quality-gate");
    expect(payload.failures.map((failure) => failure.code)).toContain(
      "empty-project",
    );

    // The bearer (owner) publishes the same empty project directly.
    const viaBearer = await route(
      env,
      submissionRequest({ name: "Empty", projectText: projectText("Empty") }),
    );
    expect(viaBearer.status).toBe(201);
    expect(((await viaBearer.json()) as { status: string }).status).toBe(
      "public",
    );

    // A moderator submission also publishes directly.
    const adminCookie = await signIn(authDurable, "owner@example.com");
    const viaAdmin = await route(
      env,
      submissionRequest(
        { name: "Admin Empty", projectText: projectText("Admin Empty") },
        { token: null, cookie: adminCookie },
      ),
    );
    expect(viaAdmin.status).toBe(201);
    expect(((await viaAdmin.json()) as { status: string }).status).toBe(
      "public",
    );
  });
});

function reviewHarness() {
  const authDurable = new AuthDO(sqliteState(), {
    RESEND_API_KEY: "rk",
    ADMIN_EMAILS: "owner@example.com",
  } as AuthEnv);
  const env: GalleryEnv = {
    ...environment(ADMIN_TOKEN),
    AUTH: {
      getByName: () => ({
        fetch: (input: Request | string, init?: RequestInit) =>
          authDurable.fetch(
            typeof input === "string" ? new Request(input, init) : input,
          ),
      }),
    },
  };
  return { authDurable, env };
}

async function signIn(authDurable: AuthDO, email: string): Promise<string> {
  const sent: string[] = [];
  authDurable.fetchLike = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    void input;
    sent.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return Response.json({ id: "email-1" });
  }) as typeof fetch;
  await authDurable.fetch(
    new Request(`${ORIGIN}/api/auth/email/start`, {
      method: "POST",
      headers: { Origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  const link = sent[0]!.match(/https?:\/\/\S+/u)![0];
  const callback = await authDurable.fetch(new Request(link));
  return callback.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("icm_session="))!
    .split(";")[0]!;
}

function wiredProjectText(name = "Wired"): string {
  const project = createEmptyProject("g3", name);
  const document = project.documents[0]!;
  document.instances = [
    {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R1", parameters: {} },
    },
    {
      id: "R2",
      symbolId: "resistor",
      placement: {
        position: { x: 200, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R2", parameters: {} },
    },
  ];
  document.nets = [
    {
      id: "n1",
      scope: "local",
      terminals: [
        { instanceId: "R1", pinName: "1" },
        { instanceId: "R2", pinName: "1" },
      ],
    },
    {
      id: "n2",
      scope: "local",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "2" },
      ],
    },
  ];
  return serializeProject(project);
}

describe("gallery circuit tags", () => {
  it("normalizes tags on write, filters as an OR-union, and aggregates", async () => {
    const env = environment(ADMIN_TOKEN);
    const submitTagged = (name: string, tags: unknown) =>
      route(
        env,
        submissionRequest({ name, tags, projectText: projectText(name) }),
      );
    await submitTagged("Amp A", ["  Amplifier ", "OTA", "amplifier"]);
    await submitTagged("Comp B", ["comparator"]);
    await submitTagged("Mixed C", ["ADC", "amplifier "]);
    await submitTagged("Plain D", "not-an-array");

    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    const all = (await list.json()) as {
      entries: { name: string; tags: string[] }[];
    };
    expect(all.entries.find((entry) => entry.name === "Amp A")?.tags).toEqual([
      "amplifier",
      "ota",
    ]);
    expect(all.entries.find((entry) => entry.name === "Plain D")?.tags).toEqual(
      [],
    );

    const union = await route(
      env,
      new Request(`${ORIGIN}/api/gallery?tags=comparator,adc`),
    );
    const filtered = (await union.json()) as { entries: { name: string }[] };
    expect(filtered.entries.map((entry) => entry.name).sort()).toEqual([
      "Comp B",
      "Mixed C",
    ]);

    const aggregate = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/tags`),
    );
    const counts = (await aggregate.json()) as {
      tags: { tag: string; count: number }[];
    };
    expect(counts.tags[0]).toEqual({ tag: "amplifier", count: 2 });

    // The bearer update path rewrites tags ("editable any time").
    const target = all.entries.find((entry) => entry.name === "Comp B")!;
    const detail = await route(
      env,
      new Request(`${ORIGIN}/api/gallery?limit=60`),
    );
    void detail;
    const id = (
      (await (
        await route(env, new Request(`${ORIGIN}/api/gallery`))
      ).json()) as {
        entries: { id: string; name: string }[];
      }
    ).entries.find((entry) => entry.name === "Comp B")!.id;
    const updated = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: target.name,
          tags: ["latch", "comparator"],
          projectText: projectText(target.name),
        }),
      }),
    );
    expect(updated.status).toBe(200);
    const after = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))
    ).json()) as { entry: { tags: string[] } };
    expect(after.entry.tags).toEqual(["latch", "comparator"]);
  });
});

describe("gallery list author filter and paging (phase G4)", () => {
  it("filters by exact byline and pages the filtered set", async () => {
    const env = environment(ADMIN_TOKEN);
    for (const [name, author] of [
      ["A1", "alice"],
      ["B1", "bob"],
      ["A2", "alice"],
      ["A3", "alice"],
    ] as const) {
      await route(
        env,
        submissionRequest({ name, author, projectText: projectText(name) }),
      );
    }

    const filtered = await route(
      env,
      new Request(`${ORIGIN}/api/gallery?author=alice&limit=2`),
    );
    const first = (await filtered.json()) as {
      entries: { name: string; author: string }[];
      nextCursor: string | null;
    };
    expect(first.entries.every((entry) => entry.author === "alice")).toBe(true);
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery?author=alice&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
      ),
    );
    const rest = (await second.json()) as {
      entries: { name: string }[];
      nextCursor: string | null;
    };
    expect(rest.entries).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();

    const unfiltered = await route(env, new Request(`${ORIGIN}/api/gallery`));
    expect(
      ((await unfiltered.json()) as { entries: unknown[] }).entries,
    ).toHaveLength(4);
  });
});

describe("gallery owner editing (phase G3 completion)", () => {
  it("owner updates re-enter review and clear the previous rejection", async () => {
    const { authDurable, env } = reviewHarness();
    const ownerCookie = await signIn(authDurable, "maker@example.com");
    const adminCookie = await signIn(authDurable, "owner@example.com");
    const strangerCookie = await signIn(authDurable, "other@example.com");

    const submitted = await route(
      env,
      submissionRequest(
        { name: "Edit Me", projectText: wiredProjectText("Edit Me") },
        { token: null, cookie: ownerCookie },
      ),
    );
    const { id } = (await submitted.json()) as { id: string };
    await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/reject`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: adminCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "Wrong polarity" }),
      }),
    );

    function updateRequest(cookie: string | null, token = false): Request {
      const headers = new Headers({
        "content-type": "application/json",
        Origin: ORIGIN,
      });
      if (cookie) headers.set("Cookie", cookie);
      if (token) headers.set("Authorization", `Bearer ${ADMIN_TOKEN}`);
      return new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          name: "Edit Me v2",
          author: "maker",
          projectText: wiredProjectText("Edit Me v2"),
        }),
      });
    }

    const stranger = await route(env, updateRequest(strangerCookie));
    expect(stranger.status).toBe(403);
    const anonymous = await route(env, updateRequest(null));
    expect(anonymous.status).toBe(401);

    const updated = await route(env, updateRequest(ownerCookie));
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { status: string }).status).toBe(
      "pending",
    );

    const mine = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/mine`, {
        headers: { Cookie: ownerCookie },
      }),
    );
    const entries = (await mine.json()) as {
      entries: { name: string; status: string; rejectReason: string | null }[];
    };
    expect(entries.entries).toMatchObject([
      { name: "Edit Me v2", status: "pending", rejectReason: null },
    ]);

    // Approve, then an admin edit keeps the entry public.
    await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/approve`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: adminCookie },
      }),
    );
    const adminEdit = await route(env, updateRequest(adminCookie));
    expect(((await adminEdit.json()) as { status: string }).status).toBe(
      "public",
    );

    // An empty replacement fails the gates for the ordinary owner.
    const gated = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: ownerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Empty", projectText: projectText() }),
      }),
    );
    expect(gated.status).toBe(422);

    // The detail response names the owner so the editor can offer updates.
    const detail = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        headers: { Cookie: ownerCookie },
      }),
    );
    const payload = (await detail.json()) as { ownerUserId: string | null };
    expect(typeof payload.ownerUserId).toBe("string");
  });
});

describe("gallery admin sessions (phase G2)", () => {
  async function sessionCookieFor(
    authDurable: AuthDO,
    email: string,
  ): Promise<string> {
    const sent: string[] = [];
    authDurable.fetchLike = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      void input;
      sent.push((JSON.parse(String(init?.body)) as { text: string }).text);
      return Response.json({ id: "email-1" });
    }) as typeof fetch;
    const start = await authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/email/start`, {
        method: "POST",
        headers: { Origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    );
    expect(start.status).toBe(202);
    const link = sent[0]!.match(/https?:\/\/\S+/u)![0];
    const callback = await authDurable.fetch(new Request(link));
    const header = callback.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("icm_session="));
    return header!.split(";")[0]!;
  }

  it("accepts an admin session in place of the bearer and refuses others", async () => {
    const authDurable = new AuthDO(sqliteState(), {
      RESEND_API_KEY: "rk",
      ADMIN_EMAILS: "owner@example.com",
    } as AuthEnv);
    const env: GalleryEnv = {
      ...environment(ADMIN_TOKEN),
      AUTH: {
        getByName: () => ({
          fetch: (input: Request | string, init?: RequestInit) =>
            authDurable.fetch(
              typeof input === "string" ? new Request(input, init) : input,
            ),
        }),
      },
    };

    const adminCookie = await sessionCookieFor(
      authDurable,
      "owner@example.com",
    );
    const viaSession = await route(
      env,
      submissionRequest(
        { name: "Session Published", projectText: projectText() },
        { token: null, cookie: adminCookie },
      ),
    );
    expect(viaSession.status).toBe(201);

    // An ordinary session is no longer refused outright (phase G3): it
    // goes through the quality gates instead — the empty fixture fails
    // them — and never publishes directly.
    const ordinaryCookie = await sessionCookieFor(
      authDurable,
      "visitor@example.com",
    );
    const viaOrdinary = await route(
      env,
      submissionRequest(
        { name: "Gated", projectText: projectText() },
        { token: null, cookie: ordinaryCookie },
      ),
    );
    expect(viaOrdinary.status).toBe(422);

    const recycledList = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/recycled`, {
        headers: { Cookie: adminCookie },
      }),
    );
    expect(recycledList.status).toBe(200);
  });
});

describe("gallery administration", () => {
  it("requires the bearer secret for every admin operation", async () => {
    const env = environment(ADMIN_TOKEN);
    const id = await submitOne(env, "Guarded");

    const anonymous = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/recycle`, { method: "POST" }),
    );
    expect(anonymous.status).toBe(401);

    const noTokenConfigured = environment();
    const impossible = await route(
      noTokenConfigured,
      new Request(`${ORIGIN}/api/gallery/some-id/recycle`, {
        method: "POST",
        headers: adminHeaders("anything"),
      }),
    );
    expect(impossible.status).toBe(401);
  });

  it("recycles, hides, restores, and only hard-deletes from the bin", async () => {
    const token = ADMIN_TOKEN;
    const env = environment(token);
    const id = await submitOne(env, "Lifecycle");

    const earlyDelete = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "DELETE",
        headers: adminHeaders(token),
      }),
    );
    expect(earlyDelete.status).toBe(409);

    const recycle = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/recycle`, {
        method: "POST",
        headers: adminHeaders(token),
      }),
    );
    expect(recycle.status).toBe(200);

    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    expect(((await list.json()) as { entries: unknown[] }).entries).toEqual([]);
    const hidden = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    expect(hidden.status).toBe(404);

    const bin = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/recycled`, {
        headers: adminHeaders(token),
      }),
    );
    const binned = (await bin.json()) as { entries: { id: string }[] };
    expect(binned.entries.map((entry) => entry.id)).toEqual([id]);

    const restore = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/restore`, {
        method: "POST",
        headers: adminHeaders(token),
      }),
    );
    expect(restore.status).toBe(200);
    const back = await route(env, new Request(`${ORIGIN}/api/gallery`));
    expect(
      ((await back.json()) as { entries: { id: string }[] }).entries,
    ).toHaveLength(1);

    await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/recycle`, {
        method: "POST",
        headers: adminHeaders(token),
      }),
    );
    const remove = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "DELETE",
        headers: adminHeaders(token),
      }),
    );
    expect(remove.status).toBe(200);
    const gone = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/recycled`, {
        headers: adminHeaders(token),
      }),
    );
    expect(((await gone.json()) as { entries: unknown[] }).entries).toEqual([]);
  });

  it("re-serializes stored entries back into the rolling window", async () => {
    const token = ADMIN_TOKEN;
    const env = environment(token);
    const id = await submitOne(env, "Aging Entry");

    // Age the stored record to the previous schema version through the
    // internal update operation, simulating a record left behind by time.
    await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/update-entry",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          projectText: previousVersionText(),
          schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION - 1,
          svgText: "<svg/>",
        }),
      },
    );

    const maintenance = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/reserialize`, {
        method: "POST",
        headers: adminHeaders(token),
      }),
    );
    const report = (await maintenance.json()) as {
      upgraded: number;
      failed: unknown[];
    };
    expect(report).toMatchObject({ upgraded: 1, failed: [] });

    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as {
      entry: { schemaVersion: number };
      projectText: string;
    };
    expect(payload.entry.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(payload.projectText).schemaVersion).toBe(
      CURRENT_PROJECT_SCHEMA_VERSION,
    );
    const preview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );
    expect(await preview.text()).toContain("<svg");
  });
});
