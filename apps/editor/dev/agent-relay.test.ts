import { beforeEach, expect, it, vi } from "vitest";
import type { Plugin, ProxyOptions } from "vite";

import { localAgentRelay } from "./agent-relay.js";

const { unstable_dev } = vi.hoisted(() => ({
  unstable_dev: vi.fn(async () => ({
    address: "127.0.0.1",
    port: 8787,
    stop: async () => undefined,
  })),
}));
vi.mock("wrangler", () => ({ unstable_dev }));

beforeEach(() => unstable_dev.mockClear());

/** The plugin and its /api/agent/ proxy for one server, as Vite sets it up. */
function relayFor(server: "server" | "preview") {
  const plugin = localAgentRelay();
  const proxy = (plugin.config as Function)()[server].proxy[
    "/api/agent/"
  ] as ProxyOptions;
  const options: ProxyOptions = {};
  proxy.configure!(undefined as never, options);
  const request = () => proxy.bypass!({} as never, undefined, options);
  return { plugin: plugin as Plugin, options, request };
}

it("starts the relay with the preview server, before the first Agent request", async () => {
  const { plugin, options, request } = relayFor("preview");
  (plugin.configurePreviewServer as Function)({});
  await vi.waitFor(() => expect(unstable_dev).toHaveBeenCalledTimes(1));
  // The first request reuses the relay that is already starting.
  await request();
  expect(unstable_dev).toHaveBeenCalledTimes(1);
  expect(options.target).toBe("http://127.0.0.1:8787");
});

it("leaves the development server's relay to its first Agent request", async () => {
  const { plugin, request } = relayFor("server");
  (plugin.configureServer as Function | undefined)?.({});
  await vi.dynamicImportSettled();
  expect(unstable_dev).not.toHaveBeenCalled();
  await request();
  expect(unstable_dev).toHaveBeenCalledTimes(1);
});
