import { expect, test } from "@playwright/test";

test("Project evidence lifetime protects across tabs and releases on page close", async ({
  page,
  context,
}) => {
  await page.goto("/editor");
  const peer = await context.newPage();
  await peer.goto("/editor");
  await page.evaluate(async () => {
    const path = "/src/features/simulation/browser-simulation-storage-lock.ts";
    const { ProjectEvidenceLease } = await import(path);
    const lease = new ProjectEvidenceLease("storage-lifetime-proof");
    (window as any).evidenceLease = lease;
    await lease.acquire();
    await lease.acquire(); // one consumer must not accidentally retain twice
  });
  const attempt = () =>
    peer.evaluate(async () => {
      const path =
        "/src/features/simulation/browser-simulation-storage-lock.ts";
      const { withExclusiveEvidence } = await import(path);
      return withExclusiveEvidence(
        "storage-lifetime-proof",
        async () => "reclaimed",
      );
    });
  expect(await attempt()).toEqual({ available: false });
  expect(
    await peer.evaluate(async () => {
      const path =
        "/src/features/simulation/browser-simulation-storage-lock.ts";
      const { withExclusiveEvidence } = await import(path);
      return withExclusiveEvidence("different-project", async () => "isolated");
    }),
  ).toEqual({ available: true, value: "isolated" });
  await page.evaluate(() => (window as any).evidenceLease.release());
  await expect.poll(attempt).toEqual({ available: true, value: "reclaimed" });
  await page.evaluate(async () => {
    await (window as any).evidenceLease.acquire();
  });
  expect(await attempt()).toEqual({ available: false });
  await page.close();
  await expect.poll(attempt).toEqual({ available: true, value: "reclaimed" });
});
