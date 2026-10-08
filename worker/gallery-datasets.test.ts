// Reference datasets in stores of their own (#1510).

import { describe, expect, it } from "vitest";
import {
  ORIGIN,
  environment,
  makerOf,
  ownerAccountOf,
  projectText,
  route,
  submitOne,
} from "./gallery.test-support";

describe("reference datasets in stores of their own (#1510)", () => {
  it("lets the Owner import a dataset's circuits, which open only under their source and stay read-only", async () => {
    const env = environment();
    const owner = await ownerAccountOf(env);
    const maker = await makerOf(env);
    await submitOne(env, "Community circuit", { cookie: maker });
    const call = (path: string, init: RequestInit = {}, cookie = owner) =>
      route(
        env,
        new Request(`${ORIGIN}${path}`, {
          ...init,
          headers: {
            Origin: ORIGIN,
            Cookie: cookie,
            "content-type": "application/json",
          },
        }),
      );
    const importing = (cookie: string, entries: unknown[]) =>
      call(
        "/api/gallery/sources/analoggenie/entries",
        { method: "POST", body: JSON.stringify({ entries }) },
        cookie,
      );
    const circuit = (id: string) => ({
      id,
      name: `AnalogGenie ${id}`,
      description: "Redrawn from the dataset's figure.",
      tags: ["amplifier"],
      projectText: projectText(id),
    });

    // Only the Owner imports.
    expect((await importing(maker, [circuit("ag-308")])).status).toBe(403);
    const imported = await importing(owner, [
      circuit("ag-308"),
      // An id another dataset, or the community, would own is refused.
      circuit("ct-1"),
    ]);
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({
      source: "analoggenie",
      results: [
        { id: "ag-308", ok: true, created: true },
        { id: "ct-1", ok: false, error: "invalid-id" },
      ],
    });

    // The dataset's wall holds it under the dataset's name; the community's
    // does not.
    const wall = async (query: string) =>
      (
        (await (await call(`/api/gallery${query}`)).json()) as {
          entries: { id: string; author: string }[];
        }
      ).entries;
    expect(await wall("?source=analoggenie")).toEqual([
      expect.objectContaining({
        id: "ag-308",
        author: "AnalogGenie (redrawn)",
      }),
    ]);
    expect((await wall("")).map((entry) => entry.id)).not.toContain("ag-308");
    expect((await call("/api/gallery/ag-308")).status).toBe(200);
    expect(
      (await (await call("/api/gallery/sources")).json()) as {
        sources: { key: string; count: number }[];
      },
    ).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({ key: "analoggenie", count: 1 }),
        expect.objectContaining({ key: "circuitthink", count: 0 }),
      ]),
    });

    // Read-only: no like, update or withdraw reaches it.
    for (const [path, method] of [
      ["/api/gallery/ag-308/like", "POST"],
      ["/api/gallery/ag-308", "PUT"],
      ["/api/gallery/ag-308/recycle", "POST"],
    ] as const)
      expect(await (await call(path, { method, body: "{}" })).json()).toEqual({
        error: "dataset-read-only",
      });

    // Importing it again replaces it in place.
    expect(
      await (
        await importing(owner, [{ ...circuit("ag-308"), name: "Renamed" }])
      ).json(),
    ).toMatchObject({ results: [{ id: "ag-308", ok: true, created: false }] });
    expect(await wall("?source=analoggenie")).toEqual([
      expect.objectContaining({ id: "ag-308" }),
    ]);
  });
});
