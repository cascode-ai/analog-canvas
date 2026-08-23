import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import {
  GALLERY_DAILY_SUBMISSION_LIMIT,
  GALLERY_MAX_PROJECT_BYTES,
  GalleryDO,
  routeGalleryRequest,
  SHORT_ID_LENGTH,
  shortId,
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

type Harness = GalleryEnv & {
  authDurable: AuthDO;
  /** The gallery's own storage, for seeding rows a route cannot create. */
  gallerySql: ReturnType<typeof sqliteState>["storage"]["sql"];
};

/**
 * One harness for every test: a gallery DO plus the auth DO that is now the
 * only way to publish anything.
 */
function environment(): Harness {
  const galleryState = sqliteState();
  const durable = new GalleryDO(galleryState);
  const authDurable = new AuthDO(sqliteState(), {
    RESEND_API_KEY: "rk",
    ADMIN_EMAILS: "owner@example.com",
  } as AuthEnv);
  return {
    GALLERY: {
      getByName: () => ({
        fetch: (input: string, init?: RequestInit) =>
          durable.fetch(new Request(input, init)),
      }),
    },
    AUTH: {
      getByName: () => ({
        fetch: (input: Request | string, init?: RequestInit) =>
          authDurable.fetch(
            typeof input === "string" ? new Request(input, init) : input,
          ),
      }),
    },
    authDurable,
    gallerySql: galleryState.storage.sql,
  };
}

const ORIGIN = "https://gallery.test";

function submissionRequest(
  body: unknown,
  overrides: {
    ip?: string;
    origin?: string | null;
    cookie?: string;
  } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (overrides.origin !== null) {
    headers.set("Origin", overrides.origin ?? ORIGIN);
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

function previousPowerRailVersionText(): string {
  const raw = JSON.parse(projectText("Legacy VDD")) as any;
  raw.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION - 1;
  const document = raw.documents[0];
  delete document.connectivityEvidence;
  document.nets.push({
    id: "net-vdd",
    name: "VDD",
    scope: "global",
    powerDomain: "vdd",
    origin: { kind: "authored" },
    terminals: [],
  });
  document.junctions.push(
    {
      id: "junction-vdd-left",
      netId: "net-vdd",
      position: { x: 20, y: 20 },
      role: "route-anchor",
    },
    {
      id: "junction-vdd-right",
      netId: "net-vdd",
      position: { x: 80, y: 20 },
      role: "route-anchor",
    },
  );
  document.routes.push({
    id: "route-vdd",
    netId: "net-vdd",
    from: { kind: "junction", junctionId: "junction-vdd-left" },
    to: { kind: "junction", junctionId: "junction-vdd-right" },
    waypoints: [],
    segmentModes: ["manual"],
    presentation: "power-rail",
  });
  document.annotations.push({
    id: "label-vdd",
    kind: "power-label",
    binding: { kind: "net-name", netId: "net-vdd" },
    netId: "net-vdd",
    anchor: { kind: "free", position: { x: 90, y: 20 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  return JSON.stringify(raw);
}

function brokenCurrentPowerRailText(): string {
  const raw = JSON.parse(previousPowerRailVersionText()) as any;
  raw.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION;
  raw.documents[0].connectivityEvidence = [
    {
      id: "legacy-explicit-vdd",
      kind: "name-claim",
      netId: "net-vdd",
      name: "VDD",
      owner: { kind: "explicit-net-property" },
      scope: "global",
    },
    {
      id: "legacy-label-vdd",
      kind: "name-claim",
      netId: "net-vdd",
      name: "VDD",
      owner: { kind: "net-label", annotationId: "label-vdd" },
      scope: "global",
    },
  ];
  return JSON.stringify(raw);
}

async function route(env: GalleryEnv, request: Request) {
  const response = await routeGalleryRequest(request, env);
  if (!response) throw new Error("gallery route did not match");
  return response;
}

function cookieHeaders(cookie: string): HeadersInit {
  return { Cookie: cookie };
}

/** A curator session: exempt from the gates and the daily quota. */
function adminOf(env: Harness): Promise<string> {
  return signIn(env.authDurable, "owner@example.com");
}

/** An ordinary member: gated and quota-limited, but publishes directly. */
function makerOf(env: Harness): Promise<string> {
  return signIn(env.authDurable, "maker@example.com");
}

async function submitOne(
  env: Harness,
  name: string,
  overrides: { ip?: string; text?: string; cookie?: string } = {},
): Promise<string> {
  const response = await route(
    env,
    submissionRequest(
      {
        name,
        description: "d",
        projectText: overrides.text ?? projectText(name),
      },
      {
        ip: overrides.ip ?? "203.0.113.7",
        cookie: overrides.cookie ?? (await adminOf(env)),
      },
    ),
  );
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { id: string };
  return payload.id;
}

describe("endless shuffled feed", () => {
  async function seededPage(
    env: Harness,
    seed: string,
    cursor?: string,
  ): Promise<{ ids: string[]; nextCursor: string | null; total: number }> {
    const params = new URLSearchParams({ seed, limit: "3" });
    if (cursor) params.set("cursor", cursor);
    const response = await route(
      env,
      new Request(`${ORIGIN}/api/gallery?${params.toString()}`),
    );
    const payload = (await response.json()) as {
      entries: { id: string }[];
      nextCursor: string | null;
      total: number;
    };
    return {
      ids: payload.entries.map((entry) => entry.id),
      nextCursor: payload.nextCursor,
      total: payload.total,
    };
  }

  async function wallOf(env: Harness, count: number): Promise<string[]> {
    const cookie = await adminOf(env);
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(await submitOne(env, `Circuit ${index}`, { cookie }));
    }
    return ids;
  }

  it("pages one shuffle without repeating or skipping a circuit", async () => {
    const env = environment();
    const wall = await wallOf(env, 7);

    const first = await seededPage(env, "seed-a");
    expect(first.total).toBe(7);
    const second = await seededPage(env, "seed-a", first.nextCursor!);
    const third = await seededPage(env, "seed-a", second.nextCursor!);
    expect(third.nextCursor).toBeNull();

    const seen = [...first.ids, ...second.ids, ...third.ids];
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual([...wall].sort());
  });

  it("gives the same order to the same seed and a different one to another", async () => {
    const env = environment();
    await wallOf(env, 7);
    const again = await seededPage(env, "seed-a");
    const same = await seededPage(env, "seed-a");
    expect(same.ids).toEqual(again.ids);

    // Some seed orders the wall differently; the feed would be pointless if
    // every visit saw the same column.
    const orders = await Promise.all(
      ["s1", "s2", "s3", "s4", "s5"].map((seed) => seededPage(env, seed)),
    );
    expect(orders.some((order) => order.ids.join() !== again.ids.join())).toBe(
      true,
    );
  });

  it("reports an exhausted round apart from an empty wall", async () => {
    const env = environment();
    // Nothing published: no next page and nothing to come back to, which is
    // what tells the feed to stop rather than loop forever.
    const empty = await seededPage(env, "seed-a");
    expect(empty).toMatchObject({ ids: [], nextCursor: null, total: 0 });

    await wallOf(env, 2);
    const full = await seededPage(env, "seed-a");
    expect(full.nextCursor).toBeNull();
    expect(full.total).toBe(2);
  });

  it("keeps newest-first when no seed is asked for", async () => {
    const env = environment();
    await wallOf(env, 3);
    const plain = await route(env, new Request(`${ORIGIN}/api/gallery`));
    const payload = (await plain.json()) as { entries: { name: string }[] };
    expect(payload.entries.map((entry) => entry.name)).toEqual([
      "Circuit 2",
      "Circuit 1",
      "Circuit 0",
    ]);
  });
});

describe("stars and thumbs", () => {
  function likeRequest(id: string, cookie?: string): Request {
    const headers = new Headers({ Origin: ORIGIN });
    if (cookie) headers.set("Cookie", cookie);
    return new Request(`${ORIGIN}/api/gallery/${id}/like`, {
      method: "POST",
      headers,
    });
  }

  async function feed(env: Harness, cookie?: string) {
    const response = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery`,
        cookie ? { headers: cookieHeaders(cookie) } : undefined,
      ),
    );
    return (await response.json()) as {
      entries: {
        id: string;
        netlistable: boolean;
        likes: number;
        likedByViewer: boolean;
      }[];
    };
  }

  it("records whether a circuit extracts, and publishes both alike", async () => {
    const env = environment();
    const cookie = await adminOf(env);

    // An ideal switch has no reviewed netlist definition, so this circuit
    // does not extract. That is a legitimate schematic, not a mistake: it is
    // published exactly like any other and simply wears no star.
    const sketch = createEmptyProject("sketch", "Sketch");
    sketch.documents[0]!.instances.push({
      id: "S1",
      symbolId: "ideal-switch",
      schematicReference: "S1",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    const sketchId = await submitOne(env, "Sketch", {
      cookie,
      text: serializeProject(sketch),
    });
    const extractableId = await submitOne(env, "Extractable", { cookie });

    const listed = await feed(env);
    const byId = new Map(listed.entries.map((entry) => [entry.id, entry]));
    expect(byId.get(sketchId)!.netlistable).toBe(false);
    expect(byId.get(extractableId)!.netlistable).toBe(true);
    // Both are on the wall; the star separates them, nothing else does.
    expect(listed.entries).toHaveLength(2);
  });

  it("counts one thumb per account and takes it back on a second press", async () => {
    const env = environment();
    const owner = await adminOf(env);
    const id = await submitOne(env, "Liked", { cookie: owner });
    const other = await makerOf(env);

    const first = await route(env, likeRequest(id, other));
    expect(await first.json()).toEqual({ likes: 1, likedByViewer: true });
    // Pressing again is not a second thumb; it is taking the thumb back.
    const second = await route(env, likeRequest(id, other));
    expect(await second.json()).toEqual({ likes: 0, likedByViewer: false });

    await route(env, likeRequest(id, other));
    await route(env, likeRequest(id, owner));
    const listed = await feed(env, other);
    expect(listed.entries[0]!.likes).toBe(2);
    expect(listed.entries[0]!.likedByViewer).toBe(true);
  });

  it("shows counts to a signed-out visitor without claiming they liked it", async () => {
    const env = environment();
    const owner = await adminOf(env);
    const id = await submitOne(env, "Public", { cookie: owner });
    await route(env, likeRequest(id, owner));

    const anonymous = await feed(env);
    expect(anonymous.entries[0]!.likes).toBe(1);
    expect(anonymous.entries[0]!.likedByViewer).toBe(false);
    // And a thumb needs an account.
    expect((await route(env, likeRequest(id))).status).toBe(401);
  });

  it("refuses a thumb for a circuit that is not on the wall", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    expect((await route(env, likeRequest("nosuchid", cookie))).status).toBe(
      404,
    );
  });
});

describe("circuit addresses", () => {
  it("gives a new circuit a short, readable id", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Short", { cookie });
    expect(id).toHaveLength(SHORT_ID_LENGTH);
    // No characters that get misread off a screen: 0/o, 1/l/i, u.
    expect(id).toMatch(/^[23456789abcdefghjkmnpqrstvwxyz]+$/u);

    // And it is the address: the entry is readable at exactly that id.
    const entry = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    expect(entry.status).toBe(200);
  });

  it("keeps drawing distinct ids", () => {
    const drawn = new Set(Array.from({ length: 500 }, () => shortId()));
    expect(drawn.size).toBe(500);
  });

  it("still serves an entry that was given a long id", async () => {
    // Shortening changes what new links look like; it must never strand an
    // address someone already shared.
    const env = environment();
    const legacy = "0f9d2c4e-1a3b-4c5d-8e7f-102030405060";
    env.gallerySql.exec(
      `INSERT INTO gallery_entries(
         id, name, author, description, created_at, schema_version,
         status, recycled_at, owner_user_id, submitter_email,
         submitter_provider, tags, project_text, svg_text
       ) VALUES (?, ?, ?, ?, ?, ?, 'public', NULL, NULL, NULL, NULL, '', ?, '')`,
      legacy,
      "Old Link",
      "Someone",
      "",
      new Date().toISOString(),
      CURRENT_PROJECT_SCHEMA_VERSION,
      projectText("Old Link"),
    );
    const served = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${legacy}`),
    );
    expect(served.status).toBe(200);
    expect((await served.json()).entry.name).toBe("Old Link");
  });
});

describe("account workspace shelf", () => {
  function saveRequest(cookie: string, name: string): Request {
    return new Request(`${ORIGIN}/api/workspace/recent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: ORIGIN,
        Cookie: cookie,
      },
      body: JSON.stringify({ name, projectText: projectText(name) }),
    });
  }

  it("keeps only the newest three circuits per account", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    for (const name of ["One", "Two", "Three", "Four"]) {
      const saved = await route(env, saveRequest(cookie, name));
      expect(saved.status).toBe(200);
    }
    const listed = await route(
      env,
      new Request(`${ORIGIN}/api/workspace/recent`, {
        headers: cookieHeaders(cookie),
      }),
    );
    const { slots } = (await listed.json()) as {
      slots: { name: string; id: string }[];
    };
    expect(slots.map((slot) => slot.name)).toEqual(["Four", "Three", "Two"]);
  });

  it("is private to the account that saved it", async () => {
    const env = environment();
    const mine = await makerOf(env);
    const saved = await route(env, saveRequest(mine, "Private"));
    const { slots } = (await saved.json()) as { slots: { id: string }[] };
    const slotId = slots[0]!.id;

    const stranger = await adminOf(env);
    const strangerRead = await route(
      env,
      new Request(`${ORIGIN}/api/workspace/recent/${slotId}`, {
        headers: cookieHeaders(stranger),
      }),
    );
    // An id is not a capability: even an admin reads only their own shelf.
    expect(strangerRead.status).toBe(404);
    const strangerList = await route(
      env,
      new Request(`${ORIGIN}/api/workspace/recent`, {
        headers: cookieHeaders(stranger),
      }),
    );
    expect((await strangerList.json()).slots).toEqual([]);

    const own = await route(
      env,
      new Request(`${ORIGIN}/api/workspace/recent/${slotId}`, {
        headers: cookieHeaders(mine),
      }),
    );
    expect(own.status).toBe(200);
    expect((await own.json()).projectText).toContain("Private");
  });

  it("refuses a signed-out visitor and an oversized or unparseable project", async () => {
    const env = environment();
    const anonymous = await route(
      env,
      new Request(`${ORIGIN}/api/workspace/recent`),
    );
    expect(anonymous.status).toBe(401);

    const cookie = await makerOf(env);
    const oversized = await route(
      env,
      new Request(`${ORIGIN}/api/workspace/recent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: JSON.stringify({
          name: "Huge",
          projectText: "x".repeat(GALLERY_MAX_PROJECT_BYTES + 1),
        }),
      }),
    );
    expect(oversized.status).toBe(413);

    const unparseable = await route(
      env,
      new Request(`${ORIGIN}/api/workspace/recent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: JSON.stringify({ name: "Broken", projectText: "{" }),
      }),
    );
    expect(unparseable.status).toBe(400);
  });

  it("saves whatever was checked, gates and all", async () => {
    // The shelf is not the Gallery: nobody else sees it, so an unfinished
    // circuit that would fail a submission gate still has to be keepable.
    const env = environment();
    const cookie = await makerOf(env);
    const empty = serializeProject(createEmptyProject("blank", "Blank"));
    const saved = await route(
      env,
      new Request(`${ORIGIN}/api/workspace/recent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: JSON.stringify({ name: "Blank", projectText: empty }),
      }),
    );
    expect(saved.status).toBe(200);
  });
});

