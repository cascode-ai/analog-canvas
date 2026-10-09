// Publishing: submissions, the daily quota, direct publishing and AI marks.

import { clearFormulaArtifactCacheForTests } from "../packages/math-typesetting/src/cache";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "@icm/model";
import { hierarchicalSymbolId } from "@icm/symbols";
import {
  GalleryDO,
  routeGalleryRequest,
  type GalleryPreviewCache,
} from "./gallery";
import {
  GALLERY_AI_SEAT_DAILY_LIMIT,
  GALLERY_DAILY_SUBMISSION_LIMIT,
  GALLERY_MAX_PROJECT_BYTES,
} from "./gallery-store";
import { AI_SEATS } from "./auth";
import {
  type Harness,
  ORIGIN,
  adminOf,
  asReader,
  cookieHeaders,
  environment,
  formulaProjectText,
  makerOf,
  previousRouteVersionText,
  previousVersionText,
  projectText,
  route,
  seatOf,
  sqliteState,
  submissionRequest,
  submitOne,
  wiredProjectText,
} from "./gallery.test-support";

function memoryPreviewCache(): GalleryPreviewCache & {
  readonly matchCalls: string[];
  readonly putCalls: string[];
} {
  const responses = new Map<string, Response>();
  const matchCalls: string[] = [];
  const putCalls: string[] = [];
  return {
    matchCalls,
    putCalls,
    async match(request) {
      matchCalls.push(request.url);
      return responses.get(request.url)?.clone();
    },
    async put(request, response) {
      putCalls.push(request.url);
      responses.set(request.url, response.clone());
    },
  };
}

describe("AI marks", () => {
  function updateRequest(id: string, cookie: string, body: object): Request {
    return new Request(`${ORIGIN}/api/gallery/${id}`, {
      method: "PUT",
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Agent Amplifier",
        projectText: projectText("Agent Amplifier"),
        ...body,
      }),
    });
  }

  async function marks(env: Harness) {
    const response = await route(env, new Request(`${ORIGIN}/api/gallery`));
    const { entries } = (await response.json()) as {
      entries: { id: string; aiGenerated?: boolean }[];
    };
    return Object.fromEntries(
      entries.map((entry) => [entry.id, entry.aiGenerated]),
    );
  }

  it("keeps the publisher's AI mark until the author changes it", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const published = await route(
      env,
      submissionRequest(
        {
          name: "Agent Amplifier",
          projectText: projectText("Agent Amplifier"),
          aiGenerated: true,
        },
        { cookie },
      ),
    );
    expect(published.status).toBe(201);
    const { id } = (await published.json()) as { id: string };
    const drawn = await submitOne(env, "Hand Drawn", { cookie });
    expect(await marks(env)).toEqual({ [id]: true, [drawn]: undefined });
    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    expect(
      ((await detail.json()) as { entry: { aiGenerated?: boolean } }).entry
        .aiGenerated,
    ).toBe(true);

    // An update that does not mention the mark leaves it alone.
    expect((await route(env, updateRequest(id, cookie, {}))).status).toBe(200);
    expect((await marks(env))[id]).toBe(true);

    expect(
      (await route(env, updateRequest(id, cookie, { aiGenerated: false })))
        .status,
    ).toBe(200);
    expect((await marks(env))[id]).toBeUndefined();
  });

  it("keeps an AI account's mark whoever updates its entry, and allows it 500 a day", async () => {
    const env = environment();
    const seat = await seatOf(env);
    const id = await submitOne(env, "Seat Amplifier", { cookie: seat });
    const mark = () =>
      env.gallerySql
        .exec<{ ai_generated: number }>(
          "SELECT ai_generated FROM gallery_entries WHERE id = ?",
          id,
        )
        .one().ai_generated;
    for (const cookie of [seat, await adminOf(env)]) {
      expect(
        (await route(env, updateRequest(id, cookie, { aiGenerated: false })))
          .status,
      ).toBe(200);
      expect(mark()).toBe(1);
    }
    // With the day's 500th already standing, the next is refused.
    const today = new Date().toISOString();
    for (let index = 0; index < GALLERY_AI_SEAT_DAILY_LIMIT - 2; index += 1)
      env.gallerySql.exec(
        `INSERT INTO gallery_entries
         (id, name, author, description, created_at, schema_version, status,
          owner_user_id, project_text, svg_text)
         VALUES (?, ?, 'x', '', ?, ?, 'public', ?, ?, '<svg/>')`,
        `seeded-${index}`,
        `seeded-${index}`,
        today,
        CURRENT_PROJECT_FILE_VERSION,
        AI_SEATS[0]!.userId,
        projectText(`seeded-${index}`),
      );
    await submitOne(env, "The 500th", { cookie: seat });
    const refused = await route(
      env,
      submissionRequest(
        {
          name: "The 501st",
          description: "d",
          projectText: projectText("The 501st"),
        },
        { cookie: seat },
      ),
    );
    expect(refused.status).toBe(429);
  });

  it("refuses an AI mark that is not true or false", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const published = await route(
      env,
      submissionRequest(
        { name: "X", projectText: projectText("X"), aiGenerated: "yes" },
        { cookie },
      ),
    );
    expect(published.status).toBe(400);
    const id = await submitOne(env, "Y", { cookie });
    const updated = await route(
      env,
      updateRequest(id, cookie, { aiGenerated: 1 }),
    );
    expect(updated.status).toBe(400);
    expect((await marks(env))[id]).toBeUndefined();
  });
});

