// Accounts: what a signed-out visitor sees, the account page and header chip,
// and My submissions (/mine). Signing in, the account page's tabs and
// deleting an account are the account.test.tsx module contracts.

import { expect, test } from "./gallery-test.js";
import type { Locator, Page } from "@playwright/test";
import { awaitEditorReady, openEditor } from "./editor-fixtures.js";
import {
  ENTRY,
  fulfillPreview,
  galleryResistorProject,
  mockGallery,
  mockGalleryApi,
  mockPreviews,
  mockProviders,
  sessionUser,
  signIn,
} from "./gallery-fixtures.js";
import { serializeProject } from "@icm/project-protocol";

const ALL_PROVIDERS = { github: true, google: true, email: true };

/** Open the wall signed out, at the prompt to sign in. */
async function openSignedOut(page: Page): Promise<Locator> {
  await mockProviders(page, ALL_PROVIDERS);
  await signIn(page, null);
  await page.goto("/");
  const prompt = page.getByTestId("gallery-sign-in");
  await expect(prompt).toContainText("The Gallery is for signed-in members");
  return prompt;
}

test("signed out, the wall and the editor's Gallery panel are grey with a way to sign in, and no circuit", async ({
  page,
}) => {
  // The Gallery answers only signed-in readers: every read is refused.
  const reads: string[] = [];
  await page.route("**/api/gallery**", (route) => {
    reads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 401, json: { error: "sign-in-required" } });
  });
  const prompt = await openSignedOut(page);
  // Grey stand-ins keep the wall's shape; none of them is a circuit.
  await expect(prompt.locator(".gallery-sign-in-tile")).toHaveCount(12);
  await expect(prompt.locator(".gallery-sign-in-veil")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.locator('[data-testid^="gallery-tile-"]')).toHaveCount(0);
  await expect(page.locator(".masonry")).toHaveCount(0);
  await expect(page.getByTestId("gallery-tag-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("gallery-empty")).toHaveCount(0);
  await expect(page.getByTestId("gallery-unavailable")).toHaveCount(0);
  // The prompt says everything; no footnote promises browsing without it.
  await expect(page.getByTestId("gallery-footnote")).toHaveCount(0);
  // The invitation opens the header's sign-in choices.
  const unlock = page.getByTestId("gallery-unlock");
  await expect(unlock).toHaveText("Sign in");
  // Its gradient stays under the pointer; the app-wide button hover once
  // turned it grey under the white label.
  await unlock.hover();
  await expect
    .poll(() =>
      unlock.evaluate((element) => getComputedStyle(element).backgroundImage),
    )
    .toContain("linear-gradient");
  await expect(page.getByTestId("signin-github")).toBeHidden();
  await unlock.click();
  await expect(page.getByTestId("signin-github")).toBeVisible();
  await expect(page.getByTestId("signin-google")).toBeVisible();
  // The email address takes a whole row, its button the row below.
  const [address, send] = await Promise.all(
    ["signin-email-input", "signin-email-send"].map((id) =>
      page.getByTestId(id).boundingBox(),
    ),
  );
  expect(Math.round(address!.width)).toBe(Math.round(send!.width));
  expect(send!.y).toBeGreaterThan(address!.y + address!.height - 1);

  await openEditor(page);
  await page.getByTestId("examples-toggle").click();
  const panel = page.getByTestId("examples-panel");
  const locked = panel.getByTestId("examples-panel-sign-in");
  await expect(locked).toContainText(
    "Sign in to insert circuits from the Gallery.",
  );
  await expect(locked.locator(".examples-panel-sign-in-tile")).toHaveCount(12);
  const veil = locked.locator(".examples-panel-sign-in-veil");
  await expect(veil).toHaveCSS("pointer-events", "none");
  await expect(veil).toHaveCSS("filter", "blur(10px)");
  const panelBox = (await locked.boundingBox())!;
  const cardBox = (await locked
    .locator(".examples-panel-sign-in-card")
    .boundingBox())!;
  expect(
    Math.abs(
      cardBox.y + cardBox.height / 2 - (panelBox.y + panelBox.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
  await expect(panel.locator('[data-testid^="gallery-example-"]')).toHaveCount(
    0,
  );
  await expect(panel.getByTestId("examples-panel-search")).toHaveCount(0);
  await expect(page.getByTestId("signin-github")).toBeHidden();
  await locked.getByTestId("examples-panel-sign-in-button").click();
  await expect(page.getByTestId("signin-github")).toBeVisible();
  // Asked for the list and refused; no preview or entry was read.
  // The unfiltered wall, in whatever order it opens with (#1615).
  expect(reads.some((path) => path === "/api/gallery")).toBe(true);
  expect(reads.filter((path) => path.endsWith("/preview.svg"))).toEqual([]);
});

test("a signed-out visitor sees the wall's first twelve circuits, dimmed and closed", async ({
  page,
}) => {
  // Signed out, the server answers only the unfiltered first page, cut to
  // twelve, and those twelve previews; every other read asks to sign in.
  // Exactly what the Worker sends signed out: id, name and preview only. A
  // fuller mock once hid a crash on the fields the server leaves out.
  const entries = Array.from({ length: 12 }, (_, n) => ({
    id: `g${n + 1}`,
    name: `Circuit ${n + 1}`,
    previewRevision: `r${n + 1}`,
  }));
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  const reads: string[] = [];
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    reads.push(url.pathname + url.search);
    // The unfiltered first page, in whatever order it opens with (#1615).
    if (
      url.pathname === "/api/gallery" &&
      [...url.searchParams.keys()].every((key) =>
        ["order", "seed"].includes(key),
      )
    )
      return route.fulfill({
        json: { entries, nextCursor: null, signedOut: true },
      });
    if (url.pathname.endsWith("/preview.svg")) return fulfillPreview(route);
    return route.fulfill({
      status: 401,
      json: { error: "sign-in-required" },
    });
  });
  const prompt = await openSignedOut(page);
  const circuits = prompt.getByTestId("gallery-sign-in-circuit");
  await expect(circuits).toHaveCount(12);
  await expect(circuits.first()).toContainText("Circuit 1");
  const preview = circuits.first().locator("img");
  await expect(preview).toHaveAttribute(
    "src",
    /^\/api\/gallery\/g1\/preview\.svg\?v=r1/u,
  );
  await expect
    .poll(() =>
      preview.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  // A little grey, and closed: no link, no real tile, no grey stand-in.
  expect(
    await circuits
      .first()
      .evaluate((tile) => Number(getComputedStyle(tile).opacity)),
  ).toBeLessThan(1);
  await expect(prompt.locator("a")).toHaveCount(0);
  await expect(page.locator('[data-testid^="gallery-tile-"]')).toHaveCount(0);
  await expect(page.getByTestId("gallery-tag-sidebar")).toHaveCount(0);
  // Nor an order to choose (#1615): signed out, it would change nothing.
  await expect(page.getByTestId("gallery-order-menu")).toHaveCount(0);
  await circuits.nth(3).click({ force: true });
  await expect(page).toHaveURL(/\/$/u);
  // No circuit was opened, and no other page was asked for.
  expect(reads.filter((path) => /^\/api\/gallery\/g\d+$/u.test(path))).toEqual(
    [],
  );
  expect(reads.filter((path) => path.includes("cursor="))).toEqual([]);
  // The page never broke on the fields the server leaves out.
  await expect(page.locator(".editor-crash-screen")).toHaveCount(0);
  expect(crashes).toEqual([]);
});

test("the account chip sits on the header line, ellipsizes a long name, and the credit never runs under it", async ({
  page,
}) => {
  await mockProviders(page, { github: true, google: false, email: false });
  let user = sessionUser({ displayName: "Zhishuai Zhang" });
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user } }),
  );
  await mockGalleryApi(page, { tags: [] }, (_url, route) =>
    route.fulfill({ json: { entries: [], nextCursor: null } }),
  );

  await page.setViewportSize({ width: 760, height: 720 });
  await page.goto("/");
  const chip = page.getByTestId("account-name");
  await expect(chip).toBeVisible();

  // The name rides the same centre line as every other control in the row.
  // Zeroed vertical padding is what puts it there: the chip opts out of the
  // row's shared control rule so its ellipsis works, and that rule was also
  // what kept its line box the full height of the control.
  const centred = await chip.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    return text.top + text.height / 2 - (box.top + box.height / 2);
  });
  expect(Math.abs(centred)).toBeLessThanOrEqual(1);

  const reportBug = page.getByTestId("gallery-report-bug");
  const chipBox = (await chip.boundingBox())!;
  const buttonBox = (await reportBug.boundingBox())!;
  expect(
    Math.abs(
      chipBox.y + chipBox.height / 2 - (buttonBox.y + buttonBox.height / 2),
    ),
  ).toBeLessThanOrEqual(1);

  // An ordinary two-part name fits whole at this width.
  expect(
    await chip.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);

  // A name that cannot fit ends in an ellipsis rather than a sliced letter,
  // which only holds while the chip is not a flex container.
  const overflowing = await chip.evaluate((element) => {
    element.textContent = "A Considerably Longer Display Name";
    const style = getComputedStyle(element);
    return {
      clipped: element.scrollWidth > element.clientWidth,
      textOverflow: style.textOverflow,
      display: style.display,
    };
  });
  expect(overflowing.clipped).toBe(true);
  expect(overflowing.textOverflow).toBe("ellipsis");
  expect(overflowing.display).not.toContain("flex");

  // The Owner's header holds a badge too.
  user = { ...user, isAdmin: true };
  await page.reload();

  await expect(page.getByTestId("account-name")).toBeVisible();
  // Visitor counts load only on the production host; give the header the
  // link it renders there.
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.className = "analytics-link gallery-analytics-link";
    link.textContent = "12,873 visitors · 14,256 views";
    document.querySelector(".gallery-credit-group")!.append(link);
  });

  // From half screen to full width, with the owner's name, badge and menu on
  // the right, the middle shows each item whole or not at all, and never
  // under another control.
  for (const width of [880, 930, 1000, 1100, 1180, 1250, 1300, 1400]) {
    await page.setViewportSize({ width, height: 720 });
    const layout = await page.evaluate(() => {
      const group = document
        .querySelector(".gallery-credit-group")!
        .getBoundingClientRect();
      const sides = [
        ...document.querySelectorAll(
          ".gallery-chrome .app-brand, .gallery-actions > *, .account-menu > *",
        ),
      ].map((element) => element.getBoundingClientRect());
      const overlaps: string[] = [];
      const partly: string[] = [];
      for (const element of document.querySelectorAll(
        ".gallery-credit-group .tokenzhang-link, .gallery-credit-group .gallery-analytics-link",
      )) {
        const box = element.getBoundingClientRect();
        const left = Math.max(box.left, group.left);
        const right = Math.min(box.right, group.right);
        const top = Math.max(box.top, group.top);
        const bottom = Math.min(box.bottom, group.bottom);
        if (right - left <= 0 || bottom - top <= 0) continue;
        if (right - left < box.width - 0.5 || bottom - top < box.height - 0.5)
          partly.push(element.className);
        if (
          sides.some(
            (side) =>
              side.width > 0 &&
              left < side.right - 0.5 &&
              side.left < right - 0.5 &&
              top < side.bottom &&
              side.top < bottom,
          )
        )
          overlaps.push(element.className);
      }
      return { overlaps, partly };
    });
    expect(layout, `at ${width}px`).toEqual({ overlaps: [], partly: [] });
  }
});

