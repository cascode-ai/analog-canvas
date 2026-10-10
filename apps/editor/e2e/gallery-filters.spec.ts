// Narrowing the wall: netlist marks, likes, quick filters, Needs attention and
// part counts, with the counts and remembered choices that follow them.

import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";
import { ENTRY, galleryListUrl } from "./gallery-fixtures.js";

test("narrows the wall by netlist mark and by the reader's own likes", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u-reader",
          displayName: "Reader",
          email: "reader@example.com",
          provider: "github",
          role: "user",
        },
      },
    }),
  );
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/gallery") return route.fallback();
    const tile = (
      id: string,
      name: string,
      netlistable: boolean,
      liked: boolean,
    ) => ({
      id,
      name,
      author: "reader",
      description: "",
      createdAt: "2026-08-22T10:00:00.000Z",
      schemaVersion: 23,
      netlistable,
      likes: liked ? 1 : 0,
      likedByViewer: liked,
      // The extractable one an Agent drew; the sketch is by hand.
      aiGenerated: netlistable,
    });
    const all = [
      tile("f-ready", "Extractable", true, false),
      tile("f-sketch", "Sketch", false, true),
    ];
    const netlist = url.searchParams.get("netlistable");
    const ai = url.searchParams.get("ai");
    const entries = all.filter(
      (entry) =>
        (netlist === null || entry.netlistable === (netlist === "1")) &&
        (ai === null || entry.aiGenerated === (ai === "1")) &&
        (url.searchParams.get("liked") !== "1" || entry.likedByViewer),
    );
    return route.fulfill({ json: { entries, nextCursor: null } });
  });
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-f-sketch")).toBeVisible();

  await page.getByTestId("gallery-filter-netlistable").click();
  await expect(page.getByTestId("gallery-tile-f-ready")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-f-sketch")).toHaveCount(0);
  await expect(page).toHaveURL(/netlist=1/u);

  // The two marks compose, and here nothing carries both: the wall says which
  // choice emptied it rather than reading as an empty Gallery.
  await page.getByTestId("gallery-filter-liked").click();
  await expect(page.getByTestId("gallery-mark-empty")).toBeVisible();

  await page.getByTestId("gallery-filter-netlistable").click();
  await expect(page.getByTestId("gallery-tile-f-sketch")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-f-ready")).toHaveCount(0);
  await page.getByTestId("gallery-filter-liked").click();

  // The sides of a pair exclude each other: choosing "Without netlist" after
  // "With netlist" moves the choice, and choosing it again shows both.
  const withNetlist = page.getByTestId("gallery-filter-netlistable");
  const withoutNetlist = page.getByTestId("gallery-filter-without-netlist");
  await withNetlist.click();
  await withoutNetlist.click();
  await expect(withNetlist).toHaveAttribute("aria-pressed", "false");
  await expect(withoutNetlist).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/netlist=0/u);
  await expect(page.getByTestId("gallery-tile-f-sketch")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-f-ready")).toHaveCount(0);
  await withoutNetlist.click();
  await expect(page.getByTestId("gallery-tile-f-ready")).toBeVisible();
  await expect(page).not.toHaveURL(/netlist=/u);

  // Only AI-generated, then only by hand, the same way.
  const ai = page.getByTestId("gallery-filter-ai");
  const human = page.getByTestId("gallery-filter-human");
  await expect(ai).toContainText("AI generated");
  await ai.click();
  await expect(page).toHaveURL(/ai=1/u);
  await expect(page.getByTestId("gallery-tile-f-ready")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-f-sketch")).toHaveCount(0);
  await human.click();
  await expect(ai).toHaveAttribute("aria-pressed", "false");
  await expect(page).toHaveURL(/ai=0/u);
  await expect(page.getByTestId("gallery-tile-f-sketch")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-f-ready")).toHaveCount(0);
});

test("quick filters show right-aligned counts and follow filters, search and likes", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "reader",
          displayName: "Reader",
          email: "reader@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  let entries = [
    {
      ...ENTRY,
      id: "count-amp",
      author: "Alice",
      ownerUserId: "owner-a",
      name: "Amplifier",
      tags: ["amplifier"],
      netlistable: true,
      likedByViewer: true,
      attention: { status: "needs-attention", issues: [] },
    },
    {
      ...ENTRY,
      id: "count-osc",
      author: "Bob",
      ownerUserId: "owner-b",
      name: "Oscillator",
      tags: ["oscillator"],
      netlistable: true,
      likedByViewer: false,
      attention: undefined,
    },
    {
      ...ENTRY,
      id: "count-comp",
      author: "Carol",
      ownerUserId: "owner-c",
      name: "Comparator",
      tags: ["comparator"],
      netlistable: false,
      likedByViewer: true,
      attention: { status: "needs-attention", issues: [] },
    },
  ];
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/like")) {
      const id = url.pathname.split("/")[3];
      entries = entries.map((entry) =>
        entry.id === id
          ? { ...entry, likedByViewer: !entry.likedByViewer }
          : entry,
      );
      return route.fulfill({ json: { likes: 0, likedByViewer: false } });
    }
    if (url.pathname === "/api/gallery/tags")
      return route.fulfill({
        json: {
          tags: [{ tag: "amplifier", count: 1 }],
          groups: [{ group: "Amplifiers", count: 1 }],
        },
      });
    if (url.pathname.endsWith("/preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"/>',
      });
    if (url.pathname !== "/api/gallery") return route.fallback();
    const filtered = entries.filter(
      (entry) =>
        (url.searchParams.get("netlistable") !== "1" || entry.netlistable) &&
        (url.searchParams.get("liked") !== "1" || entry.likedByViewer) &&
        (url.searchParams.get("attention") !== "1" || entry.attention) &&
        (!url.searchParams.get("tags") ||
          entry.tags.includes(url.searchParams.get("tags")!)),
    );
    return route.fulfill({
      json: {
        entries: filtered,
        nextCursor: null,
        total: filtered.length,
        authors: filtered.map((entry) => ({
          author: entry.author,
          ownerUserId: entry.ownerUserId,
          count: 1,
        })),
        filterCounts: {
          attention: filtered.filter((entry) => entry.attention).length,
          netlistable: filtered.filter((entry) => entry.netlistable).length,
          liked: filtered.filter((entry) => entry.likedByViewer).length,
        },
      },
    });
  });
  await page.goto("/");
  const attention = page.getByTestId("gallery-filter-attention");
  const netlist = page.getByTestId("gallery-filter-netlistable");
  const liked = page.getByTestId("gallery-filter-liked");
  const counts = async (a: string, n: string, l: string) => {
    await expect(attention.locator(".gallery-sidebar-count")).toHaveText(a);
    await expect(netlist.locator(".gallery-sidebar-count")).toHaveText(n);
    await expect(liked.locator(".gallery-sidebar-count")).toHaveText(l);
  };
  const contributors = async (names: string[]) => {
    const menu = page.getByTestId("gallery-contributor-menu");
    if (!(await menu.evaluate((node) => node.hasAttribute("open"))))
      await page.getByTestId("gallery-count-panel").click();
    await expect(menu.locator(".gallery-contributor-author")).toHaveText(names);
    await expect(menu.locator(".gallery-contributor-heading")).toContainText(
      `${names.length} ${names.length === 1 ? "author" : "authors"}`,
    );
  };
  await counts("2", "2", "2");
  await contributors(["Alice", "Bob", "Carol"]);
  await netlist.click();
  await counts("1", "2", "1");
  await contributors(["Alice", "Bob"]);
  await attention.click();
  await counts("1", "1", "1");
  await contributors(["Alice"]);
  await netlist.click();
  await counts("2", "1", "2");
  await contributors(["Alice", "Carol"]);
  await attention.click();
  const search = page.getByTestId("gallery-search");
  await search.fill("Oscillator");
  await counts("0", "1", "0");
  await contributors(["Bob"]);
  await search.fill("nothing-matches");
  await contributors([]);
  await search.fill("Amplifier");
  await contributors(["Alice"]);
  await search.fill("");
  await counts("2", "2", "2");
  await page
    .getByRole("button", { name: "Expand Amplifiers", exact: true })
    .click();
  await page.getByTestId("gallery-tag-option-amplifier").click();
  await counts("1", "1", "1");
  await contributors(["Alice"]);
  await page.getByTestId("gallery-tags-clear").click();
  await counts("2", "2", "2");
  await liked.click();
  await counts("2", "1", "2");
  await page.getByTestId("gallery-like-count-amp").click();
  await counts("1", "0", "1");
  await contributors(["Carol"]);
  await expect(page.getByTestId("gallery-tile-count-amp")).toHaveCount(0);
  await netlist.click();
  await counts("0", "0", "0");
  await contributors([]);
  await expect(page.getByTestId("gallery-contributor-popover")).toContainText(
    "No contributors match the current filters.",
  );

  const sidebar = page.getByRole("separator", {
    name: "Resize Gallery filters",
  });
  await sidebar.focus();
  await page.keyboard.press("Home");
  const edges = await Promise.all(
    [attention, netlist, liked].map((button) =>
      button.evaluate((node) => {
        const count = node
          .querySelector(".gallery-sidebar-count")!
          .getBoundingClientRect();
        const label = node.querySelector("span")!.getBoundingClientRect();
        const bounds = node.getBoundingClientRect();
        return {
          right: count.right,
          inside: count.right <= bounds.right,
          separated: label.right <= count.left,
        };
      }),
    ),
  );
  expect(edges.every((edge) => edge.inside && edge.separated)).toBe(true);
  expect(
    Math.max(...edges.map((edge) => edge.right)) -
      Math.min(...edges.map((edge) => edge.right)),
  ).toBeLessThan(1);
});

