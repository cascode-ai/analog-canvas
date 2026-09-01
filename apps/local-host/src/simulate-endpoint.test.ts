import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { startLocalHost } from "./index.js";
import { simulateLocally } from "./simulate.js";

/**
 * Exercises the endpoint the way the editor will: a real host process, a real
 * HTTP request, and — where the machine has ngspice — the real simulator
 * behind it.
 */
const ngspiceAvailable = await simulateLocally(
  { netlist: "V1 a 0 DC 1\nR1 a 0 1k", testbench: ".control\nop\n.endc" },
  {},
).then((outcome) => outcome.kind === "ran");

const withSimulator = ngspiceAvailable ? it : it.skip;

async function host(options: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), "icm-host-sim-"));
  await writeFile(
    join(root, "index.html"),
    "<!doctype html><title>ICM</title>",
  );
  return startLocalHost({ editorRoot: root, ...options });
}

async function simulate(origin: string, body: unknown): Promise<Response> {
  return fetch(`${origin}/api/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("local simulation endpoint", () => {
  it("keeps every other method refused", async () => {
    const running = await host();
    try {
      const response = await fetch(`${running.origin}/api/simulate`, {
        method: "PUT",
      });
      expect(response.status).toBe(405);
    } finally {
      await running.close();
    }
  });

  it("asks for the author's testbench rather than inventing one", async () => {
    const running = await host();
    try {
      const response = await simulate(running.origin, { netlist: "V1 a 0 1" });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe(
        "invalid-request",
      );
    } finally {
      await running.close();
    }
  });

  it("answers 501 about the machine when there is no simulator", async () => {
    const running = await host({ ngspicePath: "/nonexistent/ngspice" });
    try {
      const response = await simulate(running.origin, {
        netlist: "V1 a 0 DC 1\nR1 a 0 1k",
        testbench: ".control\nop\n.endc",
      });
      expect(response.status).toBe(501);
      const payload = (await response.json()) as {
        error: string;
        message: string;
      };
      expect(payload.error).toBe("simulator-unavailable");
      // The reader must be able to tell this from a circuit that failed.
      expect(payload.message).not.toMatch(/circuit|netlist|converge/iu);
    } finally {
      await running.close();
    }
  });

  withSimulator("returns the hosted result shape for a real run", async () => {
    const running = await host();
    try {
      const response = await simulate(running.origin, {
        netlist: "V1 in 0 DC 1\nR1 in out 1k\nR2 out 0 1k",
        testbench: ".control\nop\nprint v(out)\n.endc",
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as {
        outcome: { status: string };
        diagnostics: unknown[];
        log: string;
        durationMs: number;
      };
      expect(result.outcome.status).toBe("completed");
      expect(result.log).toContain("5.000000e-01");
      expect(Array.isArray(result.diagnostics)).toBe(true);
      expect(typeof result.durationMs).toBe("number");
    } finally {
      await running.close();
    }
  });

  withSimulator("reports a dropped device over HTTP too", async () => {
    const running = await host();
    try {
      const response = await simulate(running.origin, {
        netlist: "V1 in 0 DC 1\nR1 in out",
        testbench: ".control\nop\n.endc",
      });
      expect(
        ((await response.json()) as { outcome: { status: string } }).outcome
          .status,
      ).toBe("completed-with-dropped-input");
    } finally {
      await running.close();
    }
  });
});