describe("gallery submissions", () => {
  it("keeps a description up to 1000 characters, room for a full citation", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const publish = (description: string) =>
      route(
        env,
        submissionRequest(
          {
            name: "Cited circuit",
            description,
            projectText: projectText("Cited circuit"),
          },
          { ip: "203.0.113.7", cookie },
        ),
      );
    const citation =
      "Y. Liang, R. Ding and Z. Zhu, \u201cA 9.1ENOB 200MS/s Asynchronous SAR ADC With Hybrid Single-Ended/Differential DAC in 55-nm CMOS for Image Sensing Signals,\u201d in IEEE, ";
    const longest = citation.repeat(8).slice(0, 1000);
    const accepted = await publish(longest);
    expect(accepted.status).toBe(201);
    const { id } = (await accepted.json()) as { id: string };
    expect(
      env.gallerySql
        .exec<{
          description: string;
        }>("SELECT description FROM gallery_entries WHERE id=?", id)
        .one().description,
    ).toBe(longest.trim());
    // One more is refused whole, never stored cut.
    const refused = await publish(`${longest}x`);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "invalid-fields" });
  });

  it("prepares formulas on cold publish and repairs legacy previews without changing publications", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    clearFormulaArtifactCacheForTests();
    const id = await submitOne(env, "Formula circuit", {
      cookie,
      // Label type cannot set a brace, so the typesetter prepares this one.
      text: formulaProjectText(String.raw`\overbrace{\frac{1}{\sqrt{L_1C_1}}}`),
    });
    const stored = () =>
      env.gallerySql
        .exec<{
          svg_text: string;
          preview_revision: string;
          project_text: string;
        }>(
          "SELECT svg_text, preview_revision, project_text FROM gallery_entries WHERE id=?",
          id,
        )
        .one();
    const current = stored();
    expect(current.svg_text).toContain('data-role="formula"');
    expect(current.svg_text).toContain('data-c="1D5DF"');
    expect(current.svg_text).not.toContain('data-role="formula-pending"');
    const legacy =
      '<svg xmlns="http://www.w3.org/2000/svg"><text data-role="formula-pending">old latex</text></svg>';
    env.gallerySql.exec(
      "UPDATE gallery_entries SET svg_text=? WHERE id=?",
      legacy,
      id,
    );
    const before = stored();
    const request = new Request(
      `${ORIGIN}/api/gallery/${id}/preview.svg?v=${before.preview_revision}&render=formula-label-v5`,
    );
    const cache = memoryPreviewCache();
    await cache.put(request, new Response(legacy));
    clearFormulaArtifactCacheForTests();
    const repaired = await routeGalleryRequest(asReader(request), env, {
      previewCache: cache,
    });
    expect(repaired!.status).toBe(200);
    expect(await repaired!.text()).toBe(current.svg_text);
    expect(stored()).toEqual(before);
    expect(
      env.gallerySql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM gallery_entry_versions WHERE entry_id=?",
          id,
        )
        .one().count,
    ).toBe(0);
    env.galleryQueries.length = 0;
    const cached = await routeGalleryRequest(asReader(request), env, {
      previewCache: cache,
    });
    expect(await cached!.text()).toBe(current.svg_text);
    expect(env.galleryQueries.some((sql) => sql.includes("project_text"))).toBe(
      false,
    );
    env.gallerySql.exec(
      "UPDATE gallery_entries SET status='rejected' WHERE id=?",
      id,
    );
    expect(
      (await routeGalleryRequest(asReader(request), env, {
        previewCache: cache,
      }))!.status,
    ).toBe(404);
  });

  it("publishes immediately with canonical text and a server preview", async () => {
    const env = environment();
    const id = await submitOne(env, "Ring Oscillator");

    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    const listed = (await list.json()) as {
      entries: {
        id: string;
        name: string;
        previewRevision: string;
        previewWidth: number;
        previewHeight: number;
        schemaVersion: number;
      }[];
    };
    expect(listed.entries.map((entry) => entry.id)).toEqual([id]);
    expect(listed.entries[0]).toMatchObject({
      name: "Ring Oscillator",
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    });
    expect(listed.entries[0]!.previewRevision).toMatch(/^[a-f0-9]{64}$/u);
    expect(listed.entries[0]!.previewWidth).toBeGreaterThan(0);
    expect(listed.entries[0]!.previewHeight).toBeGreaterThan(0);

    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    expect(JSON.parse(payload.projectText)).toMatchObject({
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
      name: "Ring Oscillator",
    });

    const preview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );
    expect(preview.headers.get("content-type")).toBe("image/svg+xml");
    expect(preview.headers.get("cache-control")).toBe("no-store");
    expect(await preview.text()).toContain("<svg");

    const immutablePreview = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/preview.svg?v=${listed.entries[0]!.previewRevision}`,
      ),
    );
    expect(immutablePreview.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
  });

  it("caches immutable preview bytes behind a live publication check", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Cached Preview", { cookie: adminCookie });
    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    const revision = (
      (await list.json()) as {
        entries: { previewRevision: string }[];
      }
    ).entries[0]!.previewRevision;
    const previewUrl = `${ORIGIN}/api/gallery/${id}/preview.svg?v=${revision}`;
    const cache = memoryPreviewCache();

    env.galleryQueries.length = 0;
    const first = await routeGalleryRequest(
      asReader(new Request(previewUrl)),
      env,
      {
        previewCache: cache,
      },
    );
    expect(first?.status).toBe(200);
    const firstSvg = await first!.text();
    expect(firstSvg).toContain("<svg");
    expect(cache.putCalls).toEqual([previewUrl]);
    const coldQuery = env.galleryQueries.find((query) =>
      query.includes("svg_text"),
    );
    expect(coldQuery).toBeDefined();
    expect(coldQuery).not.toContain("project_text");

    env.galleryQueries.length = 0;
    const second = await routeGalleryRequest(
      asReader(new Request(previewUrl)),
      env,
      {
        previewCache: cache,
      },
    );
    expect(await second!.text()).toBe(firstSvg);
    expect(cache.putCalls).toHaveLength(1);
    expect(env.galleryQueries.some((query) => query.includes("svg_text"))).toBe(
      false,
    );
    expect(
      env.galleryQueries.some(
        (query) =>
          query.includes("status") && query.includes("preview_revision"),
      ),
    ).toBe(true);

    const recycled = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/recycle`, {
        method: "POST",
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(recycled.status).toBe(200);
    const hidden = await routeGalleryRequest(
      asReader(new Request(previewUrl)),
      env,
      {
        previewCache: cache,
      },
    );
    expect(hidden?.status).toBe(404);
    expect(hidden?.headers.get("cache-control")).toBe("no-store");
  });

  it("publishes and updates a hierarchical Project with its top-level Cell preview", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const publish = await route(
      env,
      submissionRequest(
        {
          name: "Hierarchical DAC",
          projectText: hierarchicalProjectText("Hierarchical DAC"),
        },
        { cookie },
      ),
    );
    expect(publish.status).toBe(201);
    const { id } = (await publish.json()) as { id: string };

    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const stored = (await detail.json()) as { projectText: string };
    expect(parseProject(stored.projectText).documents).toHaveLength(2);

    const preview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );
    const svg = await preview.text();
    expect(svg).toContain('data-object-id="XU0"');
    expect(svg).toContain(
      `data-symbol-id="${hierarchicalSymbolId("scdac_unit")}"`,
    );

    const update = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Hierarchical DAC v2",
          projectText: hierarchicalProjectText("Hierarchical DAC v2"),
        }),
      }),
    );
    expect(update.status).toBe(200);
  });

  it("upgrades a previous-schema submission through the protocol", async () => {
    const env = environment();
    const id = await submitOne(env, "Old Schema", {
      text: previousVersionText(),
    });
    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    expect(JSON.parse(payload.projectText).schemaVersion).toBe(
      CURRENT_PROJECT_FILE_VERSION,
    );
  });

  it("migrates previous-schema Route legs and anchors in stored text", async () => {
    const env = environment();
    const id = await submitOne(env, "Legacy Route", {
      text: previousRouteVersionText(),
    });
    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    const stored = parseProject(payload.projectText) as any;
    const storedRoute = stored.documents[0].routes[0];
    expect(storedRoute.start).toEqual({
      kind: "junction",
      junctionId: "J1",
    });
    expect(storedRoute.legs).toHaveLength(2);
    expect(stored.documents[0].annotations[0].anchor).toMatchObject({
      routeId: storedRoute.id,
      legId: storedRoute.legs[1].id,
    });
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

    // The quota counts the account's own entries for the day, so it is
    // driven through the real submission route rather than a synthetic key.
    async function submitDirect(
      ownerUserId: string,
      day: string,
    ): Promise<number> {
      const response = await env.GALLERY.getByName("gallery").fetch(
        "https://gallery/submit",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            day,
            enforceLimit: true,
            entry: {
              id: crypto.randomUUID(),
              name: "Quota",
              author: "",
              description: "",
              created_at: `${day}T00:00:00.000Z`,
              schema_version: 21,
              owner_user_id: ownerUserId,
              project_text: projectText(),
              svg_text: "<svg/>",
            },
          }),
        },
      );
      return response.status;
    }
    for (let index = 0; index < GALLERY_DAILY_SUBMISSION_LIMIT; index += 1) {
      expect(await submitDirect("account-a", "2026-08-22")).toBe(200);
    }
    expect(await submitDirect("account-a", "2026-08-22")).toBe(429);
    // A different account is untouched, and so is the same account tomorrow.
    expect(await submitDirect("account-b", "2026-08-22")).toBe(200);
    expect(await submitDirect("account-a", "2026-08-23")).toBe(200);

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

