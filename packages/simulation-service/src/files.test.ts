import { describe, it, expect } from "vitest";
import { SimulationFiles, sha256 } from "./files.js";
describe("simulation File Resource evidence", () => {
  it("cannot publish an in-flight artifact into a cleared session", async () => {
    const files = new SimulationFiles();
    const pending = files.put("old", "text/plain", "old content");
    files.clear();
    await expect(pending).rejects.toThrow("SESSION_CHANGED");
    const fresh = await files.put("new", "text/plain", "new");
    expect(
      await files.handle({ action: "artifact", artifactId: fresh.id }),
    ).toMatchObject({ ok: true, text: "new" });
  });
  it("pages immutable evidence without changing its full-file digest", async () => {
    const files = new SimulationFiles();
    const text = "数值🚀".repeat(40000),
      artifact = await files.put("raw.txt", "text/plain", text);
    let offset = 0,
      joined = "";
    for (;;) {
      const chunk = await files.handle({
        action: "artifact",
        artifactId: artifact.id,
        offset,
      });
      if (!chunk.ok || !("text" in chunk)) throw Error(JSON.stringify(chunk));
      expect(chunk.text.length).toBeLessThanOrEqual(65536);
      expect(chunk.artifact.sha256).toBe(artifact.sha256);
      joined += chunk.text;
      if (chunk.nextOffset === null) break;
      offset = chunk.nextOffset;
    }
    expect(joined).toBe(text);
    expect(await sha256(joined)).toBe(artifact.sha256);
  });
  it("expiration reports unavailability rather than serving another artifact", async () => {
    let now = 0;
    const files = new SimulationFiles(() => now);
    const a = await files.put("x", "text/plain", "x");
    now = 16 * 60000;
    expect(
      await files.handle({ action: "artifact", artifactId: a.id }),
    ).toMatchObject({ ok: false, error: { code: "ARTIFACT_UNAVAILABLE" } });
  });
});
