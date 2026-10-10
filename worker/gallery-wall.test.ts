// The public wall: its feed and filters, netlist marks, likes, tags, and the
// Owner's Data tab.

import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { refreshNetlistMarks } from "./gallery-maintenance";
import {
  type Harness,
  ORIGIN,
  READER_TOKEN,
  adminOf,
  cookieHeaders,
  environment,
  makerOf,
  ownerAccountOf,
  projectText,
  route,
  seatOf,
  submissionRequest,
  submitOne,
} from "./gallery.test-support";

/** Counts per part-count size, with `small` drawings of at most five parts. */
function sizes(small: number, rest: Partial<Record<string, number>> = {}) {
  return { "0-5": small, "6-10": 0, "11-15": 0, "16-25": 0, "26-": 0, ...rest };
}

/** A drawing of `parts` resistors and a Ground, which is not a part. */
function partsProjectText(name: string, parts: number): string {
  const project = createEmptyProject("gallery-parts", name);
  const placement = (index: number) => ({
    position: { x: 40 * index, y: 0 },
    rotation: 0 as const,
    mirror: "none" as const,
  });
  project.documents[0]!.instances.push(
    ...Array.from({ length: parts }, (_, index) => ({
      id: `R${index + 1}`,
      symbolId: "resistor",
      reference: `R${index + 1}`,
      placement: placement(index),
    })),
    { id: "GND1", symbolId: "ground", placement: placement(parts + 1) },
  );
  return serializeProject(project);
}

describe("the Owner's Data tab (#1446)", () => {
  it("answers only the Owner's own accounts, with public facts", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const submit = (name: string, ip: string) =>
      submitOne(env, name, { cookie: maker, ip });
    const bandgap = await submit("Bandgap", "203.0.113.21");
    const mirror = await submit("Mirror", "203.0.113.22");
    const legacy = await submit("Old ring", "203.0.113.23");
    const spam = await submit("Spam", "203.0.113.24");
    const stale = await submit("Withdrawn long ago", "203.0.113.25");
    const ago = (days: number) =>
      new Date(Date.now() - days * 86_400_000).toISOString();
    const sql = env.gallerySql;
    const set = (id: string, assignments: string, ...values: unknown[]) =>
      sql.exec(
        `UPDATE gallery_entries SET ${assignments} WHERE id = ?`,
        ...values,
        id,
      );
    set(
      bandgap,
      "ai_generated = 1, netlistable = 1, component_count = 10, component_count_version = 1",
    );
    set(
      mirror,
      "ai_generated = 0, netlistable = 0, component_count = 4, component_count_version = 1",
    );
    set(
      legacy,
      "owner_user_id = NULL, author = 'Old hand', ai_generated = 0, netlistable = 1, component_count_version = 0",
    );
    set(
      spam,
      "status = 'rejected', reject_reason = 'Not a circuit', reviewed_at = ?, reviewed_by = 'moderator-1'",
      ago(2),
    );
    set(stale, "status = 'recycled', recycled_at = ?", ago(40));
    sql.exec(
      "INSERT INTO gallery_likes(entry_id, user_id, liked_at) VALUES (?, ?, ?)",
      bandgap,
      "someone",
      ago(1),
    );
    const read = async (cookie?: string, query = "") =>
      route(
        env,
        new Request(
          `${ORIGIN}/api/gallery/owner-data${query}`,
          cookie ? { headers: cookieHeaders(cookie) } : {},
        ),
      );
    // The read-only credential, an administrator, a member and an AI account
    // are all refused: the Owner's accounts only.
    expect(
      (
        await route(
          env,
          new Request(`${ORIGIN}/api/gallery/owner-data`, {
            headers: { Authorization: `Bearer ${READER_TOKEN}` },
          }),
        )
      ).status,
    ).toBe(401);
    expect((await read(await adminOf(env))).status).toBe(403);
    expect((await read(maker)).status).toBe(403);
    expect((await read(await seatOf(env))).status).toBe(403);
    const owner = await ownerAccountOf(env);
    const me = (cookie: string) =>
      env.authDurable
        .fetch(
          new Request(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } }),
        )
        .then((response) => response.json() as Promise<any>);
    expect((await me(owner)).user.isOwner).toBe(true);
    expect((await me(await adminOf(env))).user.isOwner).toBeUndefined();

    const response = await read(owner);
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    const [made] = sql
      .exec<{ author: string; owner_user_id: string; latest: string }>(
        "SELECT author, owner_user_id, MAX(created_at) AS latest FROM gallery_entries WHERE id IN (?, ?)",
        bandgap,
        mirror,
      )
      .toArray();
    expect(data.authors).toEqual([
      {
        author: made!.author,
        key: made!.owner_user_id,
        circuits: 2,
        averageParts: 7,
        ai: 1,
        withNetlist: 1,
        likes: 1,
        latest: made!.latest,
      },
      {
        author: "Old hand",
        key: "legacy:Old hand",
        circuits: 1,
        averageParts: null,
        ai: 0,
        withNetlist: 1,
        likes: 0,
        latest: expect.any(String),
      },
    ]);
    // A rejected or withdrawn circuit is no public fact: not counted, not
    // named, and neither is who reviewed it.
    expect(JSON.stringify(data)).not.toContain("Spam");
    expect(JSON.stringify(data)).not.toContain("Withdrawn long ago");
    expect(JSON.stringify(data)).not.toContain("moderator-1");
    expect(JSON.stringify(data)).not.toContain("@example.com");

    const circuits = async (key: string) =>
      (
        (await (
          await read(owner, `?author=${encodeURIComponent(key)}`)
        ).json()) as any
      ).circuits;
    expect(
      (await circuits(made!.owner_user_id))
        .map((item: any) => item.name)
        .sort(),
    ).toEqual(["Bandgap", "Mirror"]);
    expect(
      (await circuits(made!.owner_user_id)).find(
        (item: any) => item.id === bandgap,
      ),
    ).toEqual({
      id: bandgap,
      name: "Bandgap",
      createdAt: expect.any(String),
      parts: 10,
      netlistable: true,
      aiGenerated: true,
      likes: 1,
    });
    expect(
      (await circuits("legacy:Old hand")).map((item: any) => item.id),
    ).toEqual([legacy]);
  });
});

