import { z } from "zod";
import { APP_ORIGIN } from "./app-protocol.js";

/** Explicit UI commands open fixed URLs outside the offline renderer. */
export function createExternalLinkHandler(
  open: (url: string) => Promise<void>,
  commit: string,
) {
  const targets = {
    owner: "https://tokenzhang.com",
    repository: "https://github.com/cascode-ai/analog-canvas",
    source: `https://github.com/cascode-ai/analog-canvas/commit/${commit}`,
  };
  return async (request: Request): Promise<Response> => {
    const origin =
      (request as Request & { initiatorOrigin?: string }).initiatorOrigin ??
      request.headers.get("origin");
    if (origin !== APP_ORIGIN)
      return Response.json({ message: "Wrong origin" }, { status: 403 });
    if (request.method !== "POST")
      return Response.json({ message: "POST required" }, { status: 405 });
    try {
      const { target } = z
        .object({ target: z.enum(["owner", "repository", "source"]) })
        .strict()
        .parse(await request.json());
      if (target === "source" && !/^[a-f0-9]{40}$/u.test(commit))
        throw Error("Source identity unavailable");
      await open(targets[target]);
      return Response.json({ status: "opened" });
    } catch (error) {
      return Response.json(
        {
          message:
            error instanceof Error ? error.message : "Link could not open",
        },
        { status: 400 },
      );
    }
  };
}