describe("gallery submissions", () => {
  it("publishes immediately with canonical text and a server preview", async () => {
    const env = environment();
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
    const env = environment();
    const id = await submitOne(env, "Old Schema", {
      text: previousVersionText(),
    });
    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    expect(JSON.parse(payload.projectText).schemaVersion).toBe(
      CURRENT_PROJECT_SCHEMA_VERSION,
    );
  });

  it("preserves previous-schema VDD rail semantics in stored text and preview", async () => {
    const env = environment();
    const id = await submitOne(env, "Legacy VDD", {
      text: previousPowerRailVersionText(),
    });
    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    const stored = JSON.parse(payload.projectText) as any;
    expect(stored.documents[0].connectivityEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "name-claim",
          netId: "net-vdd",
          name: "VDD",
          powerDomain: "vdd",
          owner: { kind: "power-marker", objectId: "label-vdd" },
        }),
      ]),
    );

    const preview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );
    const svg = await preview.text();
    expect(svg).toContain('data-route-presentation="power-rail"');
    expect(svg).toContain('stroke-width="3.24"');
  });

  it("refuses an anonymous submission: a session is the whole gate", async () => {
    const env = environment();
    const anonymous = await route(
      env,
      submissionRequest({ name: "X", projectText: projectText() }),
    );
    expect(anonymous.status).toBe(401);

    // There is no passphrase to fall back on: a bearer header buys nothing.
    const withBearer = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/submissions`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          "content-type": "application/json",
          Authorization: "Bearer secret-token",
        },
        body: JSON.stringify({ name: "X", projectText: projectText() }),
      }),
    );
    expect(withBearer.status).toBe(401);
  });

  it("publishes an ordinary member's circuit straight to the wall", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const response = await route(
      env,
      submissionRequest(
        { name: "Direct", projectText: wiredProjectText("Direct") },
        { cookie },
      ),
    );
    expect(response.status).toBe(201);
    const { id, status } = (await response.json()) as {
      id: string;
      status: string;
    };
    expect(status).toBe("public");

    // Visible to everyone immediately: no queue, no approval step.
    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    expect(
      ((await list.json()) as { entries: { id: string }[] }).entries.map(
        (entry) => entry.id,
      ),
    ).toEqual([id]);
    expect(
      (await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))).status,
    ).toBe(200);
  });

  it("takes the byline from the account, not from the request", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const response = await route(
      env,
      submissionRequest(
        {
          name: "Claimed",
          author: "someone-else",
          projectText: wiredProjectText("Claimed"),
        },
        { cookie },
      ),
    );
    const { id } = (await response.json()) as { id: string };
    const detail = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))
    ).json()) as { entry: { author: string } };
    expect(detail.entry.author).toBe("maker");
  });

  it("records the submitting identity and shows it only to a curator", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const adminCookie = await adminOf(env);
    const response = await route(
      env,
      submissionRequest(
        { name: "Traced", projectText: wiredProjectText("Traced") },
        { cookie },
      ),
    );
    const { id } = (await response.json()) as { id: string };

    const asCurator = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}`, {
          headers: cookieHeaders(adminCookie),
        }),
      )
    ).json()) as { submitterEmail?: string; submitterProvider?: string };
    expect(asCurator).toMatchObject({
      submitterEmail: "maker@example.com",
      submitterProvider: "email",
    });

    // The wall shows a byline; it does not show anybody's email address.
    const asVisitor = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))
    ).json()) as Record<string, unknown>;
    expect(asVisitor).not.toHaveProperty("submitterEmail");
    expect(asVisitor).not.toHaveProperty("submitterProvider");
  });

  it("rejects invalid fields, foreign origins, oversized and invalid projects", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const noName = await route(
      env,
      submissionRequest({ name: "  ", projectText: projectText() }, { cookie }),
    );
    expect(noName.status).toBe(400);

    const foreign = await route(
      env,
      submissionRequest(
        { name: "X", projectText: projectText() },
        { origin: "https://evil.example", cookie },
      ),
    );
    expect(foreign.status).toBe(403);

    const oversized = await route(
      env,
      submissionRequest(
        {
          name: "X",
          projectText: "x".repeat(GALLERY_MAX_PROJECT_BYTES + 1),
        },
        { cookie },
      ),
    );
    expect(oversized.status).toBe(413);

    const invalid = await route(
      env,
      submissionRequest(
        { name: "X", projectText: '{"schemaVersion":99}' },
        { cookie },
      ),
    );
    expect(invalid.status).toBe(400);
  });

  it("rate-limits ordinary submitters per day; curators are exempt", async () => {
    const env = environment();

    // Ordinary submissions (limit enforced) exhaust the day, without
    // touching a different submitter.
    async function submitDirect(hash: string): Promise<number> {
      const response = await env.GALLERY.getByName("gallery").fetch(
        "https://gallery/submit",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            day: "2026-08-22",
            submitterHash: hash,
            enforceLimit: true,
            entry: {
              id: crypto.randomUUID(),
              name: "Quota",
              author: "",
              description: "",
              created_at: "2026-08-22T00:00:00.000Z",
              schema_version: 21,
              project_text: projectText(),
              svg_text: "<svg/>",
            },
          }),
        },
      );
      return response.status;
    }
    for (let index = 0; index < GALLERY_DAILY_SUBMISSION_LIMIT; index += 1) {
      expect(await submitDirect("hash-a")).toBe(200);
    }
    expect(await submitDirect("hash-a")).toBe(429);
    expect(await submitDirect("hash-b")).toBe(200);

    // A curator is exempt: more than the limit, all accepted.
    const adminCookie = await adminOf(env);
    for (
      let index = 0;
      index < GALLERY_DAILY_SUBMISSION_LIMIT + 2;
      index += 1
    ) {
      await submitOne(env, `Curated ${index}`, { cookie: adminCookie });
    }
  });
});

