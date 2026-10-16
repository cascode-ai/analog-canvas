import { describe, expect, it } from "vitest";

import { DOWNLOAD_LINK_LIFETIME_MS, downloadBlob } from "./download-link";

/** A page that records what happens to the link and its bytes. */
function page({ failClick = false } = {}) {
  const events: string[] = [];
  const timers: { ms: number; run: () => void }[] = [];
  const anchor = {
    href: "",
    download: "",
    click: () => {
      events.push(`click ${anchor.download} ${anchor.href}`);
      if (failClick) throw new Error("Download blocked");
    },
    remove: () => events.push("removed"),
  };
  return {
    events,
    timers,
    environment: {
      createElement: () => anchor,
      append: () => events.push("appended"),
      createObjectURL: () => "blob:export",
      revokeObjectURL: (url: string) => events.push(`revoked ${url}`),
      setTimeout: (run: () => void, ms: number) => timers.push({ ms, run }),
    },
  };
}

describe("handing the browser a file to save (2026-10-14)", () => {
  it("clicks a link in the page and keeps the bytes for a minute", () => {
    const { events, timers, environment } = page();
    downloadBlob(new Blob(["<svg/>"]), "circuit.svg", environment);
    expect(events).toEqual([
      "appended",
      "click circuit.svg blob:export",
      "removed",
    ]);
    // Released only later: Safari and Firefox read the link after the click,
    // and only after the person picks a folder when they are set to ask.
    expect(timers.map((timer) => timer.ms)).toEqual([60_000]);
    expect(DOWNLOAD_LINK_LIFETIME_MS).toBe(60_000);
    timers[0]!.run();
    expect(events.at(-1)).toBe("revoked blob:export");
  });

  it("still takes the link out and releases the bytes when the click fails", () => {
    const { events, timers, environment } = page({ failClick: true });
    expect(() => downloadBlob(new Blob(["x"]), "x.pdf", environment)).toThrow(
      "Download blocked",
    );
    expect(events).toContain("removed");
    expect(timers).toHaveLength(1);
  });
});
