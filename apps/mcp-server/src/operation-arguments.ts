import { z } from "zod";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function conflict(path: string[]) {
  throw new z.ZodError([
    {
      code: "custom",
      path,
      message: "Conflicting argument aliases or detail fields.",
    },
  ]);
}

/** Compatibility at the shared execution boundary, never a second validator. */
export function simulationArguments(
  args: unknown,
  envelopeFields: ReadonlySet<string>,
  discriminator: "action" | "operation",
): unknown {
  if (!record(args)) return args;
  let value = { ...args };
  if (
    value.request === undefined &&
    (typeof value.action === "string" || typeof value.operation === "string")
  ) {
    const request: Record<string, unknown> = {};
    const envelope: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value))
      (envelopeFields.has(key) ? envelope : request)[key] = field;
    value = { ...envelope, request };
  }
  if (!record(value.request)) return value;
  const request = { ...value.request };
  const alias = discriminator === "action" ? "operation" : "action";
  if (request[alias] !== undefined) {
    if (
      request[discriminator] !== undefined &&
      request[discriminator] !== request[alias]
    )
      conflict(["request", discriminator]);
    request[discriminator] ??= request[alias];
    delete request[alias];
  }
  // Only file tools have two detail domains. Simulation capabilities' nested
  // summary/full is a real business field and must remain inside its request.
  if (discriminator === "action") {
    if (value.detail === "text" || value.detail === "mapped") {
      if (request.detail !== undefined && request.detail !== value.detail)
        conflict(["request", "detail"]);
      request.detail = value.detail;
      delete value.detail;
    }
    if (request.detail === "summary" || request.detail === "full") {
      if (value.detail !== undefined && value.detail !== request.detail)
        conflict(["detail"]);
      value.detail = request.detail;
      delete request.detail;
    }
  }
  return { ...value, request };
}
