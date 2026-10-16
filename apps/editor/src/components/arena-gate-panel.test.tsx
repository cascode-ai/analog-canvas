import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ArenaGateView } from "./arena-gate-panel";
import type { ArenaGateState } from "./arena-gate";

/** The dialog's markup, read with a few small queries: no DOM is needed. */
function render(
  state: ArenaGateState,
  { required = 5, saved = true }: { required?: number; saved?: boolean } = {},
) {
  const markup = renderToStaticMarkup(
    <ArenaGateView
      state={state}
      required={required}
      saved={saved}
      onClose={() => {}}
    />,
  );
  const attribute = (tag: string, name: string) =>
    new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag)?.[1] ?? null;
  const dots = /data-testid="arena-gate-count">(.*?)<\/div>/u.exec(markup)?.[1];
  return {
    attribute,
    frame: /<iframe[^>]*>/u.exec(markup)?.[0] ?? "",
    title: /<h2[^>]*>(.*?)<\/h2>/u.exec(markup)?.[1],
    /** Each dot shown, filled or not; null without the progress row. */
    dots: dots
      ? [...dots.matchAll(/<span aria-hidden="true"([^>]*)>/gu)].map((dot) =>
          dot[1]!.includes("data-filled"),
        )
      : null,
    spoken: /aria-live="polite">([^<]*)</u.exec(markup)?.[1],
    /** Each link and button: its text and aria-disabled. */
    controls: [...markup.matchAll(/<(a|button)([^>]*)>([^<]*)<\/\1>/gu)].map(
      (control) => [control[3], attribute(control[2]!, "aria-disabled")],
    ),
    links: [...markup.matchAll(/<a[^>]*>/gu)].map((link) =>
      attribute(link[0], "href"),
    ),
    markup,
    text: markup.replace(/<[^>]*>/gu, " ").replaceAll("&#x27;", "'"),
  };
}

describe("the Arena gate's dialog (#1683)", () => {
  it("shows Chip Arena's animated Battle, taking no pointer or focus", () => {
    const { frame, attribute } = render({
      status: "voting",
      voted: 0,
      required: 5,
    });
    // Framed from chip-arena.com itself: Arena's code never runs on Analog
    // Canvas's origin.
    expect(attribute(frame, "src")).toBe(
      "https://chip-arena.com/schematic/preview",
    );
    // It takes no pointer: its styles say so.
    expect(
      readFileSync(new URL("./arena-gate.css", import.meta.url), "utf8"),
    ).toMatch(/\.arena-gate-preview iframe \{[^}]*pointer-events: none;/u);
    expect(attribute(frame, "tabindex")).toBe("-1");
    expect(attribute(frame, "aria-hidden")).toBe("true");
    expect(attribute(frame, "title")).toBe("A Battle in the Schematic Arena");
    expect(attribute(frame, "sandbox")).toBe("allow-scripts allow-same-origin");
    expect(attribute(frame, "referrerPolicy")).toBe("no-referrer");
  });

  it("holds the title, a dot per Vote asked for with the new ones filled, Start voting and Not now (#1718)", () => {
    const dialog = render({ status: "voting", voted: 2, required: 5 });
    expect(dialog.title).toBe("Vote on 5 Battles in the Schematic Arena");
    expect(dialog.dots).toEqual([true, true, false, false, false]);
    // Readers hear the count the dots show.
    expect(dialog.spoken).toBe("Voted 2 of 5");
    // Not now closes it at once: nothing is locked.
    expect(dialog.controls).toEqual([
      ["Start voting →", null],
      ["Not now", null],
    ]);
    expect(dialog.links).toEqual(["/schematic?from=canvas-gate"]);
    // At most one short line; the old sentence is gone.
    expect(dialog.text).toContain("Your work is saved.");
    expect(dialog.text).not.toMatch(/Close unlocks|to go|Your work is safe/u);
  });

  it("asks for fewer Votes when fewer Battles are left, and says nothing of a save on a shelf opening", () => {
    const dialog = render(
      { status: "voting", voted: 0, required: 1 },
      { required: 1, saved: false },
    );
    expect(dialog.title).toBe("Vote on 1 Battle in the Schematic Arena");
    expect(dialog.dots).toEqual([false]);
    expect(dialog.text).not.toContain("Your work is saved.");
  });

  it("offers Close and no Start voting at the last Vote", () => {
    const dialog = render({ status: "voting", voted: 5, required: 5 });
    expect(dialog.dots).toEqual([true, true, true, true, true]);
    expect(dialog.controls).toEqual([["Close", null]]);
  });

  it("says why only when it stops asking before the Votes are in", () => {
    const dialog = render({ status: "free", reason: "unavailable" });
    expect(dialog.text).toContain("Arena can't be reached right now.");
    expect(dialog.dots).toBeNull();
    expect(dialog.controls).toEqual([["Close", null]]);
  });

  it("keeps its title, dots and buttons out of the frame, so a frame that fails changes nothing", () => {
    // A frame that cannot load fires no error the dialog could miss: the
    // browser shows its own page in the frame's space. Nothing the person
    // needs is in there.
    const { markup } = render({ status: "voting", voted: 1, required: 5 });
    const preview = /<div class="arena-gate-preview"[^>]*>(.*?)<\/div>/u.exec(
      markup,
    )![1]!;
    expect(preview).toMatch(/^<iframe[^>]*><\/iframe>$/u);
    const outside = markup.replace(preview, "");
    for (const part of [
      "Vote on 5 Battles in the Schematic Arena",
      'data-testid="arena-gate-count"',
      "Start voting →",
      ">Not now<",
    ])
      expect(outside).toContain(part);
  });

  it("announces the reason in the region that was there all along", () => {
    const voting = render({ status: "voting", voted: 1, required: 5 });
    const free = render({ status: "free", reason: "no-battle" });
    const note = (markup: string) =>
      /<p class="arena-gate-note" aria-live="polite">([^<]*)<\/p>/u.exec(
        markup,
      )?.[1];
    expect(note(voting.markup)).toBe("Your work is saved.");
    expect(note(free.markup)).toBe(
      "Arena has no more Battles for you right now.",
    );
  });
});