test("netlist filter updates category and tag counts and ignores a late summary", async ({
  page,
}) => {
  const summary = (filtered: boolean) => ({
    tags: [
      { tag: "amplifier", count: filtered ? 1 : 2 },
      { tag: "ota", count: filtered ? 1 : 2 },
      ...(!filtered ? [{ tag: "comparator", count: 1 }] : []),
    ],
    groups: [
      { group: "Amplifiers", count: filtered ? 1 : 3 },
      ...(!filtered ? [{ group: "Conversion", count: 1 }] : []),
    ],
  });
  let holdFiltered = false;
  let receiveHeld!: (route: Route) => void;
  const heldRequest = new Promise<Route>((resolve) => {
    receiveHeld = resolve;
  });
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags") {
      const filtered = url.searchParams.get("netlistable") === "1";
      if (filtered && holdFiltered) {
        receiveHeld(route);
        return;
      }
      return route.fulfill({ json: summary(filtered) });
    }
    if (url.pathname === "/api/gallery")
      return route.fulfill({ json: { entries: [], nextCursor: null } });
    return route.fallback();
  });
  await page.goto("/");
  const sidebar = page.getByTestId("gallery-tag-sidebar");
  const categoryCount = (name: string) =>
    sidebar
      .getByRole("checkbox", { name, exact: true })
      .locator(".gallery-sidebar-count");
  const amplifierCount = page
    .getByTestId("gallery-tag-option-amplifier")
    .locator(".gallery-sidebar-count");
  const toggle = page.getByTestId("gallery-filter-netlistable");
  await expect(categoryCount("Amplifiers")).toHaveText("3");
  await sidebar
    .getByRole("button", { name: "Expand Amplifiers", exact: true })
    .click();
  await expect(amplifierCount).toHaveText("2");
  await toggle.click();
  await expect(categoryCount("Amplifiers")).toHaveText("1");
  await expect(amplifierCount).toHaveText("1");
  await expect(categoryCount("Conversion")).toHaveText("0");
  await toggle.click();
  await expect(categoryCount("Amplifiers")).toHaveText("3");
  await expect(amplifierCount).toHaveText("2");
  await expect(categoryCount("Conversion")).toHaveText("1");

  // A slower filtered response must not overwrite the restored full counts.
  holdFiltered = true;
  await toggle.click();
  const held = await heldRequest;
  await expect(categoryCount("Amplifiers")).toHaveText("…");
  await expect(amplifierCount).toHaveText("…");
  await toggle.click();
  await expect(categoryCount("Amplifiers")).toHaveText("3");
  const lateResponse = page.waitForResponse((response) =>
    response.url().includes("/api/gallery/tags?netlistable=1"),
  );
  await held.fulfill({ json: summary(true) });
  await lateResponse;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(categoryCount("Amplifiers")).toHaveText("3");
  await expect(amplifierCount).toHaveText("2");
});