test("the Owner switches to an AI account, renames, is asked the name before deleting, and signs out", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/gallery/mine", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  await mockProviders(page, ALL_PROVIDERS);
  await page.route("**/api/auth/ai-accounts", (route) =>
    route.fulfill({
      json: {
        accounts: [
          { id: "ai-1", seat: "ai-designer-1", displayName: "Claude Opus 5.5" },
          { id: "ai-2", seat: "ai-designer-2", displayName: "GPT-6 Astra" },
        ],
      },
    }),
  );
  const switches: unknown[] = [];
  await page.route("**/api/auth/ai-accounts/switch", (route) => {
    switches.push(route.request().postDataJSON());
    return route.fulfill({ json: { switched: true } });
  });
  let user: Record<string, unknown> | null = sessionUser({
    displayName: "tz",
    isAdmin: true,
  });
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user } }),
  );
  const renames: string[] = [];
  await page.route("**/api/auth/profile", (route) => {
    const displayName = String(route.request().postDataJSON().displayName);
    renames.push(displayName);
    user = { ...user!, displayName };
    return route.fulfill({ json: { user } });
  });
  let loggedOut = 0;
  await page.route("**/api/auth/logout", (route) => {
    loggedOut += 1;
    user = null;
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto("/");
  const name = page.getByTestId("account-name");
  await expect(name).toHaveText("tz");
  await name.click();
  await expect(page).toHaveURL(/\/account$/u);
  // The Owner's AI accounts, each a click away from this browser.
  await page.getByTestId("account-tab-ai").click();
  await expect(page.getByTestId("ai-account-ai-designer-2")).toContainText(
    "GPT-6 Astra",
  );
  await page.getByTestId("ai-account-switch-ai-designer-1").click();
  await expect(page).toHaveURL(/\/account$/u);
  expect(switches).toEqual([{ userId: "ai-1" }]);
  await page.getByTestId("account-tab-settings").click();
  await page.getByTestId("account-rename").click();
  await page.getByTestId("account-rename-input").fill("Token Zhang");
  await page.getByTestId("account-rename-input").press("Enter");
  await expect(page.getByTestId("account-menu-name")).toHaveText("Token Zhang");
  // The header reads the new name too.
  await expect(name).toHaveText("Token Zhang");
  expect(renames).toEqual(["Token Zhang"]);

  // Deleting asks for the name before it can go ahead; Cancel leaves it.
  await page.getByTestId("account-delete").click();
  const confirm = page.getByTestId("account-delete-confirm");
  await expect(confirm).toBeDisabled();
  await page.getByTestId("account-delete-typed").fill("Token");
  await expect(confirm).toBeDisabled();
  await page.getByTestId("account-delete-typed").fill("Token Zhang");
  await expect(confirm).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("account-delete-dialog")).toHaveCount(0);

  await page.getByTestId("account-signout").click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByTestId("account-signin")).toBeVisible();
  expect(loggedOut).toBe(1);
});

