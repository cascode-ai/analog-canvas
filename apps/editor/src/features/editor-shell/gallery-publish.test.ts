import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  describePublishOutcome,
  forgetOnUnauthorized,
  publishProjectToGallery,
  rememberedPublishAuthor,
  rememberedPublishToken,
  rememberPublishAuthor,
  rememberPublishToken,
} from "./gallery-publish";

const project = createEmptyProject("p1", "Ring Oscillator");

function fetchReturning(
  status: number,
  payload: unknown,
  seen: { url?: string; init?: RequestInit | undefined } = {},
): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(JSON.stringify(payload), { status });
  }) as typeof fetch;
}

function memoryStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("publishProjectToGallery", () => {
  it("posts the serialized Project with the bearer passphrase", async () => {
    const seen: { url?: string; init?: RequestInit | undefined } = {};
    const outcome = await publishProjectToGallery(
      project,
      {
        name: "  Ring Oscillator  ",
        author: "Vivian",
        description: "Five stages",
        tags: ["Amplifier", "OTA"],
        token: "secret-token",
      },
      fetchReturning(201, { id: "entry-1" }, seen),
    );
    expect(outcome).toEqual({ status: "published", id: "entry-1" });
    expect(seen.url).toBe("/api/gallery/submissions");
    expect((seen.init?.headers as Record<string, string>).authorization).toBe(
      "Bearer secret-token",
    );
    const body = JSON.parse(String(seen.init?.body)) as {
      name: string;
      author: string;
      description: string;
      projectText: string;
    };
    expect(body.name).toBe("Ring Oscillator");
    expect(body.author).toBe("Vivian");
    expect(body.description).toBe("Five stages");
    expect(JSON.parse(body.projectText).schemaVersion).toBe(
      project.schemaVersion,
    );
  });

  it("maps every documented rejection to a typed outcome", async () => {
    const cases: [number, unknown, string][] = [
      [401, { error: "unauthorized" }, "unauthorized"],
      [413, { error: "too-large" }, "too-large"],
      [429, { error: "rate-limited" }, "rate-limited"],
      [400, { error: "invalid-fields" }, "rejected"],
    ];
    for (const [status, payload, expected] of cases) {
      const outcome = await publishProjectToGallery(
        project,
        { name: "N", author: "", description: "", tags: [], token: "t" },
        fetchReturning(status, payload),
      );
      expect(outcome.status).toBe(expected);
      expect(describePublishOutcome(outcome)).not.toHaveLength(0);
    }
  });

  it("omits the bearer for an empty passphrase so the session cookie signs", async () => {
    const seen: { url?: string; init?: RequestInit | undefined } = {};
    const outcome = await publishProjectToGallery(
      project,
      { name: "N", author: "", description: "", tags: [], token: "" },
      fetchReturning(201, { id: "entry-2" }, seen),
    );
    expect(outcome.status).toBe("published");
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(seen.init?.credentials).toBe("same-origin");
  });

  it("reports a thrown fetch as unreachable", async () => {
    const outcome = await publishProjectToGallery(
      project,
      { name: "N", author: "", description: "", tags: [], token: "t" },
      (() => Promise.reject(new Error("offline"))) as typeof fetch,
    );
    expect(outcome).toEqual({ status: "unreachable", message: "offline" });
  });
});

describe("publish passphrase session memory", () => {
  it("round-trips the passphrase and forgets it on a 401", () => {
    const storage = memoryStorage();
    rememberPublishToken("secret-token", storage);
    expect(rememberedPublishToken(storage)).toBe("secret-token");
    expect(forgetOnUnauthorized({ status: "rate-limited" }, storage)).toBe(
      false,
    );
    expect(rememberedPublishToken(storage)).toBe("secret-token");
    expect(forgetOnUnauthorized({ status: "unauthorized" }, storage)).toBe(
      true,
    );
    expect(rememberedPublishToken(storage)).toBe("");
    expect(storage.map.size).toBe(0);
  });
});

describe("publish author memory", () => {
  it("prefills the last-used byline and forgets a cleared one", () => {
    const storage = memoryStorage();
    expect(rememberedPublishAuthor(storage)).toBe("");
    rememberPublishAuthor("  Token Zhang  ", storage);
    expect(rememberedPublishAuthor(storage)).toBe("Token Zhang");
    rememberPublishAuthor("   ", storage);
    expect(rememberedPublishAuthor(storage)).toBe("");
    expect(storage.map.size).toBe(0);
  });
});