test("netlist tag counts honor linked and remembered filters on first load", async ({
  page,
}) => {
  const scopes: boolean[] = [];
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags") {
      const filtered = url.searchParams.get("netlistable") === "1";
      scopes.push(filtered);
      return route.fulfill({
        json: {
          tags: [{ tag: "amplifier", count: filtered ? 1 : 2 }],
          groups: [{ group: "Amplifiers", count: filtered ? 1 : 2 }],
        },
      });
    }
    if (url.pathname === "/api/gallery")
      return route.fulfill({ json: { entries: [], nextCursor: null } });
    return route.fallback();
  });
  for (const url of ["/?netlist=1", "/"]) {
    scopes.length = 0;
    await page.goto(url);
    await expect(
      page
        .getByTestId("gallery-tag-sidebar")
        .getByRole("checkbox", { name: "Amplifiers", exact: true })
        .locator(".gallery-sidebar-count"),
    ).toHaveText("1");
    expect(scopes).toEqual([true]);
  }
});

test("a remembered narrowing loads the wall with its one early request", async ({
  page,
}) => {
  const lists: string[] = [];
  let firstListAsked = Number.POSITIVE_INFINITY;
  let wallCodeArrived = Number.POSITIVE_INFINITY;
  // The wall's own code arrives late, as on a slow first visit.
  // The dev server serves the module, the built editor its chunk.
  await page.route(
    "**/{src/components/gallery-feed.tsx,assets/gallery-feed-*.js}*",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      wallCodeArrived = Date.now();
      await route.continue();
    },
  );
  await page.route(galleryListUrl, (route) => {
    firstListAsked = Math.min(firstListAsked, Date.now());
    // The query without the wall's order (#1615), which every wall carries.
    const query = new URL(route.request().url()).searchParams;
    query.delete("order");
    query.delete("seed");
    lists.push(`?${query.toString()}`);
    return route.fulfill({
      json: { entries: [ENTRY], nextCursor: null, total: 1 },
    });
  });
  await page.route(`**/api/gallery/${ENTRY.id}/preview.svg*`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
    }),
  );
  await page.addInitScript(() =>
    localStorage.setItem(
      "icm.gallery-filters.v1",
      JSON.stringify({ parts: ["6-10"] }),
    ),
  );
  await page.goto("/");
  await expect(page.locator("a.gallery-tile")).toHaveCount(1);
  // The landing preload asked the remembered query before the wall's code
  // arrived, and the wall took that answer instead of asking again.
  await page.waitForLoadState("networkidle");
  expect(lists).toEqual(["?parts=6-10"]);
  expect(firstListAsked).toBeLessThan(wallCodeArrived);
});