describe("direct publishing (the review queue is retired)", () => {
  it("keeps the gates blocking for a member and open for a curator", async () => {
    const env = environment();
    const cookie = await makerOf(env);

    const gated = await route(
      env,
      submissionRequest(
        { name: "Empty", projectText: projectText("Empty") },
        { cookie },
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

    // A curator curates: the same empty project goes straight up.
    const adminCookie = await adminOf(env);
    const viaAdmin = await route(
      env,
      submissionRequest(
        { name: "Admin Empty", projectText: projectText("Admin Empty") },
        { cookie: adminCookie },
      ),
    );
    expect(viaAdmin.status).toBe(201);
    expect(((await viaAdmin.json()) as { status: string }).status).toBe(
      "public",
    );
  });

  it("has no queue to read and no decision to hand down", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Live", { cookie: adminCookie });

    for (const [path, method] of [
      [`${ORIGIN}/api/gallery/review`, "GET"],
      [`${ORIGIN}/api/gallery/${id}/approve`, "POST"],
      [`${ORIGIN}/api/gallery/${id}/reject`, "POST"],
    ] as const) {
      const response = await route(
        env,
        new Request(path, {
          method,
          headers: { Origin: ORIGIN, Cookie: adminCookie },
        }),
      );
      expect(response.status).toBe(404);
    }
  });

  it("publishes an entry stranded in the queue, keeping real rejections", () => {
    const state = sqliteState();
    // A database written before direct publishing: no submitter columns,
    // one entry still waiting for a reviewer, one already turned down.
    state.storage.sql.exec(`
      CREATE TABLE gallery_entries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        author TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        recycled_at TEXT,
        owner_user_id TEXT,
        project_text TEXT NOT NULL,
        svg_text TEXT NOT NULL
      ) WITHOUT ROWID
    `);
    for (const [id, status] of [
      ["waiting", "pending"],
      ["refused", "rejected"],
    ]) {
      state.storage.sql.exec(
        `INSERT INTO gallery_entries(
           id, name, author, description, created_at, schema_version,
           status, recycled_at, owner_user_id, project_text, svg_text
         ) VALUES (?, ?, '', '', '2026-01-01T00:00:00.000Z', 21, ?, NULL, NULL, ?, '<svg/>')`,
        id,
        id,
        status,
        projectText(),
      );
    }

    new GalleryDO(state);

    const rows = state.storage.sql
      .exec<{ id: string; status: string }>(
        "SELECT id, status FROM gallery_entries ORDER BY id",
      )
      .toArray();
    expect(rows).toEqual([
      { id: "refused", status: "rejected" },
      { id: "waiting", status: "public" },
    ]);
  });
});

function reviewHarness(): { authDurable: AuthDO; env: Harness } {
  const env = environment();
  return { authDurable: env.authDurable, env };
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

describe("gallery version history", () => {
  it("snapshots on every update, lists, restores (reversibly), and guards", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Versioned v1", { cookie: adminCookie });

    function updateRequest(name: string): Request {
      return new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: adminCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name,
          author: "tz",
          projectText: projectText(name),
        }),
      });
    }
    await route(env, updateRequest("Versioned v2"));
    await route(env, updateRequest("Versioned v3"));

    // Anonymous callers see nothing.
    const denied = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/versions`),
    );
    expect(denied.status).toBe(401);

    const listed = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/versions`, {
        headers: cookieHeaders(adminCookie),
      }),
    );
    const { versions } = (await listed.json()) as {
      versions: { versionId: string; versionNo: number; name: string }[];
    };
    expect(versions.map((version) => version.name)).toEqual([
      "Versioned v2",
      "Versioned v1",
    ]);

    const versionPreview = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/versions/${versions[1]!.versionId}/preview.svg`,
        { headers: cookieHeaders(adminCookie) },
      ),
    );
    expect(versionPreview.headers.get("content-type")).toBe("image/svg+xml");

    // Restore v1: current v3 is snapshotted first, entry becomes v1.
    const restored = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/versions/${versions[1]!.versionId}/restore`,
        {
          method: "POST",
          headers: { Origin: ORIGIN, ...cookieHeaders(adminCookie) },
        },
      ),
    );
    expect(restored.status).toBe(200);
    const detail = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))
    ).json()) as { entry: { name: string } };
    expect(detail.entry.name).toBe("Versioned v1");

    const afterRestore = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}/versions`, {
          headers: cookieHeaders(adminCookie),
        }),
      )
    ).json()) as { versions: { name: string }[] };
    expect(afterRestore.versions.map((version) => version.name)).toEqual([
      "Versioned v3",
      "Versioned v2",
      "Versioned v1",
    ]);
  });

  it("prunes history beyond the per-entry cap", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Cap 0", { cookie: adminCookie });
    for (let index = 1; index <= 24; index += 1) {
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}`, {
          method: "PUT",
          headers: {
            Origin: ORIGIN,
            Cookie: adminCookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: `Cap ${index}`,
            projectText: projectText(`Cap ${index}`),
          }),
        }),
      );
    }
    const listed = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}/versions`, {
          headers: cookieHeaders(adminCookie),
        }),
      )
    ).json()) as { versions: { versionNo: number }[] };
    expect(listed.versions).toHaveLength(20);
    expect(listed.versions[0]!.versionNo).toBe(24);
    expect(listed.versions.at(-1)!.versionNo).toBe(5);
  });
});

describe("gallery circuit tags", () => {
  it("normalizes tags on write, filters as an OR-union, and aggregates", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const submitTagged = (name: string, tags: unknown) =>
      route(
        env,
        submissionRequest(
          { name, tags, projectText: projectText(name) },
          { cookie: adminCookie },
        ),
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
          Cookie: adminCookie,
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
    const env = environment();
    // The byline follows the account, so the fixture needs two of them. Both
    // are admins here only to skip the gates the empty fixture would fail.
    const alice = await signIn(env.authDurable, "alice@example.com");
    const bob = await signIn(env.authDurable, "bob@example.com");
    await env.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/users/role`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: await adminOf(env),
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "alice@example.com", role: "moderator" }),
      }),
    );
    await env.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/users/role`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: await adminOf(env),
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "bob@example.com", role: "moderator" }),
      }),
    );
    for (const [name, cookie] of [
      ["A1", alice],
      ["B1", bob],
      ["A2", alice],
      ["A3", alice],
    ] as const) {
      const response = await route(
        env,
        submissionRequest({ name, projectText: projectText(name) }, { cookie }),
      );
      expect(response.status).toBe(201);
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

describe("gallery owner editing", () => {
  it("keeps an owner's update on the wall and under its own byline", async () => {
    const env = environment();
    const ownerCookie = await makerOf(env);
    const adminCookie = await adminOf(env);
    const strangerCookie = await signIn(env.authDurable, "other@example.com");

    const submitted = await route(
      env,
      submissionRequest(
        { name: "Edit Me", projectText: wiredProjectText("Edit Me") },
        { cookie: ownerCookie },
      ),
    );
    const { id } = (await submitted.json()) as { id: string };

    function updateRequest(cookie: string | null): Request {
      const headers = new Headers({
        "content-type": "application/json",
        Origin: ORIGIN,
      });
      if (cookie) headers.set("Cookie", cookie);
      return new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          name: "Edit Me v2",
          projectText: wiredProjectText("Edit Me v2"),
        }),
      });
    }

    const stranger = await route(env, updateRequest(strangerCookie));
    expect(stranger.status).toBe(403);
    const anonymous = await route(env, updateRequest(null));
    expect(anonymous.status).toBe(401);

    // The owner's own edit stays live rather than dropping out of the feed.
    const updated = await route(env, updateRequest(ownerCookie));
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { status: string }).status).toBe(
      "public",
    );

    const mine = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/mine`, {
        headers: cookieHeaders(ownerCookie),
      }),
    );
    const entries = (await mine.json()) as {
      entries: { name: string; status: string }[];
    };
    expect(entries.entries).toMatchObject([
      { name: "Edit Me v2", status: "public" },
    ]);

    // A curator's edit does not re-attribute the entry to the curator.
    const adminEdit = await route(env, updateRequest(adminCookie));
    expect(adminEdit.status).toBe(200);
    const detail = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))
    ).json()) as { entry: { author: string }; ownerUserId: string | null };
    expect(detail.entry.author).toBe("maker");
    // The detail response names the owner so the editor can offer updates.
    expect(typeof detail.ownerUserId).toBe("string");

    // An empty replacement still fails the gates for the ordinary owner.
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
  });
});

