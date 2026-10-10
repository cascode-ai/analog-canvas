// Accounts: what a signed-out visitor sees, signing in, the account page and
// header chip, and My submissions (/mine).

import { expect, test } from "@playwright/test";
import { CURRENT_MODEL_SCHEMA_VERSION } from "@icm/model";
import { awaitEditorReady } from "./editor-fixtures.js";
import {
  ENTRY,
  galleryListUrl,
  galleryResistorProject,
  mockGallery,
} from "./gallery-fixtures.js";
import { serializeProject } from "@icm/project-protocol";

test("account round trips keep this window's cloud tabs and active unsaved circuit", async ({
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
  await context.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: false, email: false } }),
  );
  await context.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "account-owner",
          displayName: "Owner",
          provider: "github",
          email: null,
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  await context.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [summary] } }),
  );
  await context.route("**/api/projects/account-cloud", (route) =>
    route.fulfill({
      json: { project: { ...summary, projectText: serializeProject(project) } },
    }),
  );
  await context.route("**/api/gallery/mine**", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  await page.goto("/editor?project=account-cloud");
  await awaitEditorReady(page);
  await expect(
    page.getByRole("tab", { name: "Cloud circuit", exact: true }),
  ).toBeVisible();
  const draft = {
    ...galleryResistorProject("13k"),
    id: "local-draft",
    name: "Local draft",
  };
  await page.getByTestId("tab-project-file").setInputFiles({
    name: "draft.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(draft)),
  });
  const draftTab = page.getByRole("tab", { name: /Local draft/ });
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
  await draftTab.dblclick();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Local draft edited");
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .press("Enter");
  await expect(draftTab.getByLabel("Unsaved")).toBeVisible();
  const names = await page
    .getByTestId("project-tabs")
    .getByRole("tab")
    .allTextContents();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("account-name").click();
  await expect(page.getByTestId("account-page")).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  await page.getByTestId("gallery-editor-switch").click();
  await awaitEditorReady(page);
  await expect(page.getByTestId("project-tabs").getByRole("tab")).toHaveText(
    names,
  );
  await expect(page.getByRole("tab", { name: /Local draft/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("hit-R2")).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Local draft/ }).getByLabel("Unsaved"),
  ).toBeVisible();
});

test("account tabs retain loaded projects when returning from Settings", async ({
  page,
}) => {
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: false, email: false } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "retained-owner",
          displayName: "Owner",
          provider: "github",
          isAdmin: false,
        },
      },
    }),
  );
  let reads = 0;
  await page.route("**/api/projects", (route) => {
    reads++;
    return route.fulfill({
      json: {
        projects: [
          {
            id: "retained",
            name: "Retained circuit",
            revision: 1,
            schemaVersion: 1,
            updatedAt: "2026-10-10T00:00:00Z",
          },
        ],
      },
    });
  });
  await page.goto("/account?tab=projects");
  await expect(page.getByTestId("shelf-tile-retained")).toBeVisible();
  await page.getByTestId("account-tab-settings").click();
  await expect(page.getByTestId("account-panel-settings")).toBeVisible();
  await page.getByTestId("account-tab-projects").click();
  await expect(page.getByTestId("shelf-tile-retained")).toBeVisible();
  expect(reads).toBe(1);
});

test("a signed-out visitor sees a grey wall with a way to sign in, and no circuit", async ({
  page,
}) => {
  // The Gallery answers only signed-in readers: every read is refused.
  const reads: string[] = [];
  await page.route("**/api/gallery**", (route) => {
    reads.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: 401,
      json: { error: "sign-in-required" },
    });
  });
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: true, email: true } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user: null } }),
  );
  await page.goto("/");
  const prompt = page.getByTestId("gallery-sign-in");
  await expect(prompt).toContainText("The Gallery is for signed-in members");
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
  // Asked once for the list and refused; no preview or entry was read.
  // The unfiltered wall, in whatever order it opens with (#1615).
  expect(reads.some((path) => path.split("?")[0] === "/api/gallery")).toBe(
    true,
  );
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
    if (url.pathname.endsWith("/preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30"><rect width="40" height="30" fill="#888"/></svg>',
      });
    return route.fulfill({
      status: 401,
      json: { error: "sign-in-required" },
    });
  });
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: true, email: true } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user: null } }),
  );
  await page.goto("/");
  const prompt = page.getByTestId("gallery-sign-in");
  await expect(prompt).toContainText("The Gallery is for signed-in members");
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

