import { describe, expect, it } from "vitest";
import { handleNetlistConversionRequest } from "./conversion-request.js";
const url = "http://localhost/api/netlist/convert";
const request = (body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
describe("conversion HTTP protocol", () => {
  it("provides bidirectional conversion without storing or executing sources", async () => {
    const response = await handleNetlistConversionRequest(
      request({ text: "R1 a 0 1k", source: "spice", target: "spectre" }),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    const result = (await response!.json()) as { text: string };
    expect(result.text).toContain("R1 (a 0) resistor r=1000");
    const back = await handleNetlistConversionRequest(
      request({ text: result.text, source: "spectre", target: "spice" }),
    );
    expect(((await back!.json()) as { text: string }).text).toContain(
      "R1 a 0 1000",
    );
  });
  it("reports line-specific unsupported syntax without partial output", async () => {
    const response = await handleNetlistConversionRequest(
      request({
        text: "// input\nR1 (a 0) resistor r=1k tc1=1",
        source: "spectre",
        target: "spice",
      }),
    );
    expect(response?.status).toBe(422);
    const body = await response!.json();
    expect(body).toMatchObject({
      status: "blocked",
      issues: [{ line: 2, code: "UNSUPPORTED_PARAMETER" }],
    });
    expect(body).not.toHaveProperty("text");
  });
  it("bounds and validates the request envelope", async () => {
    expect(
      await handleNetlistConversionRequest(
        new Request("http://localhost/other"),
      ),
    ).toBeNull();
    expect(
      (await handleNetlistConversionRequest(new Request(url)))?.status,
    ).toBe(405);
    expect(
      (
        await handleNetlistConversionRequest(
          new Request(url, { method: "POST", body: "abc" }),
        )
      )?.status,
    ).toBe(415);
    for (const body of [
      null,
      {},
      { text: "a", source: "foo", target: "spice" },
      { text: "a", source: "spectre", target: "spice", fragment: "yes" },
    ])
      expect(
        (await handleNetlistConversionRequest(request(body)))?.status,
      ).toBe(400);
    expect(
      (
        await handleNetlistConversionRequest(
          request({
            text: "x".repeat(1024 * 1024),
            source: "spice",
            target: "spectre",
          }),
        )
      )?.status,
    ).toBe(413);
  });
});