describe("gallery admin sessions", () => {
  it("lets a curator session reach the curator-only surfaces", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const memberCookie = await makerOf(env);

    const asCurator = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/recycled`, {
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(asCurator.status).toBe(200);

    const asMember = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/recycled`, {
        headers: cookieHeaders(memberCookie),
      }),
    );
    expect(asMember.status).toBe(401);
  });
});

describe("gallery administration", () => {
  it("requires an admin session for every admin operation", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Guarded", { cookie: adminCookie });

    const anonymous = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/recycle`, {
        method: "POST",
        headers: { Origin: ORIGIN },
      }),
    );
    expect(anonymous.status).toBe(401);

    // A bearer header is not a credential any more: the caller reads as an
    // ordinary visitor, and the ownership check turns an unknown entry into
    // a not-found rather than an unauthorized.
    const impossible = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/some-id/recycle`, {
        method: "POST",
        headers: { Origin: ORIGIN, Authorization: "Bearer anything" },
      }),
    );
    expect(impossible.status).toBe(404);

    const asMember = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "DELETE",
        headers: cookieHeaders(await makerOf(env)),
      }),
    );
    expect(asMember.status).toBe(401);
  });

  it("recycles, hides, restores, and only hard-deletes from the bin", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Lifecycle", { cookie: adminCookie });

    const earlyDelete = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "DELETE",
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(earlyDelete.status).toBe(409);

    const recycle = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/recycle`, {
        method: "POST",
        headers: cookieHeaders(adminCookie),
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
        headers: cookieHeaders(adminCookie),
      }),
    );
    const binned = (await bin.json()) as { entries: { id: string }[] };
    expect(binned.entries.map((entry) => entry.id)).toEqual([id]);

    const restore = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/restore`, {
        method: "POST",
        headers: cookieHeaders(adminCookie),
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
        headers: cookieHeaders(adminCookie),
      }),
    );
    const remove = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "DELETE",
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(remove.status).toBe(200);
    const gone = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/recycled`, {
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(((await gone.json()) as { entries: unknown[] }).entries).toEqual([]);
  });

  it("re-serializes stored entries back into the rolling window", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Aging Entry", { cookie: adminCookie });

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
        headers: cookieHeaders(adminCookie),
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

  it("repairs already-stored schema-22 power evidence during maintenance", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Broken VDD", { cookie: adminCookie });
    await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/update-entry",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          projectText: brokenCurrentPowerRailText(),
          schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
          svgText: "<svg/>",
        }),
      },
    );

    const maintenance = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/reserialize`, {
        method: "POST",
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(await maintenance.json()).toMatchObject({ upgraded: 1, failed: [] });

    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    const stored = JSON.parse(payload.projectText) as any;
    expect(stored.documents[0].connectivityEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "legacy-label-vdd",
          powerDomain: "vdd",
          owner: { kind: "power-marker", objectId: "label-vdd" },
        }),
      ]),
    );
    const preview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );
    expect(await preview.text()).toContain('stroke-width="3.24"');
  });
});

