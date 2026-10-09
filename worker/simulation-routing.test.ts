import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  routeSimulationRequest,
  refuseSignedOutSimulation,
  type SimulationEnv,
} from "./simulation";
import ngspiceProfile from "../containers/ngspice/hosted-sky130-profile.json";
import {
  nativeEnvironment,
  nativeHealth,
  nativeInput,
  nativeReply,
} from "./simulation.test-fixture";

const post = (body: unknown) =>
  new Request("https://canvas.test/api/simulate", {
    method: "POST",
    body: JSON.stringify(body),
  });
const env: SimulationEnv = {
  SIMULATION_UPSTREAM_URL: "https://ngspice.test",
  SIMULATION_UPSTREAM_TOKEN: "ngspice-test-only",
  SIMULATION_DEFAULT_EXECUTOR: "operator-host",
  VACASK_PROFILE_ID: nativeEnvironment.profileId!,
  VACASK_UPSTREAM_URL: "https://vacask.test",
  VACASK_UPSTREAM_TOKEN: "vacask-test-only",
};
// Each mock represents a separate deployment. Do not reuse an earlier mock's
// successful runtime facts when replacing its transport with an outage fixture.
beforeEach(() => {
  env.VACASK_UPSTREAM_TOKEN = `vacask-test-only-${crypto.randomUUID()}`;
});
afterEach(() => vi.unstubAllGlobals());
describe("dual-engine Profile routing", () => {
  it("discovers both Profiles but returns the selected engine's collection and limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(nativeHealth)),
    );
    const all = (await (await routeSimulationRequest(
      post({ operation: "capabilities" }),
      env,
    ))!.json()) as any;
    expect(all.profiles.map((p: { id: string }) => p.id)).toEqual([
      ngspiceProfile.id,
      nativeEnvironment.profileId,
    ]);
    expect(all.profiles.map((p: { engine: string }) => p.engine)).toEqual([
      "ngspice",
      "vacask",
    ]);
    for (const [profileId, collection] of [
      [ngspiceProfile.id, "declared-single-ascii"],
      [nativeEnvironment.profileId, "native-multi-ascii"],
    ]) {
      const caps = (await (await routeSimulationRequest(
        post({ operation: "capabilities", environment: { profileId } }),
        env,
      ))!.json()) as any;
      expect(caps.rawfileCollection).toBe(collection);
      expect(caps.profiles.map((p: { id: string }) => p.id)).toEqual([
        profileId,
      ]);
    }
  });
  it("runs VACASK only at its own origin with its own credential", async () => {
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.origin).toBe("https://vacask.test");
      expect(init.redirect).toBe("manual");
      expect(new Headers(init.headers).get("authorization")).toBe(
        `Bearer ${env.VACASK_UPSTREAM_TOKEN}`,
      );
      return Response.json(
        url.pathname === "/health" ? nativeHealth : await nativeReply(),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await routeSimulationRequest(post(nativeInput()), env))!.status,
    ).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      (await routeSimulationRequest(post(nativeInput()), env))!.status,
    ).toBe(200);
    expect(fetcher.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/health",
      "/run",
      "/run",
    ]);
  });
  it("routes cancellation by the captured Profile, without checking health or broadcasting", async () => {
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.pathname).toBe("/cancel");
      expect(new Headers(init.headers).get("authorization")).toBe(
        url.hostname === "vacask.test"
          ? `Bearer ${env.VACASK_UPSTREAM_TOKEN}`
          : "Bearer ngspice-test-only",
      );
      return Response.json({ cancelled: true });
    });
    vi.stubGlobal("fetch", fetcher);
    for (const profileId of [ngspiceProfile.id, nativeEnvironment.profileId])
      await routeSimulationRequest(
        post({
          operation: "cancel",
          runToken: "11111111-1111-4111-8111-111111111111",
          environment: { profileId },
        }),
        env,
      );
    expect(fetcher.mock.calls.map(([url]) => url.hostname)).toEqual([
      "ngspice.test",
      "vacask.test",
    ]);
    expect(
      (await routeSimulationRequest(post({ operation: "cancel" }), env))!
        .status,
    ).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not route unknown Profiles or VACASK input to ngspice", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const profileId of ["unknown", ngspiceProfile.id])
      expect(
        (await routeSimulationRequest(
          post({ ...nativeInput(), environment: { profileId } }),
          env,
        ))!.status,
      ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("native outage does not rerun the input on ngspice", async () => {
    const fetcher = vi.fn(async (url: URL) => {
      expect(url.hostname).toBe("vacask.test");
      return new Response("offline", { status: 503 });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await routeSimulationRequest(post(nativeInput()), env))!.status,
    ).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not follow a native gateway redirect or forward its credential elsewhere", async () => {
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(init.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://unrelated.test/health" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await routeSimulationRequest(post(nativeInput()), env))!.status,
    ).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("signing in to simulate", () => {
  const signedIn = {
    AUTH: {
      getByName: () => ({
        fetch: async () => Response.json({ user: { id: "member" } }),
      }),
    },
  };
  const request = (
    body: unknown,
    headers: Record<string, string> = {},
    path = "/api/simulate",
  ) =>
    new Request(`https://canvas.test${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

  it("lets anyone discover the Profiles but asks a signed-out visitor to sign in before running", async () => {
    expect(
      await refuseSignedOutSimulation(
        request({ operation: "capabilities" }),
        {},
      ),
    ).toBeNull();
    const refused = await refuseSignedOutSimulation(request(nativeInput()), {});
    expect(refused?.status).toBe(401);
    expect(await refused!.json()).toEqual({
      error: "simulation-authentication-required",
      message: "Sign in to run simulations.",
    });
    expect(
      await refuseSignedOutSimulation(
        request(nativeInput(), {}, "/api/elsewhere"),
        {},
      ),
    ).toBeNull();
  });

  it("runs for a signed-in account or the deploy check's one-off credential, and nothing else", async () => {
    expect(
      await refuseSignedOutSimulation(
        request(nativeInput(), { cookie: "icm_session=abc" }),
        signedIn,
      ),
    ).toBeNull();
    const smoke = { SIMULATION_SMOKE_TOKEN: "this-deploy-only" };
    expect(
      await refuseSignedOutSimulation(
        request(nativeInput(), { authorization: "Bearer this-deploy-only" }),
        smoke,
      ),
    ).toBeNull();
    for (const [headers, deployment] of [
      [{ authorization: "Bearer an-earlier-deploy" }, smoke],
      [{ authorization: "Bearer " }, {}],
      [{ cookie: "icm_session=abc" }, {}],
    ] as const)
      expect(
        (
          await refuseSignedOutSimulation(
            request(nativeInput(), headers),
            deployment,
          )
        )?.status,
      ).toBe(401);
  });
});
