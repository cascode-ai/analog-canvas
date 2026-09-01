import { describe, expect, it, vi } from "vitest";

import {
  isStaleBuildFailure,
  recoverFromStaleBuild,
} from "./stale-build-recovery";

describe("recognising a build a page can no longer load", () => {
  it("knows the browsers' several spellings of a missing chunk", () => {
    // The message a person reported in #493, plus the forms other engines
    // use for the same event. Getting this wrong offers the wrong remedy.
    expect(
      isStaleBuildFailure(
        "Failed to fetch dynamically imported module: https://example.test/assets/App-L9bGmgOj.js",
      ),
    ).toBe(true);
    expect(
      isStaleBuildFailure("error loading dynamically imported module"),
    ).toBe(true);
    expect(isStaleBuildFailure("Importing a module script failed.")).toBe(true);
    expect(
      isStaleBuildFailure(
        "Properties could not load — the app has been updated since this tab opened",
      ),
    ).toBe(true);
  });

  it("does not claim an ordinary crash is a stale build", () => {
    expect(isStaleBuildFailure("Cannot read properties of undefined")).toBe(
      false,
    );
    expect(isStaleBuildFailure("Route net does not exist: net-h")).toBe(false);
  });
});

describe("recovering from a build a page can no longer load", () => {
  function surfaces(overrides: { keys?: string[] } = {}) {
    const deleted: string[] = [];
    const unregistered: string[] = [];
    const reload = vi.fn();
    return {
      deleted,
      unregistered,
      reload,
      value: {
        caches: {
          keys: () =>
            Promise.resolve(
              overrides.keys ?? [
                "icm-static-shell-abc",
                "icm-static-shell-def",
                "some-other-cache",
              ],
            ),
          delete: (key: string) => {
            deleted.push(key);
            return Promise.resolve(true);
          },
        } as unknown as CacheStorage,
        serviceWorker: {
          getRegistrations: () =>
            Promise.resolve([
              {
                unregister: () => {
                  unregistered.push("sw");
                  return Promise.resolve(true);
                },
              },
            ]),
        } as unknown as ServiceWorkerContainer,
        reload,
      },
    };
  }

  it("drops this app's shell caches, its worker, and reloads", async () => {
    const context = surfaces();
    await recoverFromStaleBuild(context.value);
    expect(context.deleted).toEqual([
      "icm-static-shell-abc",
      "icm-static-shell-def",
    ]);
    // A cache this app did not create is somebody else's to manage.
    expect(context.deleted).not.toContain("some-other-cache");
    expect(context.unregistered).toEqual(["sw"]);
    expect(context.reload).toHaveBeenCalledOnce();
  });

  it("still reloads when the browser refuses its caches", async () => {
    // Private modes and locked-down browsers throw here. The reload is the
    // part that gets the person moving, so it must not be skipped.
    const reload = vi.fn();
    await recoverFromStaleBuild({
      caches: {
        keys: () => Promise.reject(new Error("denied")),
      } as unknown as CacheStorage,
      reload,
    });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads when there is no service worker at all", async () => {
    const reload = vi.fn();
    await recoverFromStaleBuild({ reload });
    expect(reload).toHaveBeenCalledOnce();
  });
});
