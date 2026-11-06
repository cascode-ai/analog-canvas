import { describe, it, expect } from "vitest";
import {
  mkdtemp,
  readFile,
  writeFile,
  open,
  unlink,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPowerPointSession } from "./powerpoint-session";

describe("PowerPoint file exchange", () => {
  it("cancels an unacknowledged save durably without removing its recovery revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "circuit-cancel-"));
    await writeFile(
      join(directory, "session.json"),
      JSON.stringify({ token: "test", cancellationProtocol: 1 }),
    );
    await writeFile(
      join(directory, "drawing.icproj"),
      JSON.stringify({ id: "circuit" }),
    );
    const session = createPowerPointSession(directory);
    const handle = session.handle;
    const save = () =>
      handle(
        new Request("app://analog-canvas/desktop/powerpoint", {
          method: "POST",
          body: JSON.stringify({
            token: "test",
            project: '{"id":"circuit","documents":[{"id":"main"}]}',
            documentId: "main",
            svg: "<svg/>",
          }),
        }),
      );
    expect((await save()).status).toBe(200);
    expect(await session.cancel()).toEqual({ status: "cancelled" });
    expect(
      JSON.parse(await readFile(join(directory, "cancel.json"), "utf8")),
    ).toEqual({ token: "test", throughSequence: 1 });
    expect(
      JSON.parse(await readFile(join(directory, "revision-1.json"), "utf8")),
    ).toHaveProperty("sequence", 1);
    expect((await save()).status).toBe(410);
  });
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
    const handle = createPowerPointSession(directory).handle;
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
    const restarted = createPowerPointSession(directory).handle;
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
        await createPowerPointSession(undefined).handle(
          new Request("app://analog-canvas/desktop/powerpoint"),
        )
      ).json(),
    ).toEqual({ enabled: false });
  });
  it("does not confirm cancellation while the receiver owns the apply gate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "circuit-cancel-race-"));
    await writeFile(
      join(directory, "session.json"),
      JSON.stringify({ token: "test", cancellationProtocol: 1 }),
    );
    await writeFile(join(directory, "drawing.icproj"), '{"id":"circuit"}');
    const session = createPowerPointSession(directory);
    const lock = await open(join(directory, "exchange.lock"), "wx");
    try {
      expect(await session.cancel()).toMatchObject({ status: "failed" });
      await expect(
        readFile(join(directory, "cancel.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await lock.close();
      await unlink(join(directory, "exchange.lock"));
    }
    expect(await session.cancel()).toEqual({ status: "cancelled" });
    const restarted = createPowerPointSession(directory);
    expect(
      (
        await restarted.handle(
          new Request("app://analog-canvas/desktop/powerpoint", {
            method: "POST",
            body: JSON.stringify({
              token: "test",
              project: '{"id":"circuit","documents":[{"id":"main"}]}',
              documentId: "main",
              svg: "<svg/>",
            }),
          }),
        )
      ).status,
    ).toBe(410);
  });
  it("fails closed for an old add-in and for an unwritable cancellation receipt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "circuit-cancel-errors-"));
    await writeFile(join(directory, "drawing.icproj"), '{"id":"circuit"}');
    await writeFile(join(directory, "session.json"), '{"token":"test"}');
    expect(await createPowerPointSession(directory).cancel()).toMatchObject({
      status: "failed",
    });
    await writeFile(
      join(directory, "session.json"),
      '{"token":"test","cancellationProtocol":1}',
    );
    await mkdir(join(directory, "cancel.json"));
    expect(await createPowerPointSession(directory).cancel()).toMatchObject({
      status: "failed",
    });
  });
  it("reports an already applied save instead of pretending to undo it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "circuit-cancel-applied-"));
    await writeFile(
      join(directory, "session.json"),
      '{"token":"test","cancellationProtocol":1}',
    );
    await writeFile(join(directory, "drawing.icproj"), '{"id":"circuit"}');
    await writeFile(join(directory, "result.json"), '{"sequence":1}');
    await writeFile(join(directory, "ack.json"), '{"sequence":1,"ok":true}');
    expect(await createPowerPointSession(directory).cancel()).toEqual({
      status: "already-applied",
    });
    expect(
      JSON.parse(await readFile(join(directory, "cancel.json"), "utf8")),
    ).toEqual({ token: "test", throughSequence: 1 });
  });
});
