import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import {
  galleryEntryIdOfPath,
  isAppPagePath,
  isEditorPath,
} from "./page-routes";

it("names every page the app serves, and nothing else (#2159)", () => {
  for (const path of [
    "/",
    "/editor",
    "/editor/",
    "/g/efx8jakksk",
    "/g/ag-308/",
    "/analytics",
    "/moderation/",
    "/privacy",
    "/changelog",
    "/account",
    "/mine",
    "/datasets",
    "/review",
  ])
    expect(isAppPagePath(path), path).toBe(true);
  for (const path of [
    "/no-such-page",
    "/favicon.ico",
    "/editor/extra",
    "/g/",
    "/g/not.an.id",
    "/g/efx8jakksk/extra",
    "/reviews",
    "/office/taskpane.html",
  ])
    expect(isAppPagePath(path), path).toBe(false);
  expect(isEditorPath("/g/efx8jakksk")).toBe(true);
  expect(isEditorPath("/datasets")).toBe(false);
  expect(galleryEntryIdOfPath("/g/ag-308/")).toBe("ag-308");
  // A dataset's own id may hold `_`, as worker/gallery-sources.ts reads it.
  expect(galleryEntryIdOfPath("/g/amsnet-a_b")).toBe("amsnet-a_b");
  expect(galleryEntryIdOfPath("/editor")).toBeNull();
});

it("covers each page the browser routes, so the Worker answers none of them 404", () => {
  // The web entry routes its named pages one by one; a page added there and
  // not here would be a 404 on Production.
  const entry = readFileSync(
    resolve(import.meta.dirname, "entries/web.tsx"),
    "utf8",
  );
  const routed = [...entry.matchAll(/\/\^\\\/(\w+)\\\/\?\$\/\.test\(path\)/gu)]
    .map((match) => `/${match[1]}`)
    .filter((path) => path !== "/g");
  expect(routed.length).toBeGreaterThan(5);
  for (const path of routed) expect(isAppPagePath(path), path).toBe(true);
});
