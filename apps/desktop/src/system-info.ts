import { APP_ORIGIN } from "./app-protocol.js";

export function createSystemHandler(options: {
  info(): Promise<unknown>;
  association(action: "enable" | "disable"): Promise<unknown>;
}) {
  let busy = false;
  return async (request: Request): Promise<Response> => {
    const origin =
      (request as Request & { initiatorOrigin?: string }).initiatorOrigin ??
      request.headers.get("origin");
    if (origin !== APP_ORIGIN)
      return Response.json({ message: "Wrong origin" }, { status: 403 });
    if (request.method !== "POST")
      return Response.json({ message: "POST required" }, { status: 405 });
    if (busy)
      return Response.json({
        status: "failed",
        message: "Another settings operation is in progress",
      });
    busy = true;
    try {
      const action = new URL(request.url).pathname.split("/").at(-1);
      if (action === "info")
        return Response.json({ status: "ready", info: await options.info() });
      if (action === "enable" || action === "disable")
        return Response.json({
          status: "ready",
          association: await options.association(action),
        });
      return Response.json(
        { message: "Unknown settings operation" },
        { status: 404 },
      );
    } catch (error) {
      return Response.json({
        status: "failed",
        message:
          error instanceof Error ? error.message : "Settings unavailable",
      });
    } finally {
      busy = false;
    }
  };
}
