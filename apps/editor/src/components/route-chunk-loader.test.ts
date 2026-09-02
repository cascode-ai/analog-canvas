import { describe, expect, it, vi } from "vitest";

import { guardedRouteChunk } from "./route-chunk-loader";
import type { RouteChunkRuntime } from "./route-chunk-loader";
import {
  ConfirmedStaleBuildError,
  TemporaryModuleLoadError,
} from "./stale-build-recovery";
import type { ModuleLoadDiagnosis } from "./stale-build-recovery";

function runtime(
  diagnosis: ModuleLoadDiagnosis,
  remembered: string | null = null,
) {
  const reload = vi.fn();
  const cleanReload = vi.fn(() => Promise.resolve());
  const rememberReload = vi.fn(() => true);
  const forgetReload = vi.fn();
  const delay = vi.fn(() => Promise.resolve());
  const value: RouteChunkRuntime = {
    pathname: "/editor",
    rememberedReload: () => remembered,
    rememberReload,
    forgetReload,
    diagnose: () => Promise.resolve(diagnosis),
    delay,
    reload,
    cleanReload,
  };
  return {
    value,
    reload,
    cleanReload,
    rememberReload,
    forgetReload,
    delay,
  };
}

describe("guardedRouteChunk", () => {
  it("passes a loaded route through and clears the retry guard", async () => {
    const context = runtime({ kind: "temporary", assetUrl: null });
    const module = { default: "editor" };
    await expect(
      guardedRouteChunk(() => Promise.resolve(module), context.value)(),
    ).resolves.toBe(module);
    expect(context.forgetReload).toHaveBeenCalledOnce();
  });

  it("clean-reloads once when the named asset is confirmed missing", async () => {
    const context = runtime({
      kind: "stale-build",
      assetUrl: "https://example.test/assets/App-old.js",
      status: 404,
    });
    void guardedRouteChunk(
      () => Promise.reject(new TypeError("dynamic import failed")),
      context.value,
    )();
    await vi.waitFor(() => expect(context.cleanReload).toHaveBeenCalledOnce());
    expect(context.rememberReload).toHaveBeenCalledWith("/editor");
    expect(context.reload).not.toHaveBeenCalled();
  });

  it("delays and ordinarily reloads once for a temporary failure", async () => {
    const context = runtime({
      kind: "temporary",
      assetUrl: "https://example.test/assets/App-current.js",
      status: 200,
    });
    void guardedRouteChunk(
      () => Promise.reject(new TypeError("dynamic import failed")),
      context.value,
    )();
    await vi.waitFor(() => expect(context.reload).toHaveBeenCalledOnce());
    expect(context.delay).toHaveBeenCalledWith(750);
    expect(context.cleanReload).not.toHaveBeenCalled();
  });

  it("surfaces the confirmed diagnosis instead of reloading twice", async () => {
    const stale = runtime(
      {
        kind: "stale-build",
        assetUrl: "https://example.test/assets/App-old.js",
        status: 404,
      },
      "/editor",
    );
    await expect(
      guardedRouteChunk(
        () => Promise.reject(new TypeError("dynamic import failed")),
        stale.value,
      )(),
    ).rejects.toBeInstanceOf(ConfirmedStaleBuildError);
    expect(stale.cleanReload).not.toHaveBeenCalled();

    const temporary = runtime(
      {
        kind: "temporary",
        assetUrl: "https://example.test/assets/App-current.js",
        status: 200,
      },
      "/editor",
    );
    await expect(
      guardedRouteChunk(
        () => Promise.reject(new TypeError("dynamic import failed")),
        temporary.value,
      )(),
    ).rejects.toBeInstanceOf(TemporaryModuleLoadError);
    expect(temporary.reload).not.toHaveBeenCalled();
  });
});