test("needs attention and liked narrow the category and tag counts", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "maker-1",
          displayName: "Maker",
          email: "maker@example.com",
          provider: "github",
          isAdmin: false,
          role: "user",
        },
      },
    }),
  );
  const needsAttention = { status: "needs-attention", issues: [] };
  let entries = [
    {
      ...ENTRY,
      id: "amp",
      name: "Amplifier",
      ownerUserId: "maker-1",
      tags: ["amplifier", "ota"],
      likedByViewer: true,
      attention: needsAttention,
    },
    {
      ...ENTRY,
      id: "ota",
      name: "OTA",
      ownerUserId: "maker-1",
      tags: ["ota"],
      likedByViewer: true,
      attention: undefined,
    },
    {
      ...ENTRY,
      id: "cmp",
      name: "Comparator",
      ownerUserId: "maker-1",
      tags: ["comparator"],
      likedByViewer: false,
      attention: needsAttention,
    },
  ];
  // The wall and its tag counts answer the same filters from one list.
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/like")) {
      const id = url.pathname.split("/")[3];
      entries = entries.map((entry) =>
        entry.id === id
          ? { ...entry, likedByViewer: !entry.likedByViewer }
          : entry,
      );
      const liked = entries.find((entry) => entry.id === id)!.likedByViewer;
      return route.fulfill({
        json: { likes: Number(liked), likedByViewer: liked },
      });
    }
    if (url.pathname.endsWith("/preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"/>',
      });
    const matching = entries.filter(
      (entry) =>
        (url.searchParams.get("attention") !== "1" ||
          entry.attention?.status === "needs-attention") &&
        (url.searchParams.get("liked") !== "1" || entry.likedByViewer),
    );
    const count = (tags: string[]) =>
      matching.filter((entry) => entry.tags.some((tag) => tags.includes(tag)))
        .length;
    if (url.pathname === "/api/gallery/tags")
      return route.fulfill({
        json: {
          tags: ["amplifier", "ota", "comparator"]
            .map((tag) => ({ tag, count: count([tag]) }))
            .filter((option) => option.count > 0),
          groups: [
            { group: "Amplifiers", count: count(["amplifier", "ota"]) },
            { group: "Conversion", count: count(["comparator"]) },
          ].filter((group) => group.count > 0),
        },
      });
    if (url.pathname === "/api/gallery")
      return route.fulfill({
        json: { entries: matching, nextCursor: null, total: matching.length },
      });
    return route.fallback();
  });
  await page.goto("/");
  const sidebar = page.getByTestId("gallery-tag-sidebar");
  const categoryCount = (name: string) =>
    sidebar
      .getByRole("checkbox", { name, exact: true })
      .locator(".gallery-sidebar-count");
  const counts = async (
    amplifiers: string,
    ota: string,
    conversion: string,
  ) => {
    await expect(categoryCount("Amplifiers")).toHaveText(amplifiers);
    await expect(
      page
        .getByTestId("gallery-tag-option-ota")
        .locator(".gallery-sidebar-count"),
    ).toHaveText(ota);
    await expect(categoryCount("Conversion")).toHaveText(conversion);
  };
  const attention = page.getByTestId("gallery-filter-attention");
  const liked = page.getByTestId("gallery-filter-liked");
  await sidebar
    .getByRole("button", { name: "Expand Amplifiers", exact: true })
    .click();
  await counts("2", "2", "1");
  await attention.click();
  await counts("1", "1", "1");
  await liked.click();
  await counts("1", "1", "0");
  await attention.click();
  await counts("2", "2", "0");
  // Taking a like back under Liked removes that drawing from the counts too.
  await page.getByTestId("gallery-like-ota").click();
  await expect(page.getByTestId("gallery-tile-ota")).toHaveCount(0);
  await counts("1", "1", "0");
  await liked.click();
  await counts("2", "2", "1");
});