test("a member withdraws their own entry from its tile, then restores or deletes it in My submissions", async ({
  page,
}) => {
  await signIn(page, sessionUser({ id: "member-1", displayName: "Member" }));
  const mine = { ...ENTRY, ownerUserId: "member-1" };
  const theirs = {
    ...ENTRY,
    id: "g-other",
    name: "Someone else's",
    ownerUserId: "member-2",
  };
  await mockGallery(page, [mine, theirs]);
  await mockPreviews(page);
  let status: "public" | "recycled" | null = "public";
  const calls: string[] = [];
  await page.route("**/api/gallery/mine", (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            id: "mine-1",
            name: "Rejected Filter",
            createdAt: "2026-08-22T09:00:00.000Z",
            status: "rejected",
            rejectReason: "Label the ports",
          },
          ...(status
            ? [
                {
                  id: mine.id,
                  name: mine.name,
                  createdAt: mine.createdAt,
                  status,
                  rejectReason: null,
                },
              ]
            : []),
        ],
      },
    }),
  );
  for (const [action, next] of [
    ["recycle", "recycled"],
    ["restore", "public"],
  ] as const)
    await page.route(`**/api/gallery/${mine.id}/${action}`, (route) => {
      calls.push(action);
      status = next;
      return route.fulfill({ json: { id: mine.id, status: next } });
    });
  await page.route(`**/api/gallery/${mine.id}`, (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    calls.push("DELETE");
    status = null;
    return route.fulfill({ json: { id: mine.id, deleted: true } });
  });
  await page.route(`**/api/gallery/${mine.id}/versions`, (route) =>
    route.fulfill({
      json: {
        versions: [
          {
            versionId: "v-1",
            versionNo: 1,
            name: "Live Amp v1",
            author: "Member",
            tags: [],
            createdAt: "2026-08-21T08:00:00.000Z",
          },
        ],
      },
    }),
  );

  await page.goto("/");
  // Only their own tile carries the author's menu, and no Owner's actions.
  await expect(page.getByTestId(`gallery-tile-${theirs.id}`)).toBeVisible();
  await expect(
    page.getByTestId(`gallery-author-menu-${theirs.id}`),
  ).toHaveCount(0);
  await expect(page.getByTestId(`gallery-owner-reject-${mine.id}`)).toHaveCount(
    0,
  );
  await page
    .getByTestId(`gallery-author-menu-${mine.id}`)
    .getByLabel(`Manage ${mine.name}`)
    .click();
  // Withdrawing is undone from My submissions, so it asks nothing more.
  await page.getByTestId(`gallery-author-withdraw-${mine.id}`).click();
  await expect(page.getByTestId(`gallery-tile-${mine.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`gallery-tile-${theirs.id}`)).toBeVisible();
  await expect(page.getByTestId("gallery-owner-notice")).toContainText(
    "Restore it from My submissions",
  );

  await page.goto("/mine");
  // The standard chrome is present, not a bare paragraph.
  await expect(page.getByTestId("gallery-editor-link")).toBeVisible();
  await expect(page.getByTestId("gallery-editor-switch")).toBeVisible();
  // A rejected circuit says why, and only the Owner can bring it back.
  await expect(page.getByTestId("mine-reason-mine-1")).toContainText(
    "Label the ports",
  );
  await expect(page.getByTestId("mine-withdraw-mine-1")).toHaveCount(0);
  await expect(page.getByTestId("mine-card-mine-1")).toContainText(
    "remains hidden until the Owner restores it",
  );
  // Restore republishes a voluntary withdrawal.
  const card = page.getByTestId(`mine-card-${mine.id}`);
  const shown = page.getByTestId(`mine-status-${mine.id}`);
  await expect(shown).toHaveText("Withdrawn");
  await page.getByTestId(`mine-restore-${mine.id}`).click();
  await expect(shown).toHaveText("Published");
  // The drawing itself opens the circuit; there is no separate link.
  await expect(card.locator(".entry-card-open")).toHaveAttribute(
    "href",
    `/g/${mine.id}`,
  );
  await expect(card).not.toContainText("Open in editor");
  await page.getByTestId(`mine-history-${mine.id}`).click();
  await expect(page.getByTestId("version-1")).toContainText("Live Amp v1");
  // The dialog keeps its overlay styling on the Gallery's own route.
  await expect(page.locator(".version-history-backdrop")).toHaveCSS(
    "position",
    "fixed",
  );
  await expect(page.getByTestId("version-history-dialog")).toHaveCSS(
    "display",
    "flex",
  );
  await expect(page.getByTestId("version-1")).toHaveCSS("display", "grid");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("version-history-dialog")).toHaveCount(0);

  // A published circuit is withdrawn first; only then can it be deleted,
  // and that click is the decision.
  await expect(page.getByTestId(`mine-delete-${mine.id}`)).toHaveCount(0);
  await page.getByTestId(`mine-withdraw-${mine.id}`).click();
  await expect(page.getByTestId("mine-notice")).toContainText("Withdrew");
  await page.getByTestId(`mine-delete-${mine.id}`).click();
  await expect(page.getByTestId("mine-notice")).toContainText("Deleted");
  await expect(page.getByTestId(`mine-delete-${mine.id}`)).toHaveCount(0);
  expect(calls).toEqual(["recycle", "restore", "recycle", "DELETE"]);
});

test("a window back from its account and Privacy at plain /editor keeps its tabs, and a Cloud Project deleted there turns unsaved (#1599)", async ({
  page,
  context,
}) => {
  const project = { ...galleryResistorProject("7k"), name: "Cloud circuit" };
  const summary = {
    id: "account-cloud",
    name: project.name,
    revision: 1,
    schemaVersion: project.schemaVersion,
    updatedAt: "2026-10-10T00:00:00Z",
  };
  let deleted = false;
  let reads = 0;
  await mockProviders(context, { github: true, google: false, email: false });
  await signIn(
    context,
    sessionUser({ id: "account-owner", displayName: "Owner", email: null }),
  );
  await context.route("**/api/projects", (route) => {
    reads++;
    return route.fulfill({ json: { projects: deleted ? [] : [summary] } });
  });
  await context.route("**/api/projects/account-cloud", (route) => {
    if (route.request().method() === "DELETE") {
      deleted = true;
      return route.fulfill({ json: { projects: [] } });
    }
    return route.fulfill({
      json: { project: { ...summary, projectText: serializeProject(project) } },
    });
  });
  await context.route("**/api/gallery/mine**", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  // The account page's Cloud Projects tile opens the editor at ?project=.
  await openEditor(page, "/editor?project=account-cloud");
  const cloudTab = page.getByRole("tab", { name: /Cloud circuit$/ });
  await expect(cloudTab).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("tab-project-file").setInputFiles({
    name: "draft.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      serializeProject({
        ...galleryResistorProject("13k"),
        id: "local-draft",
        name: "Local draft",
      }),
    ),
  });
  const draftTab = page.getByRole("tab", { name: /Local draft/ });
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
  await draftTab.dblclick();
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("Local draft edited");
  await name.press("Enter");
  await expect(draftTab.getByLabel("Unsaved")).toBeVisible();
  const names = await page
    .getByTestId("project-tabs")
    .getByRole("tab")
    .allTextContents();
  page.on("dialog", (dialog) => void dialog.accept());

  // Out through the account and Privacy, back by Privacy's plain /editor,
  // in this same window.
  await page.getByTestId("account-name").click();
  await expect(page.getByTestId("account-page")).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  await page.getByTestId("gallery-privacy-link").click();
  // The account page has the same switch: leave only once Privacy is open.
  await expect(page).toHaveURL(/\/privacy$/u);
  await page.getByTestId("gallery-editor-switch").click();
  await awaitEditorReady(page);
  await expect(page).toHaveURL(/\/editor$/);
  await expect(page.getByTestId("project-tabs").getByRole("tab")).toHaveText(
    names,
  );
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
  await expect(draftTab.getByLabel("Unsaved")).toBeVisible();
  await expect(page.getByTestId("hit-R2")).toBeVisible();
  await expect(cloudTab.getByLabel("Unsaved")).toHaveCount(0);

  // The account's projects survive a visit to Settings without a new read.
  await page.getByTestId("account-name").click();
  await page.getByTestId("account-tab-projects").click();
  const tile = page.getByTestId("shelf-tile-account-cloud");
  await expect(tile).toBeVisible();
  const readsBefore = reads;
  await page.getByTestId("account-tab-settings").click();
  await expect(page.getByTestId("account-panel-settings")).toBeVisible();
  await page.getByTestId("account-tab-projects").click();
  await expect(tile).toBeVisible();
  expect(reads).toBe(readsBefore);
  // Deleting the Cloud Project on the account page leaves its tab unsaved.
  await page.getByTestId("shelf-delete-account-cloud").click();
  await page
    .getByRole("button", { name: "Really delete", exact: true })
    .click();
  await expect(tile).toHaveCount(0);
  await page.getByTestId("gallery-editor-switch").click();
  await awaitEditorReady(page);
  await expect(page).toHaveURL(/\/editor\?resume=1$/);
  await expect(cloudTab.getByLabel("Unsaved")).toBeVisible();
});
