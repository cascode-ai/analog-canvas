import { afterEach, expect, it, vi } from "vitest";
import { GalleryDO } from "./gallery-do";
import {
  environment,
  makerOf,
  ORIGIN,
  route,
  sqliteState,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());

async function authorityTrial() {
  const secret = "isolated-project-authority-secret-1974";
  const authority = JSON.stringify({
    origin: ORIGIN,
    clientOrigin: "https://cn.test",
    secret,
  });
  const auth = environment({ AUTH_REGIONAL_AUTHORITY: authority });
  const cookie = await makerOf(auth);
  const { user } = await (
    await auth.authDurable.fetch(
      new Request("https://auth/internal/session-user", {
        headers: { Cookie: cookie },
      }),
    )
  ).json();
  const store = new GalleryDO(sqliteState(), {
    PROJECT_REGION: "overseas",
    PROJECT_REGION_USERS: JSON.stringify([user.id]),
  });
  const source = {
    ...auth,
    AUTH_REGIONAL_AUTHORITY: authority,
    PROJECT_REGION: "overseas" as const,
    PROJECT_REGION_USERS: JSON.stringify([user.id]),
    PROJECT_SYNC_TOKEN: "peer-token",
    PROJECT_IDENTITY_URL: `${ORIGIN}/api/auth/regional/identities`,
    PROJECT_IDENTITY_TOKEN: secret,
    GALLERY: {
      getByName: () => ({
        fetch: (input: string, init?: RequestInit) =>
          store.fetch(new Request(input, init)),
      }),
    },
  };
  vi.stubGlobal("fetch", () =>
    Promise.reject(new Error("Public self-fetch unavailable")),
  );
  const request = (ownerUserId = user.id, token = "peer-token") =>
    new Request(`${ORIGIN}/api/project-sync/quota`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "new-domestic-project",
        ownerUserId,
      }),
    });
  return { source, user, request };
}

it("reserves a domestic Project for the original owner when the authority cannot fetch its own public URL", async () => {
  const { source, user, request } = await authorityTrial();
  const response = await route(source, request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    id: "new-domestic-project",
    ownerUserId: user.id,
    reservation: expect.any(String),
  });
});

it("still authenticates the identity credential inside the authority binding", async () => {
  const { source, request } = await authorityTrial();
  const response = await route(
    { ...source, PROJECT_IDENTITY_TOKEN: "incorrect-identity-credential" },
    request(),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "identity-unavailable" });
});

it("does not grant a slot to an unknown account or an unauthenticated peer", async () => {
  const { source, request } = await authorityTrial();
  const unknown = await route(source, request("missing-original-account"));
  expect(unknown.status).toBe(409);
  expect(await unknown.json()).toEqual({ error: "unknown-owner" });
  const denied = await route(source, request(undefined, "wrong-peer-token"));
  expect(denied.status).toBe(401);
});

it.each(["missing-config", "different-authority", "different-path"])(
  "does not substitute local accounts for an unowned identity endpoint (%s)",
  async (mode) => {
    const { source, request } = await authorityTrial();
    const { AUTH_REGIONAL_AUTHORITY: _authority, ...withoutAuthority } = source;
    const response = await route(
      {
        ...(mode === "missing-config" ? withoutAuthority : source),
        ...(mode === "missing-config"
          ? {}
          : {
              PROJECT_IDENTITY_URL:
                mode === "different-authority"
                  ? "https://other.test/api/auth/regional/identities"
                  : `${ORIGIN}/api/auth/regional/providers`,
            }),
      },
      request(),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "identity-unavailable" });
  },
);
