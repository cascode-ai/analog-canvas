import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

/** File exchange is scoped to the directory supplied by the local PPT launcher. */
export function createPowerPointSession(directory: string | undefined) {
  let sequence = 0;
  const context = directory
    ? (async () => {
        const config = JSON.parse(
          await readFile(join(directory, "session.json"), "utf8"),
        ) as { token: string; documentId?: string };
        const project = JSON.parse(
          await readFile(join(directory, "drawing.icproj"), "utf8"),
        ) as { id: string };
        try {
          sequence = JSON.parse(
            await readFile(join(directory, "result.json"), "utf8"),
          ).sequence;
        } catch {
          /* first launch */
        }
        return { ...config, projectId: project.id };
      })()
    : null;
  let busy = false;
  return async (request: Request): Promise<Response> => {
    if (!directory) return Response.json({ enabled: false });
    const config = (await context)!;
    if (request.method === "GET") {
      let ack: unknown = null;
      try {
        ack = JSON.parse(await readFile(join(directory, "ack.json"), "utf8"));
      } catch {
        /* not committed yet */
      }
      return Response.json({ enabled: true, ...config, ack });
    }
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    if (busy) return new Response("Save already running", { status: 409 });
    busy = true;
    try {
      const text = await request.text();
      if (text.length > 32 * 1024 * 1024)
        throw new Error("Circuit is too large");
      const value = JSON.parse(text) as {
        token: string;
        project: string;
        svg: string;
        documentId: string;
      };
      if (value.token !== config.token)
        return new Response("Wrong session", { status: 403 });
      if (
        typeof value.project !== "string" ||
        typeof value.svg !== "string" ||
        !value.svg.includes("<svg")
      )
        throw new Error("Missing project or SVG");
      const project = JSON.parse(value.project) as {
        id: string;
        documents: { id: string }[];
      };
      if (project.id !== config.projectId)
        throw new Error(
          "This is not the linked PowerPoint project. Return to its project tab.",
        );
      if (!project.documents.some((d) => d.id === value.documentId))
        throw new Error("Unknown Cell");
      const result = {
        protocol: 1,
        token: config.token,
        sequence: ++sequence,
        project: value.project,
        svg: value.svg,
        documentId: value.documentId,
      };
      // Keep every explicit commit locally. PPT embeds the current and three previous snapshots.
      await writeFile(
        join(directory, `revision-${sequence}.json`),
        JSON.stringify(result),
        { encoding: "utf8", flag: "wx" },
      );
      await writeFile(
        join(directory, "result.tmp"),
        JSON.stringify(result),
        "utf8",
      );
      await rename(
        join(directory, "result.tmp"),
        join(directory, "result.json"),
      );
      return Response.json({ sequence });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 400 });
    } finally {
      busy = false;
    }
  };
}
