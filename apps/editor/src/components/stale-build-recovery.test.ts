import { describe, expect, it, vi } from "vitest";

import {
  ConfirmedStaleBuildError,
  diagnoseModuleLoadFailure,
  isStaleBuildFailure,
  isTemporaryModuleLoadFailure,
  recoverFromStaleBuild,
  TemporaryModuleLoadError,
} from "./stale-build-recovery";

describe("recognising a build a page can no longer load", () => {
  it("does not call a browser's ambiguous import message proof of a stale build", () => {
    // #529 named a module that was part of the current deployment and later
    // answered 200. Browsers use the same message for that transient failure
    // and for the true missing-chunk failure from #493.
    expect(
      isStaleBuildFailure(
        new TypeError(
          "Failed to fetch dynamically imported module: https://example.test/assets/App-current.js",
        ),
      ),
    ).toBe(false);
  });

  it("recognises only errors created after the asset probe", () => {
    const raw = new TypeError("dynamic import failed");
    const stale = new ConfirmedStaleBuildError(
      "https://example.test/assets/App-old.js",
      raw,
    );
    const temporary = new TemporaryModuleLoadError(
      "https://example.test/assets/App-current.js",
      raw,
    );
    expect(isStaleBuildFailure(stale)).toBe(true);
    expect(isStaleBuildFailure(temporary)).toBe(false);
    expect(isTemporaryModuleLoadFailure(temporary)).toBe(true);
    expect(isTemporaryModuleLoadFailure(raw)).toBe(false);
  });
});

describe("diagnosing a dynamic module failure", () => {
  const currentUrl = "https://example.test/editor";
  const failure = new TypeError(
    "Failed to fetch dynamically imported module: https://example.test/assets/App-build.js",
  );

  it("confirms a stale build only when the named same-origin asset is 404", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    await expect(
      diagnoseModuleLoadFailure(failure, { currentUrl, fetch }),
    ).resolves.toEqual({
      kind: "stale-build",
      assetUrl: "https://example.test/assets/App-build.js",
      status: 404,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://example.test/assets/App-build.js",
      expect.objectContaining({ method: "HEAD", cache: "no-store" }),
    );
  });

  it("keeps a current asset failure temporary when the probe is 200", async () => {
    await expect(
      diagnoseModuleLoadFailure(failure, {
        currentUrl,
        fetch: () => Promise.resolve(new Response(null, { status: 200 })),
      }),
    ).resolves.toEqual({
      kind: "temporary",
      assetUrl: "https://example.test/assets/App-build.js",
      status: 200,
    });
  });

  it("keeps network, cross-origin, and URL-less failures temporary", async () => {
    await expect(
      diagnoseModuleLoadFailure(failure, {
        currentUrl,
        fetch: () => Promise.reject(new Error("offline")),
      }),
    ).resolves.toEqual({
      kind: "temporary",
      assetUrl: "https://example.test/assets/App-build.js",
    });
    await expect(
      diagnoseModuleLoadFailure(
        new TypeError(
          "Failed to fetch dynamically imported module: https://other.test/assets/App-build.js",
        ),
        {
          currentUrl,
          fetch: () => Promise.resolve(new Response(null, { status: 404 })),
        },
      ),
    ).resolves.toEqual({ kind: "temporary", assetUrl: null });
    await expect(
      diagnoseModuleLoadFailure(new TypeError("module load failed"), {
        currentUrl,
        fetch: () => Promise.resolve(new Response(null, { status: 404 })),
      }),
    ).resolves.toEqual({ kind: "temporary", assetUrl: null });
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