describe("gallery owner lifecycle (withdrawal and history)", () => {
  async function submitPublished(
    env: GalleryEnv,
    ownerCookie: string,
    name: string,
  ): Promise<string> {
    const submitted = await route(
      env,
      submissionRequest(
        { name, projectText: wiredProjectText(name) },
        { cookie: ownerCookie },
      ),
    );
    expect(submitted.status).toBe(201);
    const { id, status } = (await submitted.json()) as {
      id: string;
      status: string;
    };
    expect(status).toBe("public");
    return id;
  }

  function lifecycle(
    id: string,
    action: "recycle" | "restore",
    cookie: string | null,
  ): Request {
    const headers = new Headers({ Origin: ORIGIN });
    if (cookie) headers.set("Cookie", cookie);
    return new Request(`${ORIGIN}/api/gallery/${id}/${action}`, {
      method: "POST",
      headers,
    });
  }

  async function mineStatus(
    env: GalleryEnv,
    cookie: string,
    id: string,
  ): Promise<string | undefined> {
    const mine = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/mine`, {
        headers: { Cookie: cookie },
      }),
    );
    const payload = (await mine.json()) as {
      entries: { id: string; status: string }[];
    };
    return payload.entries.find((entry) => entry.id === id)?.status;
  }

  it("owners withdraw and restore their own entries; strangers cannot", async () => {
    const { authDurable, env } = reviewHarness();
    const ownerCookie = await signIn(authDurable, "maker@example.com");
    const adminCookie = await signIn(authDurable, "owner@example.com");
    const strangerCookie = await signIn(authDurable, "other@example.com");
    const id = await submitPublished(env, ownerCookie, "Mine");

    expect(
      (await route(env, lifecycle(id, "recycle", strangerCookie))).status,
    ).toBe(401);
    expect((await route(env, lifecycle(id, "recycle", null))).status).toBe(401);

    // Owner withdraws: gone from the public wall, "recycled" in /mine.
    expect(
      (await route(env, lifecycle(id, "recycle", ownerCookie))).status,
    ).toBe(200);
    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    const wall = (await list.json()) as { entries: { id: string }[] };
    expect(wall.entries.some((entry) => entry.id === id)).toBe(false);
    expect(await mineStatus(env, ownerCookie, id)).toBe("recycled");

    // Bringing it back republishes it, for the owner as much as the admin.
    expect(
      (await route(env, lifecycle(id, "restore", ownerCookie))).status,
    ).toBe(200);
    expect(await mineStatus(env, ownerCookie, id)).toBe("public");
    expect(
      (await route(env, lifecycle(id, "recycle", adminCookie))).status,
    ).toBe(200);
    expect(
      (await route(env, lifecycle(id, "restore", adminCookie))).status,
    ).toBe(200);
    expect(await mineStatus(env, ownerCookie, id)).toBe("public");

    const missing = await route(
      env,
      lifecycle("does-not-exist", "recycle", ownerCookie),
    );
    expect(missing.status).toBe(404);
  });

  it("owners browse their version history; a restore stays published", async () => {
    const { authDurable, env } = reviewHarness();
    const ownerCookie = await signIn(authDurable, "maker@example.com");
    const adminCookie = await signIn(authDurable, "owner@example.com");
    const strangerCookie = await signIn(authDurable, "other@example.com");
    const id = await submitPublished(env, ownerCookie, "Hist v1");

    // The owner's update snapshots v1 and stays on the wall.
    const updated = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: ownerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Hist v2",
          author: "maker",
          projectText: wiredProjectText("Hist v2"),
        }),
      }),
    );
    expect(updated.status).toBe(200);

    function versionsRequest(cookie: string | null): Request {
      const headers = new Headers();
      if (cookie) headers.set("Cookie", cookie);
      return new Request(`${ORIGIN}/api/gallery/${id}/versions`, { headers });
    }
    expect((await route(env, versionsRequest(strangerCookie))).status).toBe(
      401,
    );
    expect((await route(env, versionsRequest(null))).status).toBe(401);
    const listed = await route(env, versionsRequest(ownerCookie));
    expect(listed.status).toBe(200);
    const { versions } = (await listed.json()) as {
      versions: { versionId: string; name: string }[];
    };
    expect(versions).toHaveLength(1);
    expect(versions[0]!.name).toBe("Hist v1");

    const previewPath = `${ORIGIN}/api/gallery/${id}/versions/${versions[0]!.versionId}/preview.svg`;
    const strangerPreview = await route(
      env,
      new Request(previewPath, { headers: { Cookie: strangerCookie } }),
    );
    expect(strangerPreview.status).toBe(404);
    const ownerPreview = await route(
      env,
      new Request(previewPath, { headers: { Cookie: ownerCookie } }),
    );
    expect(await ownerPreview.text()).toContain("<svg");

    // Restoring v1 puts the old content back without taking the entry down.
    const restore = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/versions/${versions[0]!.versionId}/restore`,
        { method: "POST", headers: { Origin: ORIGIN, Cookie: ownerCookie } },
      ),
    );
    expect(restore.status).toBe(200);
    expect(await mineStatus(env, ownerCookie, id)).toBe("public");
    const detail = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        headers: { Cookie: ownerCookie },
      }),
    );
    const payload = (await detail.json()) as { entry: { name: string } };
    expect(payload.entry.name).toBe("Hist v1");
  });
});
