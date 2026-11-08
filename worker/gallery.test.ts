import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";
import { routeGalleryRequest } from "./gallery";
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
  adminOf,
  cookieHeaders,
  environment,
  makerOf,
  projectText,
  route,
  submitOne,
  wiredProjectText,
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

  it("serves every read to anyone, signed in or not, with no count of reads", async () => {
    const env = environment();
    const paths = [
      ...(await reads(env)),
      "/api/gallery/sources",
      "/api/gallery/stats",
      "/api/gallery?q=circuit",
      "/api/gallery?limit=1",
    ];
    const member = cookieHeaders(await makerOf(env));
    for (const headers of [undefined, member]) {
      const label = headers ? "member" : "signed out";
      for (const path of paths) {
        const response = await direct(env, path, headers);
        expect(response.status, `${path} ${label}`).toBe(200);
      }
      // The whole wall, not a signed-out sample of it.
      const wall = (await (
        await direct(env, "/api/gallery", headers)
      ).json()) as {
        entries: unknown[];
        signedOut?: unknown;
      };
      expect(wall.entries).toHaveLength(1);
      expect(wall).not.toHaveProperty("signedOut");
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
      ).not.toBe(401);
    // Writes still need a session.
    const like = await routeGalleryRequest(
      new Request(`${ORIGIN}${paths[4]}/like`, {
        method: "POST",
        headers: { Origin: ORIGIN },
      }),
      env,
    );
    expect(like?.status).toBe(401);
  });
});

describe("a circuit's netlist for a reader without the editor (2026-10-14)", () => {
  it("comes with the entry when asked for, and only then", async () => {
    const env = environment();
    const id = await submitOne(env, "Wired", {
      cookie: await adminOf(env),
      text: wiredProjectText("Wired"),
    });
    const reader = cookieHeaders(await makerOf(env));
    const read = async (query: string) =>
      (await (
        await route(
          env,
          new Request(`${ORIGIN}/api/gallery/${id}${query}`, {
            headers: reader,
          }),
        )
      ).json()) as { netlist?: unknown };
    // A drawing that does not extract says why, errors only.
    expect((await read("?netlist=spice")).netlist).toEqual({
      format: "spice",
      blocked: [
        "Instance R1 requires parameter value",
        "Instance R2 requires parameter value",
      ],
    });
    const empty = await submitOne(env, "Empty", {
      cookie: await adminOf(env),
    });
    const written = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${empty}?netlist=spice`, {
          headers: reader,
        }),
      )
    ).json()) as { netlist?: { text?: string } };
    expect(written.netlist?.text).toContain(".end");
    expect((await read("")).netlist).toBeUndefined();
    // With the tile alone, the netlist alone: no Project Code.
    const alone = (await read("?summary=1&netlist=spice")) as {
      netlist?: { format?: string };
      projectText?: unknown;
    };
    expect(alone.netlist?.format).toBe("spice");
    expect(alone).not.toHaveProperty("projectText");
  });
});

describe("Gallery opens", () => {
  const opens = (env: Harness) =>
    env.gallerySql
      .exec<{ entry_id: string; opens: number }>(
        "SELECT entry_id, opens FROM gallery_entry_opens ORDER BY entry_id",
      )
      .toArray();

  it("counts each read of a circuit, never who, never its author, with no daily cap", async () => {
    const env = environment();
    env.GALLERY_BACKUP_TOKEN = "backup-only-secret";
    const maker = await makerOf(env);
    const id = await submitOne(env, "Circuit", { cookie: maker });
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
    const read = (path: string, headers?: HeadersInit) =>
      routeGalleryRequest(
        new Request(`${ORIGIN}${path}`, headers ? { headers } : {}),
        env,
      );
    for (let n = 0; n < 120; n += 1)
      expect((await read(`/api/gallery/${id}`))?.status).toBe(200);
    // Its author's reads and a tile's summary are not opens.
    await read(`/api/gallery/${id}`, cookieHeaders(maker));
    await read(`/api/gallery/${id}?summary=1`);
    expect(opens(env)).toEqual([{ entry_id: id, opens: 120 }]);
    expect(
      env.gallerySql
        .exec(
          "SELECT name FROM sqlite_master WHERE name = 'gallery_daily_opens'",
        )
        .toArray(),
    ).toEqual([]);
    // Counting changes nothing a backup holds.
    expect(await revision()).toBe(before);
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

  it("lists no resources for crawlers or Agents, and llms.txt states only the usage policy", async () => {
    const env = environment();
    const sitemap = await route(env, new Request(`${ORIGIN}/sitemap.xml`));
    expect(sitemap.status).toBe(404);
    expect(sitemap.headers.get("cache-control")).toBe("no-store");
    // llms.txt states the usage policy and lists no resources.
    const llms = await route(env, new Request(`${ORIGIN}/llms.txt`));
    expect(llms.status).toBe(200);
    const policy = await llms.text();
    expect(policy).toContain("manual use of individual circuits is welcome");
    expect(policy).toContain("strictly prohibited");
    expect(policy).toContain("lawyer's letter");
    expect(policy).toContain("zzhishuai@ethz.ch");
    expect(policy).not.toContain("/g/");
  });

  it("asks AI crawlers to stay out and points bulk collection to the author", async () => {
    const env = environment();
    const robots = await (
      await route(env, new Request(`${ORIGIN}/robots.txt`))
    ).text();
    expect(robots).toMatch(
      /User-agent: GPTBot\n(?:User-agent: .+\n)*Disallow: \/\n/u,
    );
    expect(robots).toMatch(
      /User-agent: \*\nContent-Signal: search=yes, ai-train=no\nDisallow: \/g\/\n/u,
    );
    expect(robots).toContain("STRICTLY PROHIBITED");
    expect(robots).toContain("lawyer's letter");
    expect(robots).toContain("zzhishuai@ethz.ch");
    // A user's own assistant fetching one page is not refused.
    expect(robots).not.toContain("ChatGPT-User");
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