test("signed out, the editor's Gallery panel is grey with a way to sign in", async ({
  page,
}) => {
  const reads: string[] = [];
  await page.route("**/api/gallery**", (route) => {
    reads.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: 401,
      json: { error: "sign-in-required" },
    });
  });
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: true, email: true } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user: null } }),
  );
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("examples-toggle").click();
  const panel = page.getByTestId("examples-panel");
  const locked = panel.getByTestId("examples-panel-sign-in");
  await expect(locked).toContainText(
    "Sign in to insert circuits from the Gallery.",
  );
  await expect(locked.locator(".examples-panel-sign-in-tile")).toHaveCount(12);
  await expect(locked.locator(".examples-panel-sign-in-veil")).toHaveCSS(
    "pointer-events",
    "none",
  );
  await expect(locked.locator(".examples-panel-sign-in-veil")).toHaveCSS(
    "filter",
    "blur(10px)",
  );
  const panelBox = await locked.boundingBox();
  const cardBox = await locked
    .locator(".examples-panel-sign-in-card")
    .boundingBox();
  expect(panelBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(
    Math.abs(
      (cardBox?.y ?? 0) +
        (cardBox?.height ?? 0) / 2 -
        ((panelBox?.y ?? 0) + (panelBox?.height ?? 0) / 2),
    ),
  ).toBeLessThanOrEqual(1);
  await expect(panel.locator('[data-testid^="gallery-example-"]')).toHaveCount(
    0,
  );
  await expect(panel.getByTestId("examples-panel-search")).toHaveCount(0);
  await expect(page.getByTestId("signin-github")).toBeHidden();
  await locked.getByTestId("examples-panel-sign-in-button").click();
  await expect(page.getByTestId("signin-github")).toBeVisible();
  // The unfiltered wall, in whatever order it opens with (#1615).
  expect(reads.some((path) => path.split("?")[0] === "/api/gallery")).toBe(
    true,
  );
  expect(reads.filter((path) => path.endsWith("/preview.svg"))).toEqual([]);
});

test("the account chip sits on the header line and ellipsizes a long name", async ({
  page,
}) => {
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: false, email: false } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Zhishuai Zhang",
          email: "z@example.com",
          provider: "github",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags") {
      return route.fulfill({ json: { tags: [] } });
    }
    if (url.pathname !== "/api/gallery") return route.fallback();
    return route.fulfill({ json: { entries: [], nextCursor: null } });
  });

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
});

test("the header's credit and visitor count never run under the account actions", async ({
  page,
}) => {
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: false, email: false } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "owner-1",
          displayName: "Zhishuai Zhang",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags")
      return route.fulfill({ json: { tags: [] } });
    if (url.pathname !== "/api/gallery") return route.fallback();
    return route.fulfill({ json: { entries: [], nextCursor: null } });
  });
  await page.goto("/");
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

test("the feed offers exactly the enabled sign-in providers and signs in with an emailed code", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: false, email: true } }),
  );
  let signedIn = false;
  const user = {
    id: "u-mail",
    displayName: "vivian",
    email: "vivian@example.com",
    provider: "email",
    role: "user",
    isAdmin: false,
  };
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user: signedIn ? user : null } }),
  );
  const emailStarts: string[] = [];
  await page.route("**/api/auth/email/start", (route) => {
    emailStarts.push(String(route.request().postDataJSON().email));
    return route.fulfill({ status: 202, json: { sent: true } });
  });
  const verifications: { email: string; code: string }[] = [];
  await page.route("**/api/auth/email/verify", (route) => {
    const body = route.request().postDataJSON() as {
      email: string;
      code: string;
    };
    verifications.push(body);
    if (body.code.replace(/\s/gu, "") !== "314159")
      return route.fulfill({
        status: 400,
        json: { error: "invalid-code", attemptsLeft: 4 },
      });
    signedIn = true;
    return route.fulfill({ json: { signedIn: true } });
  });

  await page.goto("/");
  await page.getByTestId("account-signin").locator("summary").click();
  await expect(page.getByTestId("signin-github")).toHaveAttribute(
    "href",
    "/api/auth/github/start",
  );
  // Each provider shows its mark before its name.
  await expect(
    page.getByTestId("signin-github").locator(".account-provider-logo"),
  ).toBeVisible();
  await expect(page.getByTestId("signin-google")).toHaveCount(0);
  // The address takes a whole row, its button the row below.
  const input = page.getByTestId("signin-email-input");
  const send = page.getByTestId("signin-email-send");
  await expect(send).toHaveText("Email me a code");
  const [inputBox, sendBox] = await Promise.all([
    input.boundingBox(),
    send.boundingBox(),
  ]);
  expect(Math.round(inputBox!.width)).toBe(Math.round(sendBox!.width));
  expect(sendBox!.y).toBeGreaterThan(inputBox!.y + inputBox!.height - 1);

  await input.fill("vivian@example.com");
  await send.click();
  expect(emailStarts).toEqual(["vivian@example.com"]);
  // The code is typed here, whichever browser read the email.
  await expect(page.getByTestId("signin-code-hint")).toContainText(
    "vivian@example.com",
  );
  const code = page.getByTestId("signin-code-input");
  await code.fill("271828");
  await page.getByTestId("signin-code-verify").click();
  await expect(page.getByTestId("account-notice")).toHaveText(
    "That code is not right — 4 tries left.",
  );
  await code.fill("314 159");
  await page.getByTestId("signin-code-verify").click();
  // Signed in, the page starts over with the session.
  await expect(page.getByTestId("account-name")).toHaveText("vivian");
  expect(verifications).toEqual([
    { email: "vivian@example.com", code: "271828" },
    { email: "vivian@example.com", code: "314 159" },
  ]);
});

