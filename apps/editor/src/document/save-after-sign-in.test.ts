// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";

import {
  rememberSaveOnSignIn,
  saveAfterSignInRedirect,
  takePendingSave,
} from "./save-after-sign-in";

afterEach(() => {
  sessionStorage.clear();
  document.body.replaceChildren();
});

const MINUTE = 60_000;

function chooseProvider(href: string) {
  const link = document.createElement("a");
  link.setAttribute("href", href);
  const mark = document.createElement("span");
  link.append(mark);
  document.body.append(link);
  // The page sees the click as the browser would; jsdom cannot navigate.
  link.addEventListener("click", (event) => event.preventDefault());
  mark.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

it("saves the Project once, after the sign-in, in its own tab (#2161)", () => {
  rememberSaveOnSignIn("project-A", document, sessionStorage, () => 0);
  // Another tab's Save keeps waiting.
  expect(takePendingSave("project-B", sessionStorage, MINUTE)).toBe(false);
  expect(takePendingSave("project-A", sessionStorage, MINUTE)).toBe(true);
  expect(takePendingSave("project-A", sessionStorage, MINUTE)).toBe(false);
});

it("forgets a Save left waiting too long", () => {
  rememberSaveOnSignIn("project-A", document, sessionStorage, () => 0);
  expect(takePendingSave("project-B", sessionStorage, 16 * MINUTE)).toBe(false);
  expect(takePendingSave("project-A", sessionStorage, 16 * MINUTE)).toBe(false);
});

it("brings the window back to the editor after a GitHub or Google sign-in", () => {
  rememberSaveOnSignIn("project-A", document, sessionStorage, () => 0);
  // Declining the choices leaves the Gallery as it is.
  expect(saveAfterSignInRedirect({ pathname: "/" }, sessionStorage, 0)).toBe(
    null,
  );
  chooseProvider("/api/auth/github/start");
  expect(
    saveAfterSignInRedirect({ pathname: "/editor" }, sessionStorage, MINUTE),
  ).toBe(null);
  expect(
    saveAfterSignInRedirect({ pathname: "/" }, sessionStorage, MINUTE),
  ).toBe("/editor?resume=1");
  // Once.
  expect(
    saveAfterSignInRedirect({ pathname: "/" }, sessionStorage, MINUTE),
  ).toBe(null);
  // The Save itself still waits for the editor.
  expect(takePendingSave("project-A", sessionStorage, MINUTE)).toBe(true);
});

it("does not take a click elsewhere for a sign-in", () => {
  rememberSaveOnSignIn("project-A", document, sessionStorage, () => 0);
  chooseProvider("/privacy");
  expect(saveAfterSignInRedirect({ pathname: "/" }, sessionStorage, 0)).toBe(
    null,
  );
});
