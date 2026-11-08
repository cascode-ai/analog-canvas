import { RegionalSessionDO } from "./regional-session";
import type { AuthEnv } from "./auth-do";
import { environment, ORIGIN, sqliteState } from "./gallery.test-support";

export const transportOrigin = "https://authority.test";
export const secret = "isolated-regional-account-service-secret";
export const config = JSON.stringify({
  origin: ORIGIN,
  clientOrigin: ORIGIN,
  transportOrigin,
  secret,
});

export function accounts(
  authConfig: Partial<AuthEnv> = {},
  regionalEnv: ConstructorParameters<typeof RegionalSessionDO>[1] = {},
) {
  const source = environment({
    ...authConfig,
    AUTH_REGIONAL_AUTHORITY: authConfig.AUTH_REGIONAL_AUTHORITY ?? config,
  });
  const state = {
    storage: { ...sqliteState().storage, setAlarm: async (_at: number) => {} },
  };
  const region = new RegionalSessionDO(state, {
    AUTH_REGIONAL_CLIENT: config,
    ...regionalEnv,
  });
  let time = Date.now();
  region.now = () => time;
  source.authDurable.now = () => new Date(time);
  region.fetchLike = (async (input, init) =>
    source.authDurable.fetch(new Request(input, init))) as typeof fetch;
  const call = (path: string, cookie: string, method = "GET", body?: unknown) =>
    region.fetch(
      new Request(ORIGIN + path, {
        method,
        headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return {
    source,
    region,
    state,
    call,
    resources: {
      ...source,
      AUTH_REGIONAL_CLIENT: config,
      AUTH: {
        getByName: () => ({
          fetch: (input: Request | string, init?: RequestInit) =>
            region.fetch(
              typeof input === "string" ? new Request(input, init) : input,
            ),
        }),
      },
    },
    advance: (ms: number) => {
      time += ms;
    },
    async connect(sourceCookie: string) {
      const start = await call("/api/auth/regional/start", "");
      const location = start.headers.get("location");
      if (!location) throw new Error("No authority redirect");
      const url = new URL(location);
      const authorized = await source.authDurable.fetch(
        new Request(transportOrigin + url.pathname + url.search, {
          headers: { cookie: sourceCookie },
        }),
      );
      const callbackUrl = authorized.headers.get("location");
      const pending = start.headers.getSetCookie()[0]?.split(";")[0];
      if (!callbackUrl || !pending) throw new Error("No regional callback");
      const callback = await region.fetch(
        new Request(callbackUrl, { headers: { cookie: pending } }),
      );
      const cookie = callback.headers
        .getSetCookie()
        .find((value) => value.startsWith("icm_regional_session="))
        ?.split(";")[0];
      if (!cookie) throw new Error("No regional session");
      return cookie;
    },
  };
}
