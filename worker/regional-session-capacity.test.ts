import { expect, it } from "vitest";
import { makerOf, ORIGIN } from "./gallery.test-support";
import { accounts, config } from "./regional-auth.test-support";
import { RegionalSessionDO } from "./regional-session";
import { REGIONAL_LEASE_MS } from "./regional-auth-contract";

it("renews 1000 sessions across restart with two-second transport and processing overhead", async () => {
  const h = accounts();
  const source = await makerOf(h.source);
  let nextAlarm = 0;
  h.state.storage.setAlarm = async (at) => {
    nextAlarm = at;
  };
  const cookies: string[] = [];
  for (let offset = 0; offset < 1000; offset += 100)
    cookies.push(
      ...(await Promise.all(
        Array.from({ length: 100 }, () => h.connect(source)),
      )),
    );
  const began = h.region.now();
  let region = h.region;
  let restarted = false;
  const sourceTransport = h.region.fetchLike;
  let transportReleased = Promise.resolve();
  const transport: typeof fetch = async (input, init) => {
    const released = transportReleased;
    const response = await sourceTransport(input, init);
    if (String(input).endsWith("/renew")) await released;
    return response;
  };
  region.fetchLike = transport;
  const states = async () =>
    Promise.all(
      cookies.map(
        async (cookie) =>
          (
            await (
              await region.fetch(
                new Request(ORIGIN + "/api/auth/me", { headers: { cookie } }),
              )
            ).json()
          ).authorization,
      ),
    );
  // The runtime invokes its next persisted alarm only after this alarm ends.
  // Model two seconds of transport plus 200ms of processing. A batch ends
  // before the runtime can deliver its next persisted alarm.
  while (h.region.now() - began < 120_000) {
    h.advance(Math.max(0, nextAlarm - h.region.now()));
    expect(new Set(await states())).toEqual(new Set(["active"]));
    const release = Promise.withResolvers<void>();
    transportReleased = release.promise;
    const pending = region.alarm();
    h.advance(2200);
    // Check while replies are still in flight: checking only after renewal
    // can miss a transient expiry that a real browser observes mid-batch.
    const duringRenewal = new Set(await states());
    release.resolve();
    await pending;
    expect(duringRenewal).toEqual(new Set(["active"]));
    expect(new Set(await states())).toEqual(new Set(["active"]));
    if (!restarted && h.region.now() - began >= 90_000) {
      region = new RegionalSessionDO(h.state, { AUTH_REGIONAL_CLIENT: config });
      region.now = h.region.now;
      region.fetchLike = transport;
      restarted = true;
    }
  }
  expect(restarted).toBe(true);
  region.fetchLike = async () => {
    throw new Error("isolated outage");
  };
  h.advance(REGIONAL_LEASE_MS + 1);
  await region.alarm();
  expect(new Set(await states())).toEqual(new Set(["expired"]));
}, 60_000);