describe("the daily publish quota", () => {
  const entryCount = (env: Harness): number =>
    env.gallerySql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM gallery_entries")
      .one().count;

  it("tells a signed-in publisher what is left today and when the day resets (#1417)", async () => {
    const env = environment();
    const quota = async (cookie?: string) => {
      const response = await route(
        env,
        new Request(
          `${ORIGIN}/api/gallery/quota`,
          cookie ? { headers: cookieHeaders(cookie) } : undefined,
        ),
      );
      return { status: response.status, body: await response.json() };
    };
    const cookie = await makerOf(env);
    await submitOne(env, "First", { cookie });
    await submitOne(env, "Second", { cookie });

    const answer = await quota(cookie);
    expect(answer).toMatchObject({
      status: 200,
      body: {
        limit: GALLERY_DAILY_SUBMISSION_LIMIT,
        used: 2,
        remaining: GALLERY_DAILY_SUBMISSION_LIMIT - 2,
        exempt: false,
      },
    });
    // The next 00:00 UTC, whichever side of midnight the test runs on.
    const resetsAt = new Date(answer.body.resetsAt);
    expect(resetsAt.toISOString().slice(11)).toBe("00:00:00.000Z");
    expect(resetsAt.getTime() - Date.now()).toBeGreaterThan(0);
    expect(resetsAt.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
    // Curators publish without the allowance.
    expect((await quota(await adminOf(env))).body).toMatchObject({
      exempt: true,
    });
    expect((await quota()).status).toBe(401);
  });

  it("gives an AI account 500 a day and marks all it publishes AI-generated", async () => {
    const env = environment();
    const cookie = await seatOf(env);
    const response = await route(
      env,
      submissionRequest(
        {
          name: "Seat circuit",
          description: "d",
          projectText: projectText("Seat circuit"),
          aiGenerated: false,
        },
        { cookie },
      ),
    );
    expect(response.status).toBe(201);
    expect(
      env.gallerySql
        .exec<{ ai_generated: number }>(
          "SELECT ai_generated FROM gallery_entries",
        )
        .one().ai_generated,
    ).toBe(1);
    const quota = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/quota`, {
        headers: cookieHeaders(cookie),
      }),
    );
    expect(await quota.json()).toMatchObject({
      limit: GALLERY_AI_SEAT_DAILY_LIMIT,
      used: 1,
      remaining: GALLERY_AI_SEAT_DAILY_LIMIT - 1,
    });
  });

  it("counts an account's own entries, so removing work returns the allowance", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const first = await submitOne(env, "First", { cookie });
    await submitOne(env, "Second", { cookie });
    expect(entryCount(env)).toBe(2);

    // Deleting is meant to give the slot back: the quota bounds what stands
    // on the wall, not how many times someone may change their mind.
    const removed = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${first}`, {
        method: "DELETE",
        headers: { Origin: ORIGIN, Cookie: cookie },
      }),
    );
    expect(removed.status).toBe(200);
    expect(entryCount(env)).toBe(1);
  });

  /**
   * Spend the day's whole allowance for one member, leaving them holding a
   * public entry of their own that the lifecycle routes can act on.
   *
   * The filler entries go straight to the Durable Object: the quota is
   * counted there, and a hundred trips through the full route would only
   * re-test rendering.
   */
  async function dayAtTheLimit(env: Harness): Promise<{
    cookie: string;
    owner: string;
    day: string;
    mine: string;
  }> {
    const cookie = await makerOf(env);
    const mine = await submitOne(env, "Second thoughts", { cookie });
    const seed = env.gallerySql
      .exec<{
        owner_user_id: string;
        created_at: string;
      }>(
        "SELECT owner_user_id, created_at FROM gallery_entries WHERE id = ?",
        mine,
      )
      .one();
    const owner = seed.owner_user_id;
    const day = seed.created_at.slice(0, 10);
    for (let index = 1; index < GALLERY_DAILY_SUBMISSION_LIMIT; index += 1) {
      expect(await submitDirect(env, owner, day)).toBe(200);
    }
    expect(await submitDirect(env, owner, day)).toBe(429);
    return { cookie, owner, day, mine };
  }

  async function submitDirect(
    env: Harness,
    ownerUserId: string,
    day: string,
  ): Promise<number> {
    const response = await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/submit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          day,
          enforceLimit: true,
          entry: {
            id: "",
            name: "Quota",
            author: "",
            description: "",
            created_at: `${day}T00:00:00.000Z`,
            schema_version: CURRENT_PROJECT_FILE_VERSION,
            owner_user_id: ownerUserId,
            project_text: projectText(),
            svg_text: "<svg/>",
          },
        }),
      },
    );
    return response.status;
  }

  function lifecycle(
    env: Harness,
    id: string,
    action: "recycle" | "restore",
    cookie: string,
  ) {
    return route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/${action}`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: cookie },
      }),
    );
  }

  it("returns the allowance the moment work is withdrawn to the bin", async () => {
    const env = environment();
    const { cookie, owner, day, mine } = await dayAtTheLimit(env);

    // Withdrawing is changing your mind, not publishing again. The entry
    // stops standing on the wall, so it stops spending the day's allowance
    // — waiting for a curator to empty the bin would ration the second
    // thought, which is the one thing this quota is not for.
    expect((await lifecycle(env, mine, "recycle", cookie)).status).toBe(200);
    expect(await submitDirect(env, owner, day)).toBe(200);
  });

  it("spends the allowance again when the author restores from the bin", async () => {
    const env = environment();
    const { cookie, owner, day, mine } = await dayAtTheLimit(env);
    expect((await lifecycle(env, mine, "recycle", cookie)).status).toBe(200);

    // Coming back out of the bin is publishing it again, so the slot the
    // withdrawal released is spent once more and the day is full.
    expect((await lifecycle(env, mine, "restore", cookie)).status).toBe(200);
    expect(await submitDirect(env, owner, day)).toBe(429);
  });

  it("keeps spending it when a curator rejects the work", async () => {
    const env = environment();
    const { owner, day, mine } = await dayAtTheLimit(env);

    // A rejection is the wall's owner turning work away, not the author
    // changing their mind, so it earns no refund. Refunding it would mean
    // the harder a curator works the more that account may publish.
    const rejected = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${mine}/reject`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: await adminOf(env),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "Not a circuit." }),
      }),
    );
    expect(rejected.status).toBe(200);
    expect(await submitDirect(env, owner, day)).toBe(429);
  });

  it("has no separate counter table left to drift from the entries", () => {
    const env = environment();
    const tables = env.gallerySql
      .exec<{
        name: string;
      }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((row) => row.name);
    expect(tables).not.toContain("gallery_submissions");
  });
});

