import { expect, test } from "@playwright/test";

test("imports SCS and local includes, downloads SPICE, and retains the circuit after unsupported input", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.getByTestId("spice-files").setInputFiles([
    {
      name: "circuit.scs",
      mimeType: "text/plain",
      buffer: Buffer.from(
        'simulator lang=spectre\ninclude "leaf.inc"\nsubckt top (z a)\nX1 (z a) leaf scale=2\nends top',
      ),
    },
    {
      name: "leaf.inc",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "subckt leaf (out in)\nparameters scale=1\nR1 (out in) resistor r=1k\nends leaf",
      ),
    },
  ]);
  await expect(page.getByTestId("status")).toContainText(
    "Imported 2 Documents",
  );
  const download = page.waitForEvent("download");
  await page.getByTestId("download-netlist").click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  expect(text).toContain(".subckt top z a");
  expect(text).toContain("X1 z a leaf scale=2");
  expect(text).toContain(".subckt leaf out in params: scale=1");
  expect(text).toContain("R1 out in 1000");
  await page.getByTestId("spice-files").setInputFiles({
    name: "broken.scs",
    mimeType: "text/plain",
    buffer: Buffer.from("// bad\nR1 (a 0) resistor r=1k tc1=1"),
  });
  await expect(page.getByTestId("status")).toContainText(
    "broken.scs:2: Unsupported parameters: tc1",
  );
  const again = page.waitForEvent("download");
  await page.getByTestId("download-netlist").click();
  expect((await again).suggestedFilename()).toMatch(/\.spi$/u);
});

test("serves the backend conversion protocol from the local development server", async ({
  request,
}) => {
  const result = await request.post("/api/netlist/convert", {
    data: { text: "R1 a 0 1Meg", source: "spice", target: "spectre" },
  });
  expect(result.status()).toBe(200);
  const body = await result.json();
  expect(body.text).toContain("resistor r=1000000");
  const back = await request.post("/api/netlist/convert", {
    data: { text: body.text, source: "spectre", target: "ngspice" },
  });
  expect((await back.json()).text).toContain("R1 a 0 1000000");
});