test("keeps the reader's filter when they leave the wall and come back", async ({
  page,
}) => {
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/gallery") return route.fallback();
    const alice = url.searchParams.get("author") === "alice";
    const entries = [
      {
        id: "p-alice",
        name: "Alice's OTA",
        author: "alice",
        description: "",
        createdAt: "2026-08-22T10:00:00.000Z",
        schemaVersion: 23,
      },
      ...(alice
        ? []
        : [
            {
              id: "p-bob",
              name: "Bob's Mixer",
              author: "bob",
              description: "",
              createdAt: "2026-08-22T09:00:00.000Z",
              schemaVersion: 23,
            },
          ]),
    ];
    return route.fulfill({ json: { entries, nextCursor: null } });
  });
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await page.getByTestId("gallery-author-p-alice").click();
  await expect(page.getByTestId("gallery-tile-p-bob")).toHaveCount(0);
  await expect(page).toHaveURL(/author=alice/u);

  // Opening a circuit and returning to the bare address is the common way
  // back; the wall must still be the slice the reader chose.
  await page.goto("/");
  await expect(page.getByTestId("gallery-filter")).toContainText(
    "Circuits by alice",
  );
  await expect(page.getByTestId("gallery-tile-p-bob")).toHaveCount(0);
  await expect(page).toHaveURL(/author=alice/u);

  // And clearing it is remembered just as well, so the wall cannot creep back
  // to a filter the reader switched off.
  await page.getByTestId("gallery-filter-clear").click();
  await expect(page.getByTestId("gallery-tile-p-bob")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-p-bob")).toBeVisible();
  await expect(page).not.toHaveURL(/author=/u);
});

