import { expect, it } from "vitest";
import { AuthDO, type AuthEnv } from "./auth-do";
import { ORIGIN, signIn, sqliteState } from "./gallery.test-support";

it("retries an uncertain rejection with identical provider bytes after sender configuration changes", async () => {
  const state = sqliteState();
  let auth: AuthDO;
  const config: AuthEnv = {
    AUTH: {
      getByName: () => ({
        fetch: (input, init) =>
          auth.fetch(
            typeof input === "string" ? new Request(input, init) : input,
          ),
      }),
    },
    RESEND_API_KEY: "test-key",
    AUTH_EMAIL_FROM: "Canvas <before@example.com>",
    ADMIN_EMAILS: "owner@example.com",
  };
  auth = new AuthDO(state, config);
  const cookie = await signIn(auth, "author@example.com");
  const { user } = await (
    await auth.fetch(
      new Request(ORIGIN + "/api/auth/me", { headers: { cookie } }),
    )
  ).json();
  const attempts: { body: string; key: string | null }[] = [];
  auth.fetchLike = (async (_input, init) => {
    attempts.push({
      body: String(init?.body),
      key: new Headers(init?.headers).get("idempotency-key"),
    });
    throw new TypeError("Provider accepted mail but its reply was lost");
  }) as typeof fetch;
  const send = () =>
    auth.fetch(
      new Request("https://auth/internal/gallery-rejection", {
        method: "POST",
        body: JSON.stringify({
          ownerUserId: user.id,
          entryName: "Test circuit",
          reason: "Topology needs correction",
          noticeId: "config-retry",
        }),
      }),
    );
  expect(await (await send()).json()).toEqual({ sent: false });
  // A deployment restarts Auth with a different sender. The existing attempt
  // still belongs to its original provider key and complete request payload.
  auth = new AuthDO(state, {
    ...config,
    AUTH_EMAIL_FROM: "Canvas <after@example.com>",
  });
  auth.fetchLike = (async (_input, init) => {
    attempts.push({
      body: String(init?.body),
      key: new Headers(init?.headers).get("idempotency-key"),
    });
    return Response.json({ id: "mail-once" });
  }) as typeof fetch;
  expect(await (await send()).json()).toEqual({ sent: true });
  expect(attempts[1]).toEqual(attempts[0]);
  expect(JSON.parse(attempts[1]!.body)).toMatchObject({
    from: "Canvas <before@example.com>",
    to: ["author@example.com"],
    reply_to: expect.any(String),
  });
  expect(await (await send()).json()).toEqual({ sent: true });
  expect(attempts).toHaveLength(2);
});
