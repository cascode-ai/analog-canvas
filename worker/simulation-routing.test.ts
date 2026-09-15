import { afterEach, describe, expect, it, vi } from "vitest";
import { routeSimulationRequest, type SimulationEnv } from "./simulation";
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
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer vacask-test-only",
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
  });
  it("routes cancellation by the captured Profile, without checking health or broadcasting", async () => {
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.pathname).toBe("/cancel");
      expect(new Headers(init.headers).get("authorization")).toBe(
        url.hostname === "vacask.test"
          ? "Bearer vacask-test-only"
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
});
