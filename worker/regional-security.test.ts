import { expect, it } from "vitest";
import {
  accounts,
  secret,
  transportOrigin,
} from "./regional-auth.test-support";
import {
  adminOf,
  makerOf,
  ownerAccountOf,
  ORIGIN,
  route,
  submitOne,
} from "./gallery.test-support";

it("sends a domestic moderator's rejection through the account authority without exposing its email provider", async () => {
  const h = accounts();
  const member = await h.connect(await makerOf(h.source));
  const admin = await h.connect(await adminOf(h.source));
  const id = await submitOne(h.resources, "Regional publication", {
    cookie: member,
  });
  const sent: { to: string[]; text: string }[] = [];
  h.source.authDurable.fetchLike = async (input, init) => {
    expect(String(input)).toBe("https://api.resend.com/emails");
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "isolated-rejection" });
  };
  const reject = (cookie: string) =>
    route(
      h.resources,
      new Request(ORIGIN + "/api/gallery/" + id + "/reject", {
        method: "POST",
        headers: { origin: ORIGIN, cookie, "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Please fix the missing source",
          notify: true,
        }),
      }),
    );
  expect((await reject(member)).status).toBe(401);
  expect(sent).toHaveLength(0);
  const rejected = await reject(admin);
  expect(rejected.status).toBe(200);
  expect(await rejected.json()).toMatchObject({ emailed: true });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ to: ["maker@example.com"] });
  expect(sent[0]?.text).toContain("Please fix the missing source");
});

it("limits security forwarding to the authenticated service and exact internal operations", async () => {
  const h = accounts();
  const owner = await h.connect(await ownerAccountOf(h.source));
  const rpc = (path: string, authorization = "Bearer " + secret) =>
    h.source.authDurable.fetch(
      new Request(transportOrigin + "/api/auth/regional/security", {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify({ path, body: {} }),
      }),
    );
  expect((await rpc("/internal/gallery-rejection", "")).status).toBe(401);
  for (const path of [
    "/api/auth/owner-tokens",
    "/internal/session-user",
    "https://attacker.test/internal/gallery-rejection",
    "/internal/gallery-rejection?user=owner",
    "/internal/gallery-rejection/",
    "/internal/block-account",
    "/internal/block-notices",
  ])
    expect((await rpc(path)).status).toBe(404);
  expect(
    (
      await h.call("/api/auth/regional/security", owner, "POST", {
        path: "/internal/gallery-rejection",
        body: {},
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await h.region.fetch(
        new Request(ORIGIN + "/internal/gallery-rejection", {
          method: "POST",
          headers: { cookie: owner, origin: ORIGIN },
        }),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await h.region.fetch(
        new Request("https://auth/internal/gallery-rejection"),
      )
    ).status,
  ).toBe(421);
  h.region.fetchLike = async () =>
    new Response(null, {
      status: 307,
      headers: { location: "https://attacker.test/" },
    });
  expect(
    (
      await h.region.fetch(
        new Request("https://auth/internal/gallery-rejection", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(503);
});
