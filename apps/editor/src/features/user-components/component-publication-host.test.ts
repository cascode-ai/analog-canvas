import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createLocalComponentHandler } from "../../../../desktop/src/component-library";
import { APP_ORIGIN } from "../../../../desktop/src/app-protocol";
import {
  componentLibraryHarness,
  nativePackage,
} from "../../../../../worker/component-library.test-support";
import { newComponentDefinition } from "./component-definition-edit";
import {
  captureLibraryComponent,
  saveLibraryComponent,
} from "./component-publication-host";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(["native", "artwork"] as const)(
  "keeps desktop %s save/update/capture offline without cloud provenance",
  async (kind) => {
    vi.stubEnv("ICM_DESKTOP", "1");
    const directory = await mkdtemp(join(tmpdir(), "publication-host-"));
    const handle = createLocalComponentHandler(
      join(directory, "components.json"),
    );
    const requests: string[] = [];
    let loseReply = true;
    vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
      requests.push(input);
      if (!input.startsWith("/desktop/components/"))
        throw Error("Desktop attempted a cloud request");
      const response = await handle(
        new Request(`${APP_ORIGIN}${input}`, {
          ...init,
          headers: { ...init.headers, origin: APP_ORIGIN },
        }),
      );
      if (loseReply && response.ok) {
        loseReply = false;
        throw Error("Local save reply lost");
      }
      return response;
    });
    vi.stubGlobal("indexedDB", undefined);
    try {
      const payload =
        kind === "native"
          ? nativePackage()
          : { definition: { symbol: newComponentDefinition().symbol } };
      const createRequest = {
        componentId: "offline-component",
        revision: 0,
        payload,
      };
      await expect(saveLibraryComponent(createRequest)).rejects.toThrow(
        "Local save reply lost",
      );
      const created = await saveLibraryComponent(createRequest);
      expect(created).toMatchObject({
        outcome: "created",
        entry: { revision: 1 },
      });
      const changed = structuredClone(payload);
      changed.definition.symbol.name = "Local edit";
      const updateRequest = {
        componentId: created.entry.id,
        revision: 1,
        payload: changed,
      };
      loseReply = true;
      await expect(saveLibraryComponent(updateRequest)).rejects.toThrow(
        "Local save reply lost",
      );
      const updated = await saveLibraryComponent(updateRequest);
      expect(updated).toMatchObject({
        outcome: "updated",
        entry: { revision: 2 },
      });
      const capture = await captureLibraryComponent(updated.entry);
      expect(capture.definition.libraryOrigin).toBeUndefined();
      expect(capture.definition.symbol.name).toBe("Local edit");
      if (kind === "native")
        expect(capture.circuit).toEqual(nativePackage().circuit);
      await expect(
        saveLibraryComponent({
          componentId: created.entry.id,
          revision: 1,
          payload,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(requests).toEqual(Array(5).fill("/desktop/components/save"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("retains hosted unchanged/duplicate outcomes and source provenance through the shared host entry", async () => {
  vi.stubEnv("ICM_DESKTOP", "");
  const route = componentLibraryHarness();
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    if (input === "/api/auth/me")
      return Response.json({ user: { id: "alice" } });
    if (!input.startsWith("/api/components/")) throw Error("Unexpected route");
    return route(
      init!.method!,
      input.slice("/api/components".length),
      JSON.parse(String(init!.body)),
      "alice",
    );
  });
  const request = {
    componentId: "hosted-component",
    revision: 0,
    payload: nativePackage(),
  };
  const created = await saveLibraryComponent(request);
  expect(created.outcome).toBe("created");
  expect(
    (await saveLibraryComponent({ ...request, revision: 1 })).outcome,
  ).toBe("unchanged");
  await expect(
    saveLibraryComponent({ ...request, componentId: "duplicate-component" }),
  ).rejects.toMatchObject({
    code: "COMPONENT_ALREADY_PUBLISHED",
    existing: { id: "hosted-component", revision: 1 },
  });
  expect(
    (await captureLibraryComponent(created.entry)).definition.libraryOrigin,
  ).toMatchObject({
    componentId: "hosted-component",
    revision: 1,
    authorId: "alice",
  });
});
