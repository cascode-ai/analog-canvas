// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { SaveSignInDialog } from "./cloud-save-sign-in";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("offers a sign-in or the Project file to a signed-out Save (#2161)", async () => {
  const choices = {
    onSignIn: vi.fn(),
    onDownload: vi.fn(),
    onClose: vi.fn(),
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<SaveSignInDialog {...choices} />));
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Sign in to save");
  expect(dialog.textContent).toContain("Saving to the Cloud needs an account");
  const button = (name: string) =>
    [...dialog.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === name,
    )!;
  await act(async () => button("Sign in").click());
  expect(choices.onSignIn).toHaveBeenCalledOnce();
  await act(async () => button("Download project file").click());
  expect(choices.onDownload).toHaveBeenCalledOnce();
  await act(async () => button("Not now").click());
  await act(async () => {
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(choices.onClose).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});
