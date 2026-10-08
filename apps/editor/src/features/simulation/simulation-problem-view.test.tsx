import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SimulationProblemView } from "./simulation-problem-view";

describe("simulation problem view", () => {
  it("invites a signed-out person to sign in instead of reconnecting", () => {
    const markup = renderToStaticMarkup(
      <SimulationProblemView
        problem={{
          code: "simulation-authentication-required",
          message: "Sign in to run simulations.",
          stage: "read",
          recovery: "reauthorize",
        }}
      />,
    );
    expect(markup).toContain("Sign in to run simulations.");
    expect(markup).toContain('data-testid="simulation-sign-in"');
    expect(markup).not.toContain("Reconnect the simulation session");
  });
});