test("a signed-in owner opens the account page, renames and signs out", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/gallery/mine", (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            id: ENTRY.id,
            name: ENTRY.name,
            createdAt: ENTRY.createdAt,
            previewRevision: ENTRY.previewRevision,
            status: "public",
            rejectReason: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/gallery/rejected", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  await page.route("**/api/gallery/recycled", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      json: {
        projects: [
          {
            id: "cloud-1",
            name: "Folded cascode",
            updatedAt: "2026-10-07T08:00:00.000Z",
            revision: 2,
            schemaVersion: CURRENT_MODEL_SCHEMA_VERSION,
          },
        ],
      },
    }),
  );
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: true, email: true } }),
  );
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
  let user: Record<string, unknown> | null = {
    id: "u1",
    displayName: "tz",
    email: "owner@example.com",
    provider: "github",
    isAdmin: true,
  };
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
  await expect(name).toHaveAttribute("href", "/account");
  // The header holds the name and nothing else of the account.
  await expect(page.getByTestId("account-delete")).toHaveCount(0);
  await name.click();
  await expect(page).toHaveURL(/\/account$/u);
  await expect(page.getByTestId("account-menu-name")).toHaveText("tz");
  await expect(page.getByTestId("account-owner")).toHaveText("Owner");
  // One click in, the account's circuits are already laid out.
  await expect(page.getByTestId("account-tab-circuits")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId(`mine-card-${ENTRY.id}`)).toBeVisible();
  // The private Cloud Projects are the next tab, opened from their tiles.
  await page.getByTestId("account-tab-projects").click();
  await expect(page).toHaveURL(/\/account\?tab=projects$/u);
  await expect(page.getByTestId("shelf-tile-cloud-1")).toContainText(
    "Folded cascode",
  );
  // Moderation follows, a tab, not a page behind a link.
  await page.getByTestId("account-tab-moderation").click();
  await expect(page.getByTestId("rejected-empty")).toBeVisible();
  await expect(page.getByTestId("bin-empty")).toBeVisible();
  // The Owner's AI accounts, each a click away from this browser.
  await page.getByTestId("account-tab-ai").click();
  await expect(page.getByTestId("ai-account-ai-designer-2")).toContainText(
    "GPT-6 Astra",
  );
  await page.getByTestId("ai-account-switch-ai-designer-1").click();
  await expect(page).toHaveURL(/\/account$/u);
  expect(switches).toEqual([{ userId: "ai-1" }]);
  await page.getByTestId("account-tab-settings").click();
  await expect(page).toHaveURL(/\/account\?tab=settings$/u);
  // The address names the tab, so a reload comes back to it.
  await page.reload();
  await expect(page.getByTestId("account-panel-settings")).toBeVisible();
  await page.getByTestId("account-rename").click();
  await page.getByTestId("account-rename-input").fill("Token Zhang");
  await page.getByTestId("account-rename-input").press("Enter");
  await expect(page.getByTestId("account-menu-name")).toHaveText("Token Zhang");
  // The header reads the new name too.
  await expect(page.getByTestId("account-name")).toHaveText("Token Zhang");
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

test("a signed-out visitor is asked to sign in, not for a passphrase", async ({
  page,
}) => {
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries: [], nextCursor: null } }),
  );

  await page.goto("/editor");
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();

  await expect(dialog.getByTestId("publish-signin")).toBeVisible();
  await expect(dialog.getByTestId("publish-signin-github")).toHaveAttribute(
    "href",
    "/api/auth/github/start",
  );
  // The passphrase is gone: no field, and nothing to submit without a session.
  await expect(dialog.getByLabel("Owner passphrase")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Publish" })).toHaveCount(0);
});

