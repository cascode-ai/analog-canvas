import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";
import { forgetEarlierOpens, routeGalleryRequest } from "./gallery";
import { galleryReadableDocument } from "./gallery-documents";
import {
  SHORT_ID_LENGTH,
  shortId,
  svgPreviewDimensions,
} from "./gallery-store";
import workerEntry from "./index";
import {
  type Harness,
  ORIGIN,
  READER_TOKEN,
  adminOf,
  cookieHeaders,
  environment,
  makerOf,
  projectText,
  route,
  seatOf,
  submitOne,
} from "./gallery.test-support";

describe("Gallery readers", () => {
  // Every read the Gallery serves, for one published entry.
  async function reads(env: Harness) {
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Readers only", { cookie });
    const { entry } = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}`, {
          headers: cookieHeaders(cookie),
        }),
      )
    ).json()) as { entry: { previewRevision: string } };
    return [
      "/api/gallery",
      "/api/gallery?netlistable=1",
      "/api/gallery/tags",
      "/api/gallery/authors",
      `/api/gallery/${id}`,
      `/api/gallery/${id}/versions`,
      `/api/gallery/${id}/preview.svg?v=${entry.previewRevision}`,
    ];
  }
  const direct = async (env: Harness, path: string, headers?: HeadersInit) =>
    (await routeGalleryRequest(
      new Request(`${ORIGIN}${path}`, headers ? { headers } : {}),
      env,
    ))!;

  it("refuses every read to a visitor without a session or the read credential", async () => {
    const env = environment();
    const paths = [
      ...(await reads(env)),
      "/api/gallery?q=circuit",
      "/api/gallery?limit=1",
    ];
    for (const headers of [
      undefined,
      { Authorization: "Bearer wrong" },
      { Cookie: "session=forged" },
    ]) {
      const label = JSON.stringify(headers);
      for (const path of paths) {
        const response = await direct(env, path, headers);
        expect(response.status, `${path} ${label}`).toBe(401);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ error: "sign-in-required" });
      }
    }
    for (const path of paths)
      expect(
        (
          await routeGalleryRequest(
            new Request(`${ORIGIN}${path}`, { method: "HEAD" }),
            env,
          )
        )?.status,
        path,
      ).toBe(401);
  });

  it("serves a signed-in member and the read credential every read", async () => {
    const env = environment();
    const paths = await reads(env);
    const member = await makerOf(env);
    for (const path of paths) {
      // History stays its owner's or an admin's; the rest is any reader's.
      const expected = path.endsWith("/versions") ? 401 : 200;
      const read = await direct(env, path, cookieHeaders(member));
      expect(read.status, path).toBe(expected);
      if (expected === 401)
        expect(((await read.json()) as { error: string }).error).not.toBe(
          "sign-in-required",
        );
      expect(
        (
          await direct(env, path, {
            Authorization: `Bearer ${READER_TOKEN}`,
          })
        ).status,
        path,
      ).toBe(expected);
    }
    const preview = await direct(env, paths.at(-1)!, cookieHeaders(member));
    // A reader's browser may keep the image; a shared cache may not.
    expect(preview.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
  });
});

describe("daily Gallery opens", () => {
  const opens = (env: Harness) =>
    env.gallerySql
      .exec<{
        day: string;
        user_id: string;
        entry_id: string;
      }>("SELECT * FROM gallery_daily_opens ORDER BY entry_id")
      .toArray();

  it("counts each circuit once a day and refuses the 101st, never the wall", async () => {
    const env = environment();
    const admin = await adminOf(env);
    const first = await submitOne(env, "First circuit", { cookie: admin });
    const second = await submitOne(env, "Second circuit", { cookie: admin });
    const member = cookieHeaders(await makerOf(env));
    const read = (path: string) =>
      route(env, new Request(`${ORIGIN}${path}`, { headers: member }));
    expect((await read(`/api/gallery/${first}`)).status).toBe(200);
    expect((await read(`/api/gallery/${first}`)).status).toBe(200);
    expect(opens(env)).toHaveLength(1);
    const { day, user_id: userId } = opens(env)[0]!;
    // The rest of the day's allowance, spent on other circuits.
    for (let n = 0; n < 99; n += 1)
      env.gallerySql.exec(
        "INSERT INTO gallery_daily_opens VALUES (?, ?, ?)",
        day,
        userId,
        `seen-${n}`,
      );
    const refused = await read(`/api/gallery/${second}`);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/u);
    expect(await refused.json()).toEqual({
      error: "daily-open-limit",
      limit: 100,
      resetAt: new Date(
        Date.parse(`${day}T00:00:00Z`) + 86_400_000,
      ).toISOString(),
    });
    // What was opened today, the tile, the wall and the preview still answer.
    expect((await read(`/api/gallery/${first}`)).status).toBe(200);
    const tile = await read(`/api/gallery/${second}?summary=1`);
    expect(tile.status).toBe(200);
    const { entry, ...rest } = (await tile.json()) as {
      entry: { previewRevision: string };
    };
    expect(rest).not.toHaveProperty("projectText");
    expect((await read("/api/gallery")).status).toBe(200);
    expect(
      (
        await read(
          `/api/gallery/${second}/preview.svg?v=${entry.previewRevision}`,
        )
      ).status,
    ).toBe(200);
    expect(opens(env)).toHaveLength(100);
  });

  it("counts no author, curator, AI account or read credential, and forgets earlier days", async () => {
    const env = environment();
    const admin = await adminOf(env);
    const theirs = await submitOne(env, "Curated", { cookie: admin });
    const maker = await makerOf(env);
    const own = await submitOne(env, "Own work", { cookie: maker });
    const seat = await seatOf(env);
    env.gallerySql.exec(
      "INSERT INTO gallery_daily_opens VALUES ('2000-01-01', 'someone', 'old')",
    );
    // A request without a session reads with the Gallery credential here.
    for (const [path, headers] of [
      [`/api/gallery/${theirs}`, cookieHeaders(admin)],
      [`/api/gallery/${own}`, cookieHeaders(maker)],
      [`/api/gallery/${theirs}`, cookieHeaders(seat)],
      [`/api/gallery/${theirs}`, {}],
    ] as const)
      expect(
        (await route(env, new Request(`${ORIGIN}${path}`, { headers }))).status,
      ).toBe(200);
    expect(opens(env).map((row) => row.entry_id)).toEqual(["old"]);
    await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${theirs}`, {
        headers: cookieHeaders(maker),
      }),
    );
    expect(opens(env).map((row) => row.entry_id)).toEqual([theirs]);
  });

  it("leaves backups alone, and is forgotten the next day or with the account", async () => {
    const env = environment();
    env.GALLERY_BACKUP_TOKEN = "backup-only-secret";
    const id = await submitOne(env, "Circuit", { cookie: await adminOf(env) });
    const maker = cookieHeaders(await makerOf(env));
    const open = () =>
      route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}`, { headers: maker }),
      );
    const revision = async () =>
      (
        (await (
          await route(
            env,
            new Request(
              `${ORIGIN}/api/gallery/maintenance/automated-backup?table=inventory`,
              { headers: { Authorization: "Bearer backup-only-secret" } },
            ),
          )
        ).json()) as { snapshotRevision: string }
      ).snapshotRevision;
    const before = await revision();
    await open();
    expect(opens(env)).toHaveLength(1);
    expect(await revision()).toBe(before);
    // The scheduled pass forgets every earlier day.
    env.gallerySql.exec("UPDATE gallery_daily_opens SET day = '2000-01-01'");
    await forgetEarlierOpens(env);
    expect(opens(env)).toEqual([]);
    // Deleting the account takes today's opens with it.
    await open();
    await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/delete-account",
      {
        method: "POST",
        body: JSON.stringify({ userId: opens(env)[0]!.user_id }),
      },
    );
    expect(opens(env)).toEqual([]);
  });
});

describe("svgPreviewDimensions", () => {
  it("reads a positive SVG viewBox and rejects incomplete geometry", () => {
    expect(
      svgPreviewDimensions(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 10 640 360"></svg>',
      ),
    ).toEqual({ width: 640, height: 360 });
    expect(svgPreviewDimensions('<svg viewBox="0 0 20 0"></svg>')).toBeNull();
    expect(svgPreviewDimensions("<svg></svg>")).toBeNull();
  });
});

describe("suspended public Gallery documents", () => {
  it("serves the ordinary application shell without embedding the complete catalog", async () => {
    const env = environment();
    const id = await submitOne(env, "Five transistor OTA");

    const readable = await galleryReadableDocument(
      new Request(`${ORIGIN}/?q=transistor&tags=ota`),
      env,
    );
    expect(readable).toBeNull();
    const assets = {
      fetch: async () =>
        new Response(
          '<!doctype html><html><head><title>Analog Canvas</title></head><body><div id="root"></div></body></html>',
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    };
    for (const path of ["/?q=transistor&tags=ota", `/g/${id}`]) {
      const served = await workerEntry.fetch(new Request(`${ORIGIN}${path}`), {
        ...env,
        ASSETS: assets,
      } as unknown as Parameters<typeof workerEntry.fetch>[1]);
      expect(served.status).toBe(200);
      const html = await served.text();
      expect(html).toContain('<div id="root"></div>');
      expect(html).not.toContain("data-public-gallery-document");
      expect(html).not.toContain("Five transistor OTA");
    }

    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    expect(list.status).toBe(200);
    expect(await list.text()).toContain("Five transistor OTA");
  });

  it("returns 404 for the former direct Project Code, netlist and preview URLs", async () => {
    const env = environment();
    const id = await submitOne(env, "Readable circuit");
    const readable = await galleryReadableDocument(
      new Request(`${ORIGIN}/g/${id}`),
      env,
    );
    expect(readable).toBeNull();
    for (const resource of [
      "project.icproj.json",
      "netlist.sp",
      "netlist.scs",
      "preview.svg",
    ]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await route(
          env,
          new Request(`${ORIGIN}/g/${id}/${resource}`, { method }),
        );
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.text()).toBe("");
      }
    }
  });

  it("does not advertise or serve crawler and Agent discovery documents", async () => {
    const env = environment();
    const robots = await route(env, new Request(`${ORIGIN}/robots.txt`));
    expect(await robots.text()).toContain("Disallow: /g/");
    for (const path of ["/sitemap.xml", "/llms.txt"]) {
      const response = await route(env, new Request(`${ORIGIN}${path}`));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
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
      CURRENT_PROJECT_FILE_VERSION,
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