test("administrators narrow Needs attention to one reason", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "admin-1",
          displayName: "Admin",
          email: "admin@example.com",
          provider: "github",
          isAdmin: true,
          role: "admin",
        },
      },
    }),
  );
  const pending = (id: string, kinds: [string, string][]) => ({
    ...ENTRY,
    id,
    ownerUserId: "someone",
    tags: ["amplifier"],
    curationRevision: 1,
    attention: {
      status: "needs-attention",
      issues: kinds.map(([kind, detail]) => ({ kind, detail })),
    },
    assessedPreviewRevision: ENTRY.previewRevision,
  });
  const entries = [
    pending("supply-only", [["global-vdd", ".global VDD in the netlist"]]),
    pending("broken-wire", [
      ["suspected-disconnection", "Gap between OUT and its wire."],
      ["global-vdd", ".global VDD in the netlist"],
    ]),
  ];
  const reasons: (string | null)[] = [];
  await page.route("**/api/gallery**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags")
      return route.fulfill({
        json: { tags: [{ tag: "amplifier", count: 2 }] },
      });
    if (url.pathname === "/api/gallery") {
      const reason = url.searchParams.get("reason");
      if (url.searchParams.get("attention") === "1") reasons.push(reason);
      const shown = entries.filter(
        (entry) =>
          !reason || entry.attention.issues.some((i) => i.kind === reason),
      );
      return route.fulfill({
        json: {
          entries: shown,
          nextCursor: null,
          total: shown.length,
          filterCounts: {
            attention: shown.length,
            netlistable: 0,
            liked: 0,
            ...(url.searchParams.get("attention") === "1"
              ? {
                  attentionKinds: {
                    "global-vdd": 2,
                    "suspected-disconnection": 1,
                  },
                }
              : {}),
          },
        },
      });
    }
    if (url.pathname.endsWith("/preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"/>',
      });
    return route.fallback();
  });
  await page.goto("/");
  const reason = page.getByTestId("gallery-filter-attention-reason");
  await expect(reason).toHaveCount(0);
  await page.getByTestId("gallery-filter-attention").click();
  // Each reason with something pending, with how many entries carry it.
  await expect(reason.locator("option")).toHaveText([
    "Every reason",
    "Global VDD (2)",
    "Wiring break (1)",
  ]);
  await reason.selectOption("suspected-disconnection");
  await expect(page).toHaveURL(/reason=suspected-disconnection/);
  await expect(page.getByTestId("gallery-tile-broken-wire")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-supply-only")).toHaveCount(0);
  expect(reasons.at(-1)).toBe("suspected-disconnection");
  // The review, opened from the tile's menu, lists every finding under its
  // reason.
  await page
    .getByTestId("gallery-owner-menu-broken-wire")
    .locator("summary")
    .click();
  await page.getByTestId("gallery-owner-review-broken-wire").click();
  const review = page.getByTestId("gallery-attention-broken-wire");
  await expect(review).toContainText("Wiring break · Gap between OUT");
  await expect(review).toContainText("Global VDD · .global VDD");
  await review.getByRole("button", { name: "Close" }).click();
  await expect(review).toHaveCount(0);
  // Leaving Needs attention forgets the reason.
  await page.getByTestId("gallery-filter-attention").click();
  await expect(reason).toHaveCount(0);
  await expect(page).not.toHaveURL(/reason=/);
});

test("sizes by part count narrow the wall, any of several at once", async ({
  page,
}) => {
  const entries = [
    { ...ENTRY, id: "small", name: "Small", componentCount: 3 },
    { ...ENTRY, id: "medium", name: "Medium", componentCount: 8 },
    { ...ENTRY, id: "large", name: "Large", componentCount: 30 },
  ];
  const sizeOf = (count: number) =>
    count <= 5
      ? "0-5"
      : count <= 10
        ? "6-10"
        : count <= 15
          ? "11-15"
          : count <= 25
            ? "16-25"
            : "26-";
  const requested: string[] = [];
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"/>',
      });
    if (url.pathname !== "/api/gallery") return route.fallback();
    const parts = (url.searchParams.get("parts") ?? "")
      .split(",")
      .filter(Boolean);
    requested.push(parts.join(","));
    const shown = entries.filter(
      (entry) =>
        parts.length === 0 || parts.includes(sizeOf(entry.componentCount)),
    );
    // Each size counts the wall without the size choice itself.
    const componentRanges: Record<string, number> = {
      "0-5": 0,
      "6-10": 0,
      "11-15": 0,
      "16-25": 0,
      "26-": 0,
    };
    for (const entry of entries)
      componentRanges[sizeOf(entry.componentCount)]! += 1;
    return route.fulfill({
      json: {
        entries: shown,
        nextCursor: null,
        total: shown.length,
        filterCounts: {
          attention: 0,
          netlistable: 0,
          liked: 0,
          componentRanges,
        },
      },
    });
  });
  await page.goto("/");
  const size = (key: string) => page.getByTestId(`gallery-filter-parts-${key}`);
  await expect(size("0-5")).toContainText("≤ 5");
  await expect(size("0-5").locator(".gallery-sidebar-count")).toHaveText("1");
  await expect(size("11-15").locator(".gallery-sidebar-count")).toHaveText("0");

  await size("6-10").click();
  await expect(page).toHaveURL(/parts=6-10/u);
  await expect(page.getByTestId("gallery-tile-medium")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-small")).toHaveCount(0);
  // A second size adds to the first.
  await size("26-").click();
  await expect(page.getByTestId("gallery-tile-large")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-medium")).toBeVisible();
  expect(requested.at(-1)).toBe("6-10,26-");
  await expect(size("6-10")).toHaveAttribute("aria-pressed", "true");
  await expect(size("0-5")).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("gallery-parts-clear").click();
  await expect(page.getByTestId("gallery-tile-small")).toBeVisible();
  await expect(page).not.toHaveURL(/parts=/u);
});