test("an author deletes their own entry from My submissions", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u7",
          displayName: "Maker",
          email: "maker@example.com",
          provider: "email",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  let live: "public" | "withdrawn" | false = "public";
  await page.route("**/api/gallery/mine", (route) =>
    route.fulfill({
      json: {
        entries: live
          ? [
              {
                id: "mine-9",
                name: "Draft I regret",
                createdAt: "2026-08-29T09:00:00.000Z",
                status: live === "public" ? "public" : "recycled",
                rejectReason: null,
              },
            ]
          : [],
      },
    }),
  );
  const methods: string[] = [];
  await page.route("**/api/gallery/mine-9", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    methods.push("DELETE");
    live = false;
    return route.fulfill({ json: { id: "mine-9", deleted: true } });
  });

  await page.route("**/api/gallery/mine-9/recycle", (route) => {
    live = "withdrawn";
    return route.fulfill({ json: { id: "mine-9", status: "recycled" } });
  });

  await page.goto("/mine");
  // A published circuit is withdrawn first; only then can it be deleted.
  await expect(page.getByTestId("mine-delete-mine-9")).toHaveCount(0);
  await page.getByTestId("mine-withdraw-mine-9").click();
  await expect(page.getByTestId("mine-restore-mine-9")).toBeVisible();

  // The click is the decision: it deletes at once, asking nothing more.
  await page.getByTestId("mine-delete-mine-9").click();
  await expect(page.getByTestId("mine-notice")).toContainText("Deleted");
  await expect(page.getByTestId("mine-delete-mine-9")).toHaveCount(0);
  expect(methods).toEqual(["DELETE"]);
});

test("/mine wears the site chrome and links every entry back to the editor", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u7",
          displayName: "Maker",
          email: "maker@example.com",
          provider: "email",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
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
          {
            id: "mine-2",
            name: "Live Amp",
            createdAt: "2026-08-22T08:00:00.000Z",
            status: "public",
            rejectReason: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/mine");
  // The standard chrome is present, not a bare paragraph.
  await expect(page.getByTestId("gallery-editor-link")).toBeVisible();
  await expect(page.getByTestId("gallery-editor-switch")).toBeVisible();
  await expect(page.getByTestId("mine-reason-mine-1")).toContainText(
    "Label the ports",
  );
  await expect(page.getByTestId("mine-withdraw-mine-1")).toHaveCount(0);
  await expect(page.getByTestId("mine-card-mine-1")).toContainText(
    "remains hidden until the Owner restores it",
  );
  // The drawing itself opens the circuit; there is no separate link.
  await expect(
    page.getByTestId("mine-card-mine-2").locator(".entry-card-open"),
  ).toHaveAttribute("href", "/g/mine-2");
  await expect(page.getByTestId("mine-card-mine-2")).not.toContainText(
    "Open in editor",
  );
  await expect(page.getByTestId("mine-status-mine-2")).toHaveText("Published");
});

test("/mine offers owner withdrawal, restore, and version history", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u7",
          displayName: "Maker",
          email: "maker@example.com",
          provider: "email",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  let withdrawn = false;
  await page.route("**/api/gallery/mine", (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            id: "mine-2",
            name: "Live Amp",
            createdAt: "2026-08-22T08:00:00.000Z",
            status: withdrawn ? "recycled" : "public",
            rejectReason: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/gallery/mine-2/recycle", (route) => {
    withdrawn = true;
    return route.fulfill({ json: { id: "mine-2" } });
  });
  await page.route("**/api/gallery/mine-2/restore", (route) => {
    withdrawn = false;
    return route.fulfill({ json: { id: "mine-2" } });
  });
  await page.route("**/api/gallery/mine-2/versions", (route) =>
    route.fulfill({
      json: {
        versions: [
          {
            versionId: "v-1",
            versionNo: 1,
            name: "Live Amp v1",
            author: "Maker",
            tags: [],
            createdAt: "2026-08-21T08:00:00.000Z",
          },
        ],
      },
    }),
  );
  const svg = {
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
  };
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill(svg),
  );
  await page.route("**/api/gallery/*/versions/*/preview.svg", (route) =>
    route.fulfill(svg),
  );

  await page.goto("/mine");
  // Withdrawal is one click: Restore undoes it.
  await page.getByTestId("mine-withdraw-mine-2").click();
  await expect(page.getByTestId("mine-status-mine-2")).toHaveText("Withdrawn");
  await expect(page.getByTestId("mine-notice")).toContainText("Withdrew");
  // Restore republishes a voluntary withdrawal.
  await page.getByTestId("mine-restore-mine-2").click();
  await expect(page.getByTestId("mine-status-mine-2")).toHaveText("Published");
  // The version history dialog lists the snapshot with its preview.
  await page.getByTestId("mine-history-mine-2").click();
  const history = page.getByTestId("version-history-dialog");
  await expect(history).toBeVisible();
  await expect(page.locator(".version-history-backdrop")).toHaveCSS(
    "position",
    "fixed",
  );
  await expect(history).toHaveCSS("display", "flex");
  const version = page.getByTestId("version-1");
  await expect(version).toHaveCSS("display", "grid");
  await expect(version).toContainText("Live Amp v1");
});
