import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createLaunchFileQueue } from "./launch-files";

describe("OS project open requests", () => {
  it("queues explicit project files in order, deduplicates paths, and refuses unrelated arguments", () => {
    const queue = createLaunchFileQueue();
    const first = resolve("drawings", "放大器.icproj");
    const second = resolve("drawings", "old.icproj.json");
    expect(queue.enqueue([first])).toBe(false);
    expect(queue.enqueue(["--open-project", "relative.icproj"])).toBe(false);
    expect(queue.enqueue(["--open-project", resolve("settings.json")])).toBe(
      false,
    );
    expect(queue.enqueue(["--open-project", first])).toBe(true);
    expect(queue.enqueue(["--open-project", first])).toBe(true);
    expect(queue.enqueue(["--open-project", second])).toBe(true);
    expect(queue.take()).toBe(first);
    expect(queue.take()).toBe(second);
    expect(queue.take()).toBe(null);
    expect(
      queue.enqueue([
        "app.exe",
        "--open-project",
        "--disable-background-networking",
        first,
      ]),
    ).toBe(true);
    expect(queue.take()).toBe(first);
  });
});
