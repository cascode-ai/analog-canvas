// Reviews of Gallery drawings: blind, per version, kept as history.

import { describe, expect, it } from "vitest";
import { routeGalleryRequest } from "./gallery";
import {
  ORIGIN,
  environment,
  makerOf,
  ownerAccountOf,
  projectText,
  route,
  signIn,
  submitOne,
  wiredProjectText,
} from "./gallery.test-support";

describe("reviews of Gallery drawings", () => {
  it("keeps each reviewer's verdict per version, blind until one's own is in, with the Owner's lists", async () => {
    const env = environment();
    const owner = await ownerAccountOf(env);
    const maker = await makerOf(env);
    const reader = await signIn(env.authDurable, "reader@example.com");
    const id = await submitOne(env, "Two-stage OTA", { cookie: maker });
    await route(
      env,
      new Request(`${ORIGIN}/api/gallery/sources/analoggenie/entries`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: owner },
        body: JSON.stringify({
          entries: [
            { id: "ag-308", name: "AG 308", projectText: projectText("ag") },
          ],
        }),
      }),
    );
    const call = (path: string, cookie: string, init: RequestInit = {}) =>
      route(
        env,
        new Request(`${ORIGIN}${path}`, {
          ...init,
          headers: { Origin: ORIGIN, Cookie: cookie },
        }),
      );
    const revisionOf = async (entry: string) =>
      (
        (await (
          await call(`/api/gallery/${entry}?summary=1`, reader)
        ).json()) as {
          entry: { previewRevision: string };
        }
      ).entry.previewRevision;
    const review = (entry: string, cookie: string, body: object) =>
      call(`/api/gallery/${entry}/reviews`, cookie, {
        method: "POST",
        body: JSON.stringify(body),
      });
    const revision = await revisionOf(id);

    // Its author does not review it; a verdict and its flags must agree;
    // only the current version takes a review.
    expect(
      await (await review(id, maker, { revision, verdict: "pass" })).json(),
    ).toEqual({ error: "own-entry" });
    for (const body of [
      { revision, verdict: "pass", flags: ["ugly"] },
      { revision, verdict: "issue", flags: [] },
      { revision, verdict: "issue", flags: ["blurry"] },
      // A box must name a side and stay inside its picture.
      {
        revision,
        verdict: "issue",
        flags: ["ugly"],
        marks: [{ side: "left", x: 0, y: 0, w: 0.5, h: 0.5 }],
      },
      {
        revision,
        verdict: "issue",
        flags: ["ugly"],
        marks: [{ side: "redraw", x: 0.8, y: 0, w: 0.5, h: 0.5 }],
      },
    ])
      expect((await review(id, reader, body)).status).toBe(400);
    expect(
      (await review(id, reader, { revision: "old", verdict: "pass" })).status,
    ).toBe(409);

    // Before reviewing, a reader sees nobody's verdict.
    expect(
      await (await call(`/api/gallery/${id}/reviews`, reader)).json(),
    ).toEqual({
      blind: true,
      revision,
    });
    expect(
      (await review(id, owner, { revision, verdict: "pass" })).status,
    ).toBe(200);
    const flagged = await review(id, reader, {
      revision,
      verdict: "issue",
      flags: ["loose", "ugly"],
      note: "Wide gaps between the stages.",
      marks: [{ side: "redraw", x: 0.1, y: 0.2, w: 0.30004, h: 0.2 }],
    });
    expect(flagged.status).toBe(200);
    const reviewId = ((await flagged.json()) as { review: { id: string } })
      .review.id;
    expect(
      await (await call(`/api/gallery/${id}/reviews`, reader)).json(),
    ).toMatchObject({
      blind: false,
      current: expect.arrayContaining([
        expect.objectContaining({ verdict: "pass", current: true }),
        expect.objectContaining({
          verdict: "issue",
          flags: ["loose", "ugly"],
          note: "Wide gaps between the stages.",
          marks: [{ side: "redraw", x: 0.1, y: 0.2, w: 0.3, h: 0.2 }],
        }),
      ]),
    });

    // A dataset's entry takes reviews though its store takes no other write.
    const datasetRevision = await revisionOf("ag-308");
    expect(
      (
        await review("ag-308", reader, {
          revision: datasetRevision,
          verdict: "pass",
        })
      ).status,
    ).toBe(200);
    // The queue lists what the reader may review: never their own entry,
    // a dataset's only with a comparison; the unreviewed first.
    expect(
      await (await call("/api/gallery/review/community/queue", maker)).json(),
    ).toEqual({ entries: [] });
    expect(
      await (await call("/api/gallery/review/community/queue", reader)).json(),
    ).toMatchObject({
      entries: [{ id, reviews: 2, mine: { verdict: "issue", current: true } }],
    });
    expect(
      await (
        await call("/api/gallery/review/analoggenie/queue", reader)
      ).json(),
    ).toEqual({ entries: [] });

    // The Owner lists the open issue and the dispute, and resolves it; the
    // row stays in the history.
    expect(
      (await call("/api/gallery/review/community/issues", reader)).status,
    ).toBe(403);
    expect(
      await (await call("/api/gallery/review/community/issues", owner)).json(),
    ).toMatchObject({ issues: [{ id: reviewId }], disputed: [id] });
    expect(
      (
        await call(`/api/gallery/${id}/reviews/${reviewId}`, owner, {
          method: "PATCH",
          body: JSON.stringify({ resolved: true }),
        })
      ).status,
    ).toBe(200);
    expect(
      await (await call("/api/gallery/review/community/issues", owner)).json(),
    ).toEqual({ issues: [], disputed: [] });

    // Its author fixes it: the new version is a fix of theirs, sized by
    // what changed, and the old reviews stay in the history, no longer
    // current.
    expect(
      (
        await call(`/api/gallery/${id}`, maker, {
          method: "PUT",
          body: JSON.stringify({
            name: "Two-stage OTA",
            projectText: wiredProjectText("Two-stage OTA"),
          }),
        })
      ).status,
    ).toBe(200);
    const next = await revisionOf(id);
    expect(next).not.toBe(revision);
    expect(
      await (await call(`/api/gallery/${id}/reviews`, reader)).json(),
    ).toEqual({ blind: true, revision: next });
    const after = (await (
      await call(`/api/gallery/${id}/reviews`, owner)
    ).json()) as { fixes: { devices: number; wires: number }[] };
    expect(after).toMatchObject({
      current: [],
      history: expect.arrayContaining([
        expect.objectContaining({ current: false, resolved: true }),
        expect.objectContaining({ current: false, verdict: "pass" }),
      ]),
      fixes: [{ fromRevision: revision, toRevision: next, addressed: 0 }],
    });
    expect(after.fixes[0]!.devices + after.fixes[0]!.wires).toBeGreaterThan(0);
    expect(
      await (await call("/api/gallery/review/community/people", reader)).json(),
    ).toMatchObject({
      people: expect.arrayContaining([
        expect.objectContaining({ reviews: 1, issues: 1, fixes: 0 }),
        expect.objectContaining({ reviews: 0, fixes: 1, circuits: 1 }),
      ]),
    });

    // A fix of a version with an open issue answers it.
    await review(id, reader, {
      revision: next,
      verdict: "issue",
      flags: ["wiring"],
    });
    await call(`/api/gallery/${id}`, maker, {
      method: "PUT",
      body: JSON.stringify({
        name: "Two-stage OTA",
        projectText: wiredProjectText("Two-stage OTA", 260),
      }),
    });
    expect(
      await (await call(`/api/gallery/${id}/reviews`, owner)).json(),
    ).toMatchObject({ fixes: [{ fromRevision: next, addressed: 1 }, {}] });

    // Signed out, every review route asks to sign in.
    expect(
      (
        await routeGalleryRequest(
          new Request(`${ORIGIN}/api/gallery/${id}/reviews`),
          env,
        )
      )?.status,
    ).toBe(401);
  });
});
