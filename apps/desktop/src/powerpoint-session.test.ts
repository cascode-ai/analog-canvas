import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPowerPointSession } from "./powerpoint-session";

describe("PowerPoint file exchange", () => {
  it("keeps saves together, rejects another session, and returns the PPT acknowledgement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "circuit-canvas-"));
    await writeFile(
      join(directory, "session.json"),
      JSON.stringify({ token: "test-session" }),
    );
    await writeFile(
      join(directory, "drawing.icproj"),
      JSON.stringify({ id: "circuit" }),
    );
    const handle = createPowerPointSession(directory);
    const initial =
      '{"id":"circuit","documents":[{"id":"main"},{"id":"child"}]}';
    const post = (token: string, project = initial) =>
      new Request("app://analog-canvas/desktop/powerpoint", {
        method: "POST",
        body: JSON.stringify({
          token,
          project,
          documentId: "child",
          svg: '<svg xmlns="http://www.w3.org/2000/svg" />',
        }),
      });
    expect((await handle(post("wrong"))).status).toBe(403);
    expect((await handle(post("test-session", "not json"))).status).toBe(400);
    expect(await (await handle(post("test-session"))).json()).toEqual({
      sequence: 1,
    });
    const saved = JSON.parse(
      await readFile(join(directory, "result.json"), "utf8"),
    );
    expect(saved.project).toBe(initial);
    expect(saved.documentId).toBe("child");
    expect(saved.sequence).toBe(1);
    await writeFile(
      join(directory, "ack.json"),
      JSON.stringify({ sequence: 1, ok: true }),
    );
    expect(
      (
        await (
          await handle(new Request("app://analog-canvas/desktop/powerpoint"))
        ).json()
      ).ack.ok,
    ).toBe(true);
    expect(
      (
        await handle(
          post("test-session", '{"id":"other","documents":[{"id":"child"}]}'),
        )
      ).status,
    ).toBe(400);
    const restarted = createPowerPointSession(directory);
    expect(await (await restarted(post("test-session"))).json()).toEqual({
      sequence: 2,
    });
    expect(
      JSON.parse(await readFile(join(directory, "revision-1.json"), "utf8"))
        .project,
    ).toBe(saved.project);
  });
  it("leaves standalone launches without a PowerPoint destination", async () => {
    expect(
      await (
        await createPowerPointSession(undefined)(
          new Request("app://analog-canvas/desktop/powerpoint"),
        )
      ).json(),
    ).toEqual({ enabled: false });
  });
});