describe("newest-first gallery feed", () => {
  it("covers feed statistics without changing paged, filtered or viewer-specific responses", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const ids = await wallOf(env, 7);
    env.gallerySql.exec(
      "UPDATE gallery_entries SET tags = ',amplifier,' WHERE id = ?",
      ids[0]!,
    );
    env.gallerySql.exec(
      "UPDATE gallery_entries SET author = 'Other', netlistable = 1 WHERE id = ?",
      ids[1]!,
    );
    env.gallerySql.exec(
      "UPDATE gallery_entries SET status = 'pending' WHERE id = ?",
      ids[2]!,
    );
    const createIndex = env.galleryQueries.find((q) =>
      q.includes("CREATE INDEX IF NOT EXISTS idx_gallery_entries_feed_stats"),
    )!;
    expect(createIndex).toBeDefined();
    const first = await galleryPage(env);
    const variants = [
      "",
      "limit=1",
      `limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
      "tags=amplifier",
      "netlistable=1",
      "author=Other",
      "liked=1",
      "attention=1",
      "parts=0-5",
      "parts=6-10,26-",
      "ai=ai",
      "ai=human&netlistable=1",
    ];
    const read = async () => {
      const results = [];
      for (const query of variants) {
        for (const signedIn of [false, true]) {
          const response = await route(
            env,
            new Request(`${ORIGIN}/api/gallery?${query}`, {
              headers: signedIn ? { cookie } : {},
            }),
          );
          results.push({
            status: response.status,
            body: await response.json(),
          });
        }
      }
      return results;
    };
    env.gallerySql.exec("DROP INDEX idx_gallery_entries_feed_stats_ai");
    const before = await read();
    env.gallerySql.exec(createIndex);
    const after = await read();
    expect(after).toEqual(before);
    // Every count a page carries, the AI and Human pair's among them: one
    // that read ai_generated off the row walked each entry's Project and SVG
    // text, about 139,000 pages of a 1,269-entry Gallery per click (#1463).
    const queries = env.galleryQueries.filter(
      (q) =>
        q.includes("FROM gallery_entries e") &&
        (q.includes("AS total") ||
          q.includes("MAX(e.author)") ||
          q.includes("e.ai_generated = 1 THEN")),
    );
    expect(queries.some((q) => q.includes("e.ai_generated = 1 THEN"))).toBe(
      true,
    );
    for (const query of [
      ...queries.filter((q) => (q.match(/\?/g) ?? []).length <= 4).slice(0, 2),
      queries.find((q) => q.includes("e.ai_generated = 1 THEN"))!,
    ]) {
      const bindings = Array.from(
        { length: (query.match(/\?/g) ?? []).length },
        () => "",
      );
      const plan = env.gallerySql
        .exec<{ detail: string }>(`EXPLAIN QUERY PLAN ${query}`, ...bindings)
        .toArray();
      expect(
        plan.some((step) =>
          step.detail.includes("COVERING INDEX idx_gallery_entries_feed_stats"),
        ),
      ).toBe(true);
    }
    // Metadata updates must be visible immediately; there is no statistics TTL.
    env.gallerySql.exec(
      "UPDATE gallery_entries SET status = 'public' WHERE id = ?",
      ids[2]!,
    );
    expect((await galleryPage(env)).total).toBe(first.total + 1);
  });
  async function galleryPage(
    env: Harness,
    cursor?: string,
  ): Promise<{
    entries: { id: string; createdAt: string }[];
    nextCursor: string | null;
    total: number;
  }> {
    const params = new URLSearchParams({ limit: "3" });
    if (cursor) params.set("cursor", cursor);
    const response = await route(
      env,
      new Request(`${ORIGIN}/api/gallery?${params.toString()}`),
    );
    const payload = (await response.json()) as {
      entries: { id: string; createdAt: string }[];
      nextCursor: string | null;
      total: number;
    };
    return payload;
  }

  async function wallOf(env: Harness, count: number): Promise<string[]> {
    const cookie = await adminOf(env);
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(await submitOne(env, `Circuit ${index}`, { cookie }));
    }
    return ids;
  }

  it("pages newest-first without repeating or skipping a circuit", async () => {
    const env = environment();
    const wall = await wallOf(env, 7);

    const first = await galleryPage(env);
    const second = await galleryPage(env, first.nextCursor!);
    const third = await galleryPage(env, second.nextCursor!);
    expect(third.nextCursor).toBeNull();

    const entries = [...first.entries, ...second.entries, ...third.entries];
    const seen = entries.map((entry) => entry.id);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual([...wall].sort());
    const order = entries.map((entry) => `${entry.createdAt}|${entry.id}`);
    expect(order).toEqual([...order].sort().reverse());
  });

  async function orderedPage(
    env: Harness,
    order: string,
    seed: string,
    cursor?: string,
  ) {
    const params = new URLSearchParams({ limit: "3", order, seed });
    if (cursor) params.set("cursor", cursor);
    const response = await route(
      env,
      new Request(`${ORIGIN}/api/gallery?${params.toString()}`),
    );
    return (await response.json()) as {
      entries: { id: string; createdAt: string; componentCount?: number }[];
      nextCursor: string | null;
      total: number;
    };
  }
  async function walk(env: Harness, order: string, seed = "") {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 10; pages += 1) {
      const page = await orderedPage(env, order, seed, cursor);
      seen.push(...page.entries.map((entry) => entry.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return seen;
  }

  it("shuffles by a seed, steady from page to page, every circuit once (#1615)", async () => {
    const env = environment();
    const wall = await wallOf(env, 8);
    const first = await walk(env, "random", "abc123");
    expect(first).toHaveLength(8);
    expect([...first].sort()).toEqual([...wall].sort());
    // The same seed gives the same order; another seed another one, and
    // neither is simply newest first.
    expect(await walk(env, "random", "abc123")).toEqual(first);
    const other = await walk(env, "random", "zz9");
    expect([...other].sort()).toEqual([...wall].sort());
    expect(other).not.toEqual(first);
    expect(first).not.toEqual(await walk(env, "newest"));
    // Without a seed, the order falls back to newest first.
    expect(await walk(env, "random", "")).toEqual(await walk(env, "newest"));
  });

  it("orders by most parts, then newest, paging without repeats (#1615)", async () => {
    const env = environment();
    const wall = await wallOf(env, 7);
    const parts = [3, 9, 1, 9, 5, 0, 7];
    wall.forEach((id, index) =>
      env.gallerySql.exec(
        "UPDATE gallery_entries SET component_count = ?, component_count_version = 1 WHERE id = ?",
        parts[index]!,
        id,
      ),
    );
    const seen = await walk(env, "parts");
    expect(seen).toHaveLength(7);
    const count = new Map(wall.map((id, index) => [id, parts[index]!]));
    const counts = seen.map((id) => count.get(id)!);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    // Equal counts: the newer first.
    const nines = seen.filter((id) => count.get(id) === 9);
    expect(nines).toEqual([wall[3], wall[1]]);
    // Fewest first, with a circuit whose count is unknown last either way.
    env.gallerySql.exec(
      "UPDATE gallery_entries SET component_count_version = 0 WHERE id = ?",
      wall[5]!,
    );
    const fewest = await walk(env, "fewest");
    expect(fewest).toHaveLength(7);
    expect(fewest.at(-1)).toBe(wall[5]);
    const known = fewest.slice(0, -1).map((id) => count.get(id)!);
    expect(known).toEqual([...known].sort((a, b) => a - b));
    expect((await walk(env, "parts")).at(-1)).toBe(wall[5]);
  });

  it("orders oldest first, the reverse of newest first (#1615)", async () => {
    const env = environment();
    await wallOf(env, 7);
    const oldest = await walk(env, "oldest");
    expect(oldest).toHaveLength(7);
    expect(oldest).toEqual([...(await walk(env, "newest"))].reverse());
  });

  it("stops when the newest-first cursor chain is exhausted", async () => {
    const env = environment();
    const empty = await galleryPage(env);
    expect(empty).toEqual({
      entries: [],
      nextCursor: null,
      total: 0,
      filterCounts: {
        attention: 0,
        netlistable: 0,
        withoutNetlist: 0,
        ai: 0,
        human: 0,
        liked: 0,
        componentRanges: sizes(0),
      },
      authors: [],
    });

    await wallOf(env, 2);
    const full = await galleryPage(env);
    expect(full.entries).toHaveLength(2);
    expect(full.nextCursor).toBeNull();
  });

  it("reads feed summaries without loading stored Project or SVG payloads", async () => {
    const env = environment();
    await wallOf(env, 2);
    env.galleryQueries.length = 0;

    const page = await galleryPage(env);
    expect(page.entries).toHaveLength(2);
    const feedQuery = env.galleryQueries.find((query) =>
      query.includes("FROM gallery_entries e"),
    );
    expect(feedQuery).toBeDefined();
    expect(feedQuery).not.toContain("e.*");
    expect(feedQuery).not.toContain("project_text");
    expect(feedQuery).not.toContain("svg_text");
  });

  it("carries the whole wall's total on every page and counts the filtered set", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    for (let index = 0; index < 4; index += 1) {
      await submitOne(env, `Plain ${index}`, { cookie });
    }
    for (let index = 0; index < 3; index += 1) {
      const response = await route(
        env,
        submissionRequest(
          {
            name: `Tagged ${index}`,
            description: "d",
            tags: ["ldo"],
            projectText: projectText(`Tagged ${index}`),
          },
          { cookie },
        ),
      );
      expect(response.status).toBe(201);
    }

    // The client renders one page at a time; the total is the whole wall's
    // size and must not shrink to the page or drift between pages.
    const first = await galleryPage(env);
    expect(first.entries).toHaveLength(3);
    expect(first.total).toBe(7);
    const second = await galleryPage(env, first.nextCursor!);
    expect(second.total).toBe(7);

    // With a filter on, the total counts the filtered set, not the gallery.
    const filtered = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery?tags=ldo`))
    ).json()) as { entries: unknown[]; total: number };
    expect(filtered.entries).toHaveLength(3);
    expect(filtered.total).toBe(3);
  });

  it("answers a search on the server, over metadata, before counts and pages", async () => {
    const env = environment();
    const ids = await wallOf(env, 6);
    const fixtures = [
      [
        "Three-stage loop",
        "Alice",
        "Nested Miller compensation",
        ",amplifier,",
      ],
      ["Ring Oscillator", "Bob", "Three-stage ring", ",oscillator,"],
      ["Bandgap", "Carol", "Stable reference", ",reference,"],
      ["Folded cascode", "Dora", "", ",amplifier,stage,"],
      ["LDO", "Eve", "", ",regulator,"],
      ["Hidden stage", "Fay", "", ",amplifier,", "rejected"],
    ] as const;
    fixtures.forEach(([name, author, description, tags, status], index) =>
      env.gallerySql.exec(
        "UPDATE gallery_entries SET name=?, author=?, owner_user_id=?, description=?, tags=?, status=? WHERE id=?",
        name,
        author,
        `owner-${index}`,
        description,
        tags,
        status ?? "public",
        ids[index]!,
      ),
    );
    const list = async (query: string) =>
      (await (
        await route(env, new Request(`${ORIGIN}/api/gallery?${query}`))
      ).json()) as {
        entries: { id: string; name: string }[];
        nextCursor: string | null;
        total: number;
        search?: string;
        authors: { author: string; count: number }[];
      };
    const names = (page: { entries: { name: string }[] }) =>
      page.entries.map((entry) => entry.name).sort();
    // Any case, over a name, a description or a tag; never a hidden one.
    env.galleryQueries.length = 0;
    const stage = await list("q=STAGE");
    expect(names(stage)).toEqual([
      "Folded cascode",
      "Ring Oscillator",
      "Three-stage loop",
    ]);
    expect(stage.total).toBe(3);
    // The answer says which search it is, so its counts are read as its.
    expect(stage.search).toBe("STAGE");
    expect(await list("tags=amplifier")).not.toHaveProperty("search");
    // Read from metadata: no search query touches Project Code or previews.
    expect(env.galleryQueries.join("\n")).not.toMatch(/project_text|svg_text/u);
    // The browser's one-edit tolerance, word for word.
    expect(names(await list("q=stgae"))).toEqual(names(stage));
    // A byline or a description alone.
    expect(names(await list("q=carol"))).toEqual(["Bandgap"]);
    expect(names(await list("q=miller"))).toEqual(["Three-stage loop"]);
    // Contributors and pages describe the same answer.
    expect(stage.authors.map((author) => author.author).sort()).toEqual([
      "Alice",
      "Bob",
      "Dora",
    ]);
    const first = await list("q=stage&limit=2");
    expect(first.total).toBe(3);
    const second = await list(
      `q=stage&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(second.nextCursor).toBeNull();
    expect([...names(first), ...names(second)].sort()).toEqual(names(stage));
    // Other filters narrow the answer further.
    expect(names(await list("q=stage&tags=amplifier"))).toEqual([
      "Folded cascode",
      "Three-stage loop",
    ]);
    // So do the tag counts beside it.
    const tags = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/tags?q=stage`))
    ).json()) as { tags: { tag: string; count: number }[] };
    expect(tags.tags).toEqual([
      { tag: "amplifier", count: 2 },
      { tag: "oscillator", count: 1 },
      { tag: "stage", count: 1 },
    ]);
    // Blank words search nothing and change nothing.
    expect((await list("q=%20-%20")).total).toBe(5);
  });

  it("ranks public contributors by circuit count and excludes hidden or blank bylines", async () => {
    const env = environment();
    const ids = await wallOf(env, 6);
    env.gallerySql.exec(
      `UPDATE gallery_entries SET author = ?, owner_user_id = ?
       WHERE id IN (?, ?)`,
      "Alice",
      "owner-alice",
      ids[0]!,
      ids[1]!,
    );
    env.gallerySql.exec(
      "UPDATE gallery_entries SET author = ?, owner_user_id = ? WHERE id = ?",
      "Chen",
      "owner-chen",
      ids[2]!,
    );
    env.gallerySql.exec(
      "UPDATE gallery_entries SET author = ?, owner_user_id = ? WHERE id = ?",
      "Bob",
      "owner-bob",
      ids[3]!,
    );
    env.gallerySql.exec(
      "UPDATE gallery_entries SET author = '', owner_user_id = ? WHERE id = ?",
      "owner-blank",
      ids[4]!,
    );
    env.gallerySql.exec(
      `UPDATE gallery_entries
       SET author = ?, owner_user_id = ?, status = 'rejected' WHERE id = ?`,
      "Hidden",
      "owner-hidden",
      ids[5]!,
    );

    const response = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/authors`),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      authors: [
        { author: "Alice", ownerUserId: "owner-alice", count: 2 },
        { author: "Bob", ownerUserId: "owner-bob", count: 1 },
        { author: "Chen", ownerUserId: "owner-chen", count: 1 },
      ],
    });
  });

  it("counts contributors within all feed filters before pagination", async () => {
    const env = environment();
    const ids = await wallOf(env, 6);
    const fixtures = [
      ["Alice", "owner-a", ",amplifier,", 1, "public"],
      ["Alice", "owner-a", ",amplifier,", 0, "public"],
      ["Alice", "owner-b", ",oscillator,", 1, "public"],
      ["Bob", "owner-c", ",amplifier,", 1, "public"],
      ["", "owner-blank", ",amplifier,", 1, "public"],
      ["Hidden", "owner-hidden", ",amplifier,", 1, "rejected"],
    ] as const;
    fixtures.forEach((fixture, index) =>
      env.gallerySql.exec(
        "UPDATE gallery_entries SET author=?, owner_user_id=?, tags=?, netlistable=?, status=? WHERE id=?",
        ...fixture,
        ids[index]!,
      ),
    );
    const list = async (query = "") =>
      (await (
        await route(env, new Request(`${ORIGIN}/api/gallery?${query}`))
      ).json()) as {
        entries: { id: string }[];
        nextCursor: string;
        authors: { author: string; ownerUserId: string; count: number }[];
      };
    const first = await list("limit=1&tags=amplifier");
    expect(first.entries).toHaveLength(1);
    expect(first.authors).toEqual([
      { author: "Alice", ownerUserId: "owner-a", count: 2 },
      { author: "Bob", ownerUserId: "owner-c", count: 1 },
    ]);
    expect(
      (
        await list(
          `limit=1&tags=amplifier&cursor=${encodeURIComponent(first.nextCursor)}`,
        )
      ).authors,
    ).toEqual(first.authors);
    expect((await list("tags=amplifier&netlistable=1")).authors).toEqual([
      { author: "Alice", ownerUserId: "owner-a", count: 1 },
      { author: "Bob", ownerUserId: "owner-c", count: 1 },
    ]);
    expect((await list("author=Alice&tags=amplifier")).authors).toEqual([
      first.authors[0],
    ]);
    expect((await list("owner=owner-b")).authors).toEqual([
      { author: "Alice", ownerUserId: "owner-b", count: 1 },
    ]);
    expect((await list("owner=owner-b&tags=amplifier")).authors).toEqual([]);
  });

  it("filters same-name contributors by stable owner identity", async () => {
    const env = environment();
    const ids = await wallOf(env, 2);
    env.gallerySql.exec(
      "UPDATE gallery_entries SET author = ?, owner_user_id = ? WHERE id = ?",
      "Shared Name",
      "owner-a",
      ids[0]!,
    );
    env.gallerySql.exec(
      "UPDATE gallery_entries SET author = ?, owner_user_id = ? WHERE id = ?",
      "Shared Name",
      "owner-b",
      ids[1]!,
    );

    const legacy = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery?author=Shared%20Name`),
      )
    ).json()) as {
      entries: Array<{ id: string; ownerUserId: string | null }>;
      total: number;
    };
    expect(new Set(legacy.entries.map((entry) => entry.id))).toEqual(
      new Set(ids),
    );
    expect(legacy.total).toBe(2);

    const exact = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery?author=Shared%20Name&owner=owner-a`),
      )
    ).json()) as {
      entries: Array<{ id: string; ownerUserId: string | null }>;
      total: number;
    };
    expect(
      exact.entries.map(({ id, ownerUserId }) => ({ id, ownerUserId })),
    ).toEqual([{ id: ids[0], ownerUserId: "owner-a" }]);
    expect(exact.total).toBe(1);
  });
});

describe("netlist marks and thumbs", () => {
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

  it("narrows the wall by mark, by like, and by the session behind it", async () => {
    // Same two marks the tiles wear, asked of the list instead: a reader who
    // wants the finished circuits, or their own shortlist, should not have to
    // scroll the whole wall looking for glyphs.
    const env = environment();
    const cookie = await adminOf(env);
    const sketch = createEmptyProject("sketch", "Sketch");
    sketch.documents[0]!.instances.push({
      id: "S1",
      symbolId: "ideal-switch",
      reference: "S1",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    const sketchId = await submitOne(env, "Sketch", {
      cookie,
      text: serializeProject(sketch),
    });
    const extractableId = await submitOne(env, "Extractable", { cookie });
    expect((await route(env, likeRequest(sketchId, cookie))).status).toBe(200);

    const list = async (query: string, viewer?: string) => {
      const response = await route(
        env,
        new Request(
          `${ORIGIN}/api/gallery?${query}`,
          viewer ? { headers: cookieHeaders(viewer) } : undefined,
        ),
      );
      return (await response.json()) as {
        entries: { id: string }[];
        total: number;
        nextCursor: string | null;
        filterCounts: {
          attention: number;
          netlistable: number;
          withoutNetlist: number;
          ai: number;
          human: number;
          liked: number;
          componentRanges: Record<string, number>;
        };
        authors: { author: string; ownerUserId: string; count: number }[];
      };
    };

    const firstPage = await list("limit=1", cookie);
    expect(firstPage.entries).toHaveLength(1);
    expect(firstPage.filterCounts).toEqual({
      attention: 0,
      netlistable: 1,
      withoutNetlist: 1,
      ai: 0,
      human: 2,
      liked: 1,
      componentRanges: sizes(2),
    });
    const secondPage = await list(
      `limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      cookie,
    );
    expect(secondPage.filterCounts).toEqual(firstPage.filterCounts);
    expect(firstPage.authors).toHaveLength(1);
    expect(firstPage.authors[0]!.count).toBe(2);
    expect(secondPage.authors).toEqual(firstPage.authors);
    expect((await list("")).filterCounts).toEqual({
      attention: 0,
      netlistable: 1,
      withoutNetlist: 1,
      ai: 0,
      human: 2,
      liked: 0,
      componentRanges: sizes(2),
    });

    const marked = await list("netlistable=1", cookie);
    expect(marked.entries.map((entry) => entry.id)).toEqual([extractableId]);
    // The total describes the narrowed wall, so paging stays honest.
    expect(marked.total).toBe(1);
    expect(marked.authors).toEqual([{ ...firstPage.authors[0], count: 1 }]);
    // Each side of a pair says what choosing it would show: with the
    // netlist chosen, the circuit without one is still counted beside it.
    expect(marked.filterCounts).toEqual({
      attention: 0,
      netlistable: 1,
      withoutNetlist: 1,
      ai: 0,
      human: 1,
      liked: 0,
      componentRanges: sizes(1),
    });
    const unmarked = await list("netlistable=0", cookie);
    expect(unmarked.entries.map((entry) => entry.id)).toEqual([sketchId]);
    expect(unmarked.total).toBe(1);

    const liked = await list("liked=1", cookie);
    expect(liked.entries.map((entry) => entry.id)).toEqual([sketchId]);
    expect(liked.total).toBe(1);
    expect(liked.authors).toEqual(marked.authors);
    expect(liked.filterCounts).toEqual({
      attention: 0,
      netlistable: 0,
      withoutNetlist: 1,
      ai: 0,
      human: 1,
      liked: 1,
      componentRanges: sizes(1),
    });

    // The marks compose, and here nothing satisfies both.
    const both = await list("netlistable=1&liked=1", cookie);
    expect(both.entries).toHaveLength(0);
    expect(both.total).toBe(0);
    expect(both.authors).toEqual([]);
    expect(both.filterCounts).toEqual({
      attention: 0,
      netlistable: 0,
      withoutNetlist: 1,
      ai: 0,
      human: 0,
      liked: 0,
      componentRanges: sizes(0),
    });

    // The AI mark narrows the same way; neither circuit carries it.
    expect((await list("ai=1", cookie)).entries).toHaveLength(0);
    expect((await list("ai=0", cookie)).total).toBe(2);

    // A like belongs to an account: signed out, "the ones I liked" is none of
    // them rather than all of them.
    const anonymous = await list("liked=1");
    expect(anonymous.entries).toHaveLength(0);
    expect(anonymous.total).toBe(0);
    expect(anonymous.authors).toEqual([]);
    expect((await list("", cookie)).entries).toHaveLength(2);
  });

  it("narrows the wall by size in parts, any of several sizes at once", async () => {
    // Supply and ground markers name Nets rather than add parts: three
    // resistors and a Ground make a three-part drawing.
    const env = environment();
    const cookie = await adminOf(env);
    const submit = (name: string, parts: number) =>
      submitOne(env, name, { cookie, text: partsProjectText(name, parts) });
    const small = await submit("Small", 3);
    const medium = await submit("Medium", 7);
    const large = await submit("Large", 12);
    const list = async (query: string) => {
      const response = await route(
        env,
        new Request(`${ORIGIN}/api/gallery?${query}`, {
          headers: cookieHeaders(cookie),
        }),
      );
      return (await response.json()) as {
        entries: { id: string; componentCount?: number }[];
        total: number;
        filterCounts: { componentRanges: Record<string, number> };
      };
    };
    const ids = (page: { entries: { id: string }[] }) =>
      page.entries.map((entry) => entry.id).sort();

    const all = await list("");
    expect(
      Object.fromEntries(
        all.entries.map((entry) => [entry.id, entry.componentCount]),
      ),
    ).toEqual({ [small]: 3, [medium]: 7, [large]: 12 });
    expect(all.filterCounts.componentRanges).toEqual(
      sizes(1, { "6-10": 1, "11-15": 1 }),
    );

    const one = await list("parts=6-10");
    expect(ids(one)).toEqual([medium]);
    expect(one.total).toBe(1);
    // The size counts leave the size choice out, so the other sizes still
    // say what choosing them would add.
    expect(one.filterCounts.componentRanges).toEqual(
      all.filterCounts.componentRanges,
    );
    // Several sizes mean any of them.
    expect(ids(await list("parts=0-5,11-15"))).toEqual([small, large].sort());
    expect((await list("parts=16-25,26-")).total).toBe(0);
    // A size this build does not know narrows nothing.
    expect((await list("parts=huge")).total).toBe(3);
  });

  it("counts the parts of entries published before the count existed", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Older", {
      cookie,
      text: partsProjectText("Older", 7),
    });
    // As an entry stored before this rule reads: never counted.
    env.gallerySql.exec(
      "UPDATE gallery_entries SET component_count = 0, component_count_version = 0",
    );
    const counted = async () => {
      const response = await route(
        env,
        new Request(`${ORIGIN}/api/gallery`, {
          headers: cookieHeaders(cookie),
        }),
      );
      const page = (await response.json()) as {
        entries: { id: string; componentCount?: number }[];
      };
      return page.entries.find((entry) => entry.id === id)!.componentCount;
    };
    expect(await counted()).toBeUndefined();

    const { status, payload } = await refreshNetlistMarks(env, 50);
    expect(status).toBe(200);
    expect(payload).toMatchObject({ scanned: 1, changed: 1, remaining: 0 });
    expect(await counted()).toBe(7);
  });

  it("marks a circuit with missing process fields as not netlistable", async () => {
    // Gallery marks use the same strict contract as editor export. Missing
    // models or required values cannot be represented by a usable netlist.
    const env = environment();
    const cookie = await adminOf(env);
    const unbound = createEmptyProject("unbound", "Unbound");
    const document = unbound.documents[0]!;
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      reference: "M1",
      netlist: { parameters: {} },
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    document.nets.push(
      {
        id: "net-top",
        terminals: [
          { instanceId: "M1", pinName: "G" },
          { instanceId: "M1", pinName: "D" },
        ],
      },
      {
        id: "net-bottom",
        terminals: [
          { instanceId: "M1", pinName: "S" },
          { instanceId: "M1", pinName: "B" },
        ],
      },
    );
    const id = await submitOne(env, "Unbound", {
      cookie,
      text: serializeProject(unbound),
    });
    const entry = (await feed(env)).entries.find((item) => item.id === id);
    expect(entry?.netlistable).toBe(false);
  });

  it("re-answers only the marks an older rule produced", async () => {
    // A stored mark is only as good as the rule that produced it. Entries
    // carry that rule's version, so a deployed change leaves exactly the
    // stale rows to find: no cursor to carry between batches, and no work
    // repeated over answers that are already current.
    const env = environment();
    const cookie = await adminOf(env);
    const first = await submitOne(env, "Batch one", { cookie });
    const second = await submitOne(env, "Batch two", { cookie });
    // Publishing stamped the current rule, so the pass has nothing to do.
    const refresh = async (limit: number) => {
      const response = await route(
        env,
        new Request(`${ORIGIN}/api/gallery/maintenance/netlist-badges`, {
          method: "POST",
          headers: {
            ...cookieHeaders(cookie),
            "content-type": "application/json",
          },
          body: JSON.stringify({ limit }),
        }),
      );
      expect(response.status).toBe(200);
      return (await response.json()) as {
        scanned: number;
        changed: number;
        unreadable: number;
        ruleVersion: number;
        remaining: number;
      };
    };
    expect(await refresh(50)).toMatchObject({ scanned: 0, remaining: 0 });

    // Now the rule has moved: both marks came from an older answer.
    env.gallerySql.exec(
      "UPDATE gallery_entries SET netlistable = 0, netlistable_version = 0",
    );
    expect((await feed(env)).entries.every((entry) => !entry.netlistable)).toBe(
      true,
    );

    const firstBatch = await refresh(1);
    expect(firstBatch).toMatchObject({ scanned: 1, changed: 1, remaining: 1 });
    expect(firstBatch.ruleVersion).toBeGreaterThan(0);
    expect(await refresh(1)).toMatchObject({
      scanned: 1,
      changed: 1,
      remaining: 0,
    });
    // Idempotent: a further pass finds nothing, with no cursor to remember.
    expect(await refresh(50)).toMatchObject({ scanned: 0, remaining: 0 });

    const marked = (await feed(env)).entries;
    expect(marked.map((entry) => entry.netlistable)).toEqual([true, true]);
    expect(new Set(marked.map((entry) => entry.id))).toEqual(
      new Set([first, second]),
    );
  });

  it("keeps the mark pass behind the admin check", async () => {
    const env = environment();
    const response = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/netlist-badges`, {
        method: "POST",
        headers: { Origin: ORIGIN, "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
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

describe("gallery circuit tags", () => {
  it("scopes tag and deduplicated group counts to the netlist mark and the contributor without exposing hidden entries", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const sketch = createEmptyProject("sketch", "Sketch");
    sketch.documents[0]!.instances.push({
      id: "S1",
      symbolId: "ideal-switch",
      reference: "S1",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    for (const [name, tags, text] of [
      ["Extractable", ["amplifier", "ota"], projectText("Extractable")],
      ["Sketch", ["amplifier", "comparator"], serializeProject(sketch)],
      ["Hidden", ["amplifier", "buffer"], projectText("Hidden")],
    ] as const) {
      const response = await route(
        env,
        submissionRequest({ name, tags, projectText: text }, { cookie }),
      );
      expect(response.status).toBe(201);
    }
    env.gallerySql.exec(
      "UPDATE gallery_entries SET status = 'rejected' WHERE name = 'Hidden'",
    );
    const summary = async (query = "") =>
      (
        await route(env, new Request(`${ORIGIN}/api/gallery/tags${query}`))
      ).json();
    const all = await summary();
    expect(all).toMatchObject({
      tags: expect.arrayContaining([
        { tag: "amplifier", count: 2 },
        { tag: "comparator", count: 1 },
      ]),
      groups: expect.arrayContaining([
        { group: "Amplifiers", count: 2 },
        { group: "Conversion", count: 1 },
      ]),
    });
    expect(await summary("?netlistable=1")).toEqual({
      tags: [
        { tag: "amplifier", count: 1 },
        { tag: "ota", count: 1 },
      ],
      groups: [{ group: "Amplifiers", count: 1 }],
    });
    // "0" asks for the other side: circuits that do not extract.
    expect(await summary("?netlistable=0")).toEqual({
      tags: [
        { tag: "amplifier", count: 1 },
        { tag: "comparator", count: 1 },
      ],
      groups: expect.arrayContaining([{ group: "Amplifiers", count: 1 }]),
    });
    expect(await summary("?netlistable=")).toEqual(all);
    env.gallerySql.exec(
      "UPDATE gallery_entries SET author = 'Bob', owner_user_id = 'owner-bob' WHERE name = 'Sketch'",
    );
    const bob = {
      tags: [
        { tag: "amplifier", count: 1 },
        { tag: "comparator", count: 1 },
      ],
      groups: [
        { group: "Amplifiers", count: 1 },
        { group: "Conversion", count: 1 },
      ],
    };
    expect(await summary("?owner=owner-bob")).toEqual(bob);
    // A byline alone, as an older link names a contributor.
    expect(await summary("?author=Bob")).toEqual(bob);
    expect(await summary("?owner=owner-bob&netlistable=1")).toEqual({
      tags: [],
      groups: [],
    });
  });

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
      groups: { group: string; count: number }[];
      categories?: unknown;
    };
    expect(counts.tags[0]).toEqual({ tag: "amplifier", count: 2 });
    expect(counts.groups).toContainEqual({ group: "Amplifiers", count: 2 });
    expect(counts).not.toHaveProperty("categories");

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
