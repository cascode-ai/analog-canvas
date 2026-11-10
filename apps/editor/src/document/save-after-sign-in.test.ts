// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import {
  forgetSaveOnSignIn,
  rememberSaveOnSignIn,
  saveAfterSignInRedirect,
  settleSaveOnEditorOpen,
  takePendingSave,
} from "./save-after-sign-in";

const MINUTE = 60_000;
const timers = { set: () => 0, clear: () => {} };
let stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  sessionStorage.clear();
  document.body.replaceChildren();
});

/** Sign in pressed in a Save dialog at `at`. */
function remember(projectId = "project-A", at = 0) {
  stops.push(
    rememberSaveOnSignIn(projectId, document, sessionStorage, () => at, timers),
  );
}

/** The page's sign-in choices, open as Sign in leaves them. */
function signInChoices() {
  const details = document.createElement("details");
  details.className = "account-signin";
  details.open = true;
  document.body.append(details);
  return details;
}

function click(href: string, inside: Element = document.body) {
  const link = document.createElement("a");
  link.setAttribute("href", href);
  const mark = document.createElement("span");
  link.append(mark);
  inside.append(link);
  // The page sees the click as the browser would; jsdom cannot navigate.
  link.addEventListener("click", (event) => event.preventDefault());
  mark.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

function close(details: HTMLDetailsElement) {
  details.open = false;
  details.dispatchEvent(new Event("toggle"));
}

const gallery = (search = "") => ({ pathname: "/", search });

it("saves the Project once, after the sign-in, in its own tab (#2161)", () => {
  remember();
  // Another tab's Save keeps waiting.
  expect(takePendingSave("project-B", sessionStorage, MINUTE)).toBe(false);
  expect(takePendingSave("project-A", sessionStorage, MINUTE)).toBe(true);
  expect(takePendingSave("project-A", sessionStorage, MINUTE)).toBe(false);
});

it("forgets a Save left waiting too long", () => {
  remember();
  expect(takePendingSave("project-B", sessionStorage, 16 * MINUTE)).toBe(false);
  expect(takePendingSave("project-A", sessionStorage, 16 * MINUTE)).toBe(false);
});

it("brings the window back to the editor after a GitHub or Google sign-in", () => {
  remember();
  // Not chosen yet: the Gallery stays the Gallery.
  expect(saveAfterSignInRedirect(gallery(), sessionStorage, 0)).toBe(null);
  click("/api/auth/github/start", signInChoices());
  expect(
    saveAfterSignInRedirect(
      { pathname: "/editor", search: "" },
      sessionStorage,
      MINUTE,
    ),
  ).toBe(null);
  expect(saveAfterSignInRedirect(gallery(), sessionStorage, MINUTE)).toBe(
    "/editor?resume=1",
  );
  // Once.
  expect(saveAfterSignInRedirect(gallery(), sessionStorage, MINUTE)).toBe(null);
  // The editor opens, and the Save itself still waits for it.
  settleSaveOnEditorOpen({ search: "?resume=1" });
  expect(takePendingSave("project-A", sessionStorage, MINUTE)).toBe(true);
});

it("does not send a later Gallery visit back after a regional sign-in", () => {
  remember();
  // The regional sign-in returns straight to the editor.
  click("/api/auth/regional/start?return=%2Feditor", signInChoices());
  expect(settleSaveOnEditorOpen({ search: "" })).toEqual({
    signInFailed: false,
  });
  expect(takePendingSave("project-A", sessionStorage, MINUTE)).toBe(true);
  // Go to Gallery a minute later: it stays there.
  expect(saveAfterSignInRedirect(gallery(), sessionStorage, 2 * MINUTE)).toBe(
    null,
  );
});

it("does not send the Gallery back after the Save was taken", () => {
  remember();
  click("/api/auth/github/start", signInChoices());
  // Taken by an editor that never booted afresh (a tab already open).
  expect(takePendingSave("project-A", sessionStorage, MINUTE)).toBe(true);
  expect(saveAfterSignInRedirect(gallery(), sessionStorage, MINUTE)).toBe(null);
});

it("forgets the Save when the person goes Back from the provider", () => {
  remember();
  click("/api/auth/github/start", signInChoices());
  // Back restores the editor from the browser's cache: pageshow, persisted.
  forgetSaveOnSignIn();
  expect(saveAfterSignInRedirect(gallery(), sessionStorage, MINUTE)).toBe(null);
  expect(takePendingSave("project-A", sessionStorage, MINUTE)).toBe(false);
});

it("forgets the Save and stops listening when the choices close unchosen", () => {
  remember();
  const choices = signInChoices();
  const removed = vi.spyOn(document, "removeEventListener");
  close(choices);
  expect(takePendingSave("project-A", sessionStorage, MINUTE)).toBe(false);
  expect(removed).toHaveBeenCalledWith("click", expect.any(Function), {
    capture: true,
  });
  // A sign-in link chosen later for something else marks no way back.
  click("/api/auth/github/start");
  expect(saveAfterSignInRedirect(gallery(), sessionStorage, MINUTE)).toBe(null);
});

it("takes the editor back to say a failed sign-in failed, and drops the Save", () => {
  remember();
  click("/api/auth/google/start", signInChoices());
  expect(
    saveAfterSignInRedirect(gallery("?auth=failed"), sessionStorage, MINUTE),
  ).toBe("/editor?resume=1&auth=failed");
  expect(settleSaveOnEditorOpen({ search: "?resume=1&auth=failed" })).toEqual({
    signInFailed: true,
  });
  // It does not wait to run after some later sign-in.
  expect(takePendingSave("project-A", sessionStorage, MINUTE)).toBe(false);
});

it("leaves an ordinary failed sign-in on the Gallery", () => {
  expect(
    saveAfterSignInRedirect(gallery("?auth=failed"), sessionStorage, 0),
  ).toBe(null);
});

it("does not take a click elsewhere for a sign-in", () => {
  remember();
  click("/privacy");
  expect(saveAfterSignInRedirect(gallery(), sessionStorage, 0)).toBe(null);
});
