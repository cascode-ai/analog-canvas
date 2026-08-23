import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublishGalleryDialog } from "./publish-gallery-dialog";

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
    // No queue to wait in, and no passphrase to guess.
    expect(markup).not.toContain("review");
    expect(markup).not.toContain("passphrase");
    expect(markup).not.toMatch(/disabled=""[^>]*>Publish</u);
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

  it("blocks an ordinary member on gate failures and lists them", () => {
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
    expect(markup).toContain("publish-gallery-gates-blocking");
    expect(markup).toContain("Fix these before publishing:");
    expect(markup).toContain("M1.g, R2.2");
    expect(markup).toMatch(/disabled=""[^>]*>Publish</u);
  });

  it("shows the same failures as informational for a moderator", () => {
    const markup = renderToStaticMarkup(
      createElement(PublishGalleryDialog, {
        defaultName: "Ring Oscillator",
        session: { displayName: "Rev", isAdmin: false, role: "moderator" },
        gateReport: {
          ok: false,
          failures: [
            {
              code: "empty-project",
              message: "Too little content",
              count: 1,
              examples: [],
            },
          ],
        },
        publish: () => Promise.resolve({ status: "unauthorized" as const }),
        onPublished: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(markup).not.toContain("publish-gallery-gates-blocking");
    expect(markup).toContain("informational for your role");
    expect(markup).not.toMatch(/disabled=""[^>]*>Publish</u);
  });
});
