import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Plugin, ProxyOptions } from "vite";

import { localAgentRelay } from "./agent-relay.js";

const { stop, unstable_dev } = vi.hoisted(() => {
  const stop = vi.fn(async () => undefined);
  return {
    stop,
    unstable_dev: vi.fn(async () => ({
      address: "127.0.0.1",
      port: 8787,
      stop,
    })),
  };
});
vi.mock("wrangler", () => ({ unstable_dev }));

beforeEach(() => {
  unstable_dev.mockClear();
  stop.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

/** The plugin and its /api/agent/ proxy for one server, as Vite sets it up. */
function relayFor(server: "server" | "preview") {
  const plugin = localAgentRelay();
  const proxy = (plugin.config as Function)()[server].proxy[
    "/api/agent/"
  ] as ProxyOptions;
  const options: ProxyOptions = {};
  proxy.configure!(undefined as never, options);
  const request = () => proxy.bypass!({} as never, undefined, options);
  const httpServer = new EventEmitter();
  const configurePreview = () =>
    (plugin.configurePreviewServer as Function)({ httpServer });
  return {
    plugin: plugin as Plugin,
    options,
    request,
    httpServer,
    configurePreview,
  };
}

it("starts the relay with the browser tests' preview server, before the first Agent request", async () => {
  vi.stubEnv("ICM_E2E_RELAY_AT_START", "1");
  const { options, request, configurePreview } = relayFor("preview");
  configurePreview();
  await vi.waitFor(() => expect(unstable_dev).toHaveBeenCalledTimes(1));
  // The first request reuses the relay that is already starting.
  await request();
  expect(unstable_dev).toHaveBeenCalledTimes(1);
  expect(options.target).toBe("http://127.0.0.1:8787");
});

it("leaves any other server's relay to its first Agent request", async () => {
  vi.stubEnv("ICM_E2E_RELAY_AT_START", undefined);
  const dev = relayFor("server");
  (dev.plugin.configureServer as Function | undefined)?.({});
  const preview = relayFor("preview");
  preview.configurePreview();
  await vi.dynamicImportSettled();
  expect(unstable_dev).not.toHaveBeenCalled();
  await dev.request();
  expect(unstable_dev).toHaveBeenCalledTimes(1);
});

it("stops the relay when the preview server closes, so its process can exit", async () => {
  const { request, httpServer, configurePreview } = relayFor("preview");
  configurePreview();
  await request();
  httpServer.emit("close");
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
});
