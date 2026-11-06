import { expect, it } from "vitest";
import { makerOf } from "./gallery.test-support";
import { accounts } from "./regional-auth.test-support";

it("renews a burst of 1000 sessions through scheduled alarms with a two-second transport delay", async () => {
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
  const states = async () =>
    Promise.all(
      cookies.map(
        async (cookie) =>
          (await (await h.call("/api/auth/me", cookie)).json()).authorization,
      ),
    );
  // The runtime invokes its next persisted alarm only after this alarm ends.
  // Advancing while its I/O is pending models transport, not authority bypass.
  while (h.region.now() - began < 120_000) {
    h.advance(Math.max(0, nextAlarm - h.region.now()));
    expect(new Set(await states())).toEqual(new Set(["active"]));
    const pending = h.region.alarm();
    h.advance(2000);
    await pending;
    expect(new Set(await states())).toEqual(new Set(["active"]));
  }
  h.region.fetchLike = async () => {
    throw new Error("isolated outage");
  };
  h.advance(60_001);
  await h.region.alarm();
  expect(new Set(await states())).toEqual(new Set(["expired"]));
}, 30_000);
