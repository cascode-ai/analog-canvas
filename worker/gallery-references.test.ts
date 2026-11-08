// Reference images of community circuits, beside them in /review.

import { describe, expect, it } from "vitest";
import { routeGalleryRequest } from "./gallery";
import {
  ORIGIN,
  environment,
  makerOf,
  ownerAccountOf,
  route,
  signIn,
  submitOne,
} from "./gallery.test-support";

describe("reference images", () => {
  it("are put by the circuit's author or the Owner, with the right to share, and read by signed-in readers", async () => {
    const env = environment();
    const owner = await ownerAccountOf(env);
    const maker = await makerOf(env);
    const reader = await signIn(env.authDurable, "reader@example.com");
    const id = await submitOne(env, "Bandgap", { cookie: maker });
    const call = (cookie: string, init: RequestInit = {}, path = id) =>
      route(
        env,
        new Request(`${ORIGIN}/api/gallery/${path}/reference`, {
          ...init,
          headers: { Origin: ORIGIN, Cookie: cookie },
        }),
      );
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 1, 2]);
    const image = { type: "image/png", data: png.toString("base64") };
    const put = (cookie: string, body: object) =>
      call(cookie, { method: "PUT", body: JSON.stringify(body) });

    expect((await put(reader, { image, rights: true })).status).toBe(403);
    expect(await (await put(maker, { image })).json()).toEqual({
      error: "rights-required",
    });
    expect(
      await (
        await put(maker, {
          image: { type: "image/jpeg", data: image.data },
          rights: true,
        })
      ).json(),
    ).toEqual({ error: "invalid-image" });
    const saved = await put(maker, { image, rights: true });
    expect(saved.status).toBe(200);
    const { revision } = (await saved.json()) as { revision: string };

    // Any signed-in reader sees it, and the review queue names it.
    const read = await call(reader);
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await read.arrayBuffer())).toEqual(png);
    const queue = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/review/community/queue`, {
        headers: { Origin: ORIGIN, Cookie: reader },
      }),
    );
    expect(await queue.json()).toMatchObject({
      entries: [{ id, reference: { revision } }],
    });
    expect(
      (
        await routeGalleryRequest(
          new Request(`${ORIGIN}/api/gallery/${id}/reference`),
          env,
        )
      )?.status,
    ).toBe(200);
    // A dataset's entries take none.
    expect((await call(owner, {}, "ag-308")).status).toBe(404);

    // The Owner may remove it too.
    expect((await call(owner, { method: "DELETE" })).status).toBe(200);
    expect((await call(reader)).status).toBe(404);
  });
});
