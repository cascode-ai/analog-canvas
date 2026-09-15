import { expect, it } from "vitest";
import worker from "./index";
it("routes netlist conversion before any account, storage or simulator binding", async () => {
  const response = await worker.fetch(
    new Request("https://canvas.test/api/netlist/convert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "spectre",
        target: "spice",
        text: "R1 (a 0) resistor r=1k",
      }),
    }),
    {} as Parameters<typeof worker.fetch>[1],
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "converted",
    text: expect.stringContaining("R1 a 0 1000"),
  });
});
