import { afterEach, expect, it, vi } from "vitest";
import { routeGalleryRequest } from "./gallery";
import { RegionalSessionDO } from "./regional-session";
import {
  environment,
  makerOf,
  ORIGIN,
  sqliteState,
} from "./gallery.test-support";

afterEach(() => vi.restoreAllMocks());

it("stops Gallery access at the regional session lease deadline after a recent read", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const origin = "https://cn.test";
  const config = JSON.stringify({
    origin: ORIGIN,
    clientOrigin: origin,
    secret: "regional-service-secret-for-isolated-gallery-tests",
  });
  const source = environment({ AUTH_REGIONAL_AUTHORITY: config });
  const overseasCookie = await makerOf(source);
  const state = sqliteState();
  const localAuth = new RegionalSessionDO(
    { storage: { ...state.storage, setAlarm: async () => {} } },
    { AUTH_REGIONAL_CLIENT: config },
  );
  localAuth.fetchLike = (async (input, init) =>
    source.authDurable.fetch(new Request(input, init))) as typeof fetch;
  const start = await localAuth.fetch(
    new Request(`${origin}/api/auth/regional/start`),
  );
  const authorized = await source.authDurable.fetch(
    new Request(start.headers.get("location")!, {
      headers: { Cookie: overseasCookie },
    }),
  );
  const callback = await localAuth.fetch(
    new Request(authorized.headers.get("location")!, {
      headers: { Cookie: start.headers.get("set-cookie")!.split(";")[0]! },
    }),
  );
  expect(callback.status).toBe(302);
  const cookie = callback.headers.get("set-cookie")!.split(";")[0]!;
  const target = {
    ...environment(),
    AUTH_REGIONAL_CLIENT: config,
    AUTH: {
      getByName: () => ({
        fetch: (input: Request | string, init?: RequestInit) =>
          localAuth.fetch(
            typeof input === "string" ? new Request(input, init) : input,
          ),
      }),
    },
  };
  localAuth.fetchLike = vi.fn(async () => {
    throw new Error("cross-border unavailable");
  });
  const read = () =>
    routeGalleryRequest(
      new Request(`${origin}/api/gallery?tag=amplifier`, {
        headers: { Cookie: cookie },
      }),
      target,
    );

  now += 59_000;
  expect((await read())?.status).toBe(200);
  now += 2_000;
  expect((await read())?.status).toBe(401);
  expect(localAuth.fetchLike).not.toHaveBeenCalled();
});
