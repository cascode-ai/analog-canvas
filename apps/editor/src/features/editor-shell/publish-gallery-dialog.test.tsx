import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  PublishGalleryDialog,
  type PublishGalleryDialogProps,
} from "./publish-gallery-dialog";

describe("PublishGalleryDialog", () => {
  it("asks a signed-out visitor to sign in instead of for a passphrase", () => {
    const markup = renderToStaticMarkup(
      createElement(PublishGalleryDialog, {
        defaultName: "Ring Oscillator",
        publish: () => Promise.resolve({ status: "unauthorized" as const }),
        onPublished: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(markup).toContain('data-testid="publish-gallery-dialog"');
    expect(markup).toContain('data-testid="publish-signin"');
    expect(markup).toContain('href="/api/auth/github/start"');
    // The passphrase is gone entirely — no field, no copy, no password input.
    expect(markup).not.toContain("passphrase");
    expect(markup).not.toContain('type="password"');
    // With no account there is nothing to fill in and nothing to submit.
    expect(markup).not.toContain('class="publish-gallery-fields"');
    expect(markup).not.toContain('class="publish-gallery-primary"');
  });

  it("publishes an ordinary member's circuit straight away", () => {
    const markup = renderToStaticMarkup(
      createElement(PublishGalleryDialog, {
        defaultName: "Ring Oscillator",
        session: { displayName: "Visitor", isAdmin: false, role: "user" },
        gateReport: { ok: true, failures: [] },
        topologyProject: createEmptyProject("current", "Current Cell"),
        publish: () => Promise.resolve({ status: "unauthorized" as const }),
        onPublished: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(markup).toContain('value="Ring Oscillator"');
    expect(markup).toContain('class="publish-gallery-fields"');
    expect(markup).toContain('class="publish-gallery-primary"');
    expect(markup).toContain("Publishing as Visitor");
    expect(markup).toContain("goes up straight away");
    expect(markup).toContain('data-testid="gallery-topology-check"');
    expect(markup).toContain(">Check Duplicate</button>");
    expect(markup).not.toContain("Check current topology");
    expect(markup.indexOf("Check Duplicate")).toBeLessThan(
      markup.indexOf(">Publish</button>"),
    );
    // No queue to wait in, and no passphrase to guess.
    expect(markup).not.toContain("review");
    expect(markup).not.toContain("passphrase");
    expect(markup).not.toMatch(/disabled=""[^>]*>Publish</u);
  });

  it("reopens on the draft it was closed with", () => {
    // Closing the dialog unmounts it, so a mistaken dismissal used to throw
    // away everything typed. The draft is held outside and handed back.
    const markup = renderToStaticMarkup(
      createElement(PublishGalleryDialog, {
        defaultName: "Ring Oscillator",
        session: { displayName: "Visitor", isAdmin: false, role: "user" },
        gateReport: { ok: true, failures: [] },
        draft: {
          name: "Ring Oscillator v2",
          description: "Five stages, skewed for duty cycle.",
          tags: ["oscillator", "cmos"],
        },
        publish: () => Promise.resolve({ status: "unauthorized" as const }),
        onPublished: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(markup).toContain('value="Ring Oscillator v2"');
    expect(markup).toContain("Five stages, skewed for duty cycle.");
    expect(markup).toContain("oscillator");
    expect(markup).toContain("cmos");
  });

  it("keeps a pasted description whole and says when it is too long", () => {
    // A textarea maxLength clipped a pasted citation without a word, and the
    // clipped text was published. The limit is shown instead.
    const render = (description: string) =>
      renderToStaticMarkup(
        createElement(PublishGalleryDialog, {
          defaultName: "Ring Oscillator",
          session: { displayName: "Visitor", isAdmin: false, role: "user" },
          gateReport: { ok: true, failures: [] },
          draft: { name: "Ring Oscillator", description, tags: [] },
          publish: () => Promise.resolve({ status: "unauthorized" as const }),
          onPublished: () => undefined,
          onClose: () => undefined,
        }),
      );
    const fits = render("x".repeat(1000));
    expect(fits).not.toMatch(/<textarea[^>]*maxLength/iu);
    expect(fits).toContain("1000 / 1000");
    expect(fits).toMatch(/class="publish-gallery-primary"(?![^>]*disabled)/u);
    const over = render("x".repeat(1200));
    expect(over).toContain("x".repeat(1200));
    expect(over).toContain("1200 / 1000 characters · shorten to publish");
    expect(over).toContain('data-over="true"');
    expect(over).toMatch(
      /<button[^>]*disabled=""[^>]*class="publish-gallery-primary"|class="publish-gallery-primary"[^>]*disabled=""/u,
    );
  });

  it("opens on the title alone and folds the tag suggestions", () => {
    const markup = renderToStaticMarkup(
      createElement(PublishGalleryDialog, {
        defaultName: "Ring Oscillator",
        session: { displayName: "Visitor", isAdmin: false, role: "user" },
        publish: () => Promise.resolve({ status: "unauthorized" as const }),
        onPublished: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(markup).toContain(">Publish to Gallery</h2>");
    expect(markup).not.toContain("public wall");
    // Five suggestions, then one chip that opens the rest (#1385).
    expect(markup.match(/data-testid="publish-preset-/gu)).toHaveLength(5);
    expect(markup).toContain('data-testid="publish-presets-more"');
    expect(markup).toContain('aria-label="More tag suggestions"');
  });

  it("starts the AI mark from the entry it came from, never from an Agent's work", () => {
    const render = (props: Partial<PublishGalleryDialogProps>) =>
      renderToStaticMarkup(
        createElement(PublishGalleryDialog, {
          defaultName: "Ring Oscillator",
          session: { displayName: "Visitor", isAdmin: false, role: "user" },
          publish: () => Promise.resolve({ status: "unauthorized" as const }),
          onPublished: () => undefined,
          onClose: () => undefined,
          ...props,
        }),
      );
    const aiBox = (props: Partial<PublishGalleryDialogProps>) =>
      /<input[^>]*data-testid="publish-ai"[^>]*>/u.exec(render(props))?.[0];
    expect(aiBox({})).not.toContain("checked");
    // Publishing by hand leaves the mark to the person; the note tells them.
    expect(aiBox({ agentEdited: true })).not.toContain("checked");
    expect(render({ agentEdited: true })).toContain(
      "An Agent worked on this Project",
    );

    // An update keeps the entry's own mark, so an author's untick stands;
    // the note still says an Agent worked on it.
    const update = {
      updateTarget: { id: "e1", name: "Ring Oscillator" },
      publishUpdate: () => Promise.resolve({ status: "unauthorized" as const }),
    };
    const unmarked = { description: "", tags: [], aiGenerated: false };
    expect(
      aiBox({ ...update, agentEdited: true, updateDefaults: unmarked }),
    ).not.toContain("checked");
    expect(
      render({ ...update, agentEdited: true, updateDefaults: unmarked }),
    ).toContain("An Agent worked on this Project");
    const marked = { description: "", tags: [], aiGenerated: true };
    expect(aiBox({ ...update, updateDefaults: marked })).toContain(
      'checked=""',
    );
    // A new entry made from a marked one starts marked too.
    expect(aiBox({ updateDefaults: marked })).toContain('checked=""');

    // The publisher's own choice, kept in the draft, wins.
    expect(
      aiBox({
        agentEdited: true,
        draft: {
          name: "Ring Oscillator",
          description: "",
          tags: [],
          aiGenerated: false,
          editedFields: {
            name: false,
            description: false,
            tags: false,
            aiGenerated: true,
          },
        },
      }),
    ).not.toContain("checked");
  });

  it("says what today's allowance leaves before anything is typed (#1417)", () => {
    const render = (props: Partial<PublishGalleryDialogProps>) =>
      renderToStaticMarkup(
        createElement(PublishGalleryDialog, {
          defaultName: "Ring Oscillator",
          session: { displayName: "Visitor", isAdmin: false, role: "user" },
          publish: () => Promise.resolve({ status: "unauthorized" as const }),
          onPublished: () => undefined,
          onClose: () => undefined,
          ...props,
        }),
      );
    const quota = (remaining: number, exempt = false) => ({
      limit: 100,
      used: 100 - remaining,
      remaining,
      resetsAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
      exempt,
    });
    const publishDisabled = (html: string) =>
      /<button[^>]*disabled=""[^>]*class="publish-gallery-primary"|class="publish-gallery-primary"[^>]*disabled=""/u.test(
        html,
      );

    const left = render({ quota: quota(12) });
    expect(left).toContain("12 of 100 new entries left today");
    expect(left).toContain("resets at 00:00 UTC (in 3 h");
    expect(publishDisabled(left)).toBe(false);

    const spent = render({ quota: quota(0) });
    expect(spent).toContain("Today&#x27;s 100 new entries are published");
    expect(publishDisabled(spent)).toBe(true);

    // An update spends nothing, and curators have no allowance to show.
    const update = render({
      quota: quota(0),
      updateTarget: { id: "e1", name: "Ring Oscillator" },
      publishUpdate: () => Promise.resolve({ status: "unauthorized" as const }),
    });
    expect(update).not.toContain('data-testid="publish-quota"');
    expect(publishDisabled(update)).toBe(false);
    expect(render({ quota: quota(0, true) })).not.toContain(
      'data-testid="publish-quota"',
    );
  });

  it("never asks for the byline: the account supplies it", () => {
    const markup = renderToStaticMarkup(
      createElement(PublishGalleryDialog, {
        defaultName: "Ring Oscillator",
        session: { displayName: "Token Zhang", isAdmin: true },
        publish: () => Promise.resolve({ status: "unauthorized" as const }),
        onPublished: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(markup).not.toContain('aria-label="Author"');
    expect(markup).not.toContain("Shown on your tile");
    expect(markup).toContain("Publishing as Token Zhang");
  });

  it("keeps Publish open for an ordinary member and lists gate findings", () => {
    const markup = renderToStaticMarkup(
      createElement(PublishGalleryDialog, {
        defaultName: "Ring Oscillator",
        session: { displayName: "Visitor", isAdmin: false, role: "user" },
        gateReport: {
          ok: false,
          failures: [
            {
              code: "floating-endpoints",
              message:
                "Floating endpoints: wire each pin, name its net, or mark it NoConnect",
              count: 2,
              examples: ["M1.g", "R2.2"],
            },
          ],
        },
        publish: () => Promise.resolve({ status: "unauthorized" as const }),
        onPublished: () => undefined,
        onClose: () => undefined,
      }),
    );
    // Advisory, never a hard gate: the checker has false positives and a
    // sketch is legitimate to share.
    expect(markup).not.toContain("publish-gallery-gates-blocking");
    expect(markup).toContain("publishing stays open");
    expect(markup).toContain("M1.g, R2.2");
    expect(markup).not.toMatch(/disabled=""[^>]*>Publish</u);
  });
});