describe("direct publishing (the review queue is retired)", () => {
  it("publishes for every role: quality checks are advisory, never a gate", async () => {
    const env = environment();
    const cookie = await makerOf(env);

    // An ordinary member publishes even when the quality checks would flag
    // the project; the checker has false positives and sharing is the point.
    const member = await route(
      env,
      submissionRequest(
        { name: "Empty", projectText: projectText("Empty") },
        { cookie },
      ),
    );
    expect(member.status).toBe(201);

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

  it("has no queue to read and no approval step", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Live", { cookie: adminCookie });

    for (const [path, method] of [
      [`${ORIGIN}/api/gallery/review`, "GET"],
      [`${ORIGIN}/api/gallery/${id}/approve`, "POST"],
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

function hierarchicalProjectText(name = "Hierarchical"): string {
  const project = parseProject(wiredProjectText(name));
  const top = project.documents[0]!;
  const child = createEmptyDocument("document-child", "scdac_unit");
  top.instances.push({
    id: "XU0",
    symbolId: hierarchicalSymbolId(child.netlist!.name),
    placement: {
      position: { x: 100, y: 120 },
      rotation: 0,
      mirror: "none",
    },
    reference: "XU0",
    netlist: {
      parameters: {},
      binding: { kind: "subcircuit", childDocumentId: child.id },
    },
  });
  project.documents.push(child);
  return serializeProject(project);
}
