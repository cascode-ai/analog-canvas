import { describe, expect, it } from "vitest";

import { stagingAccessGate } from "./staging-gate";

const req = (url = "https://staging.test/editor", headers?: HeadersInit) =>
  new Request(url, headers ? { headers } : undefined);

describe("staging access gate", () => {
  it("is absent from production", () => {
    // Production leaves ICM_ENVIRONMENT unset. If this ever returned a
    // refusal there, the gate would take the live site down.
    expect(stagingAccessGate(req(), {})).toBeNull();
    expect(
      stagingAccessGate(req(), { STAGING_ACCESS_KEY: "secret" }),
    ).toBeNull();
  });

  it("serves nobody when no key is configured", () => {
    // Fail closed. A staging deployment whose secret has not been provisioned
    // yet must not be browsable: an unlisted URL is not privacy, and the
    // failure mode of missing configuration must never be "everybody gets in".
    const response = stagingAccessGate(req(), { ICM_ENVIRONMENT: "staging" });
    expect(response?.status).toBe(401);
    expect(response?.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("refuses a caller with no key, and does not hint at one", () => {
    const response = stagingAccessGate(req(), {
      ICM_ENVIRONMENT: "staging",
      STAGING_ACCESS_KEY: "secret",
    });
    expect(response?.status).toBe(401);
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("admits a header or a cookie", () => {
    const env = { ICM_ENVIRONMENT: "staging", STAGING_ACCESS_KEY: "secret" };
    expect(
      stagingAccessGate(
        req(undefined, { "x-staging-access-key": "secret" }),
        env,
      ),
    ).toBeNull();
    expect(
      stagingAccessGate(
        req(undefined, { cookie: "other=1; icm_staging_access=secret" }),
        env,
      ),
    ).toBeNull();
  });

  it("rejects a wrong key by every route in", () => {
    const env = { ICM_ENVIRONMENT: "staging", STAGING_ACCESS_KEY: "secret" };
    expect(
      stagingAccessGate(
        req(undefined, { "x-staging-access-key": "wrong" }),
        env,
      )?.status,
    ).toBe(401);
    expect(
      stagingAccessGate(
        req(undefined, { cookie: "icm_staging_access=wrong" }),
        env,
      )?.status,
    ).toBe(401);
    expect(
      stagingAccessGate(req("https://staging.test/editor?key=wrong"), env)
        ?.status,
    ).toBe(401);
  });

  it("takes the secret out of the address bar after admitting it", () => {
    // A link with the key in it gets pasted, shared, and kept in history.
    // Trading it for a cookie once keeps the secret out of all three.
    const response = stagingAccessGate(
      req("https://staging.test/editor?key=secret&doc=7"),
      { ICM_ENVIRONMENT: "staging", STAGING_ACCESS_KEY: "secret" },
    );
    expect(response?.status).toBe(302);
    const location = response?.headers.get("location") ?? "";
    expect(location).not.toContain("key=secret");
    expect(location).toContain("doc=7");
    expect(response?.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response?.headers.get("set-cookie")).toContain("Secure");
  });
});
