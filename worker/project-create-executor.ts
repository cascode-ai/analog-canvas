import type { GalleryEnv } from "./gallery-store";
import { callGallery, renderPreview } from "./gallery-requests";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  createPending,
  type CreateExecutor,
} from "./project-create-operations";
import { reserveRegionalProject } from "./project-quota";
import { currentGalleryReviewer, lookupAccounts } from "./sync-identity";

type Work = {
  lease?: CreateExecutor;
  fields?: Record<string, unknown>;
  grant?: unknown;
  project?: unknown;
  idle?: boolean;
  mayFitAfterCompaction?: boolean;
  error?: string;
};

/** Execute exactly the generation admitted by the owning local store. */
async function driveProjectCreate(
  env: GalleryEnv,
  prepared: { status: number; payload: Work },
  catchUp: () => Promise<string | null>,
): Promise<Response> {
  const { lease, fields, grant } = prepared.payload;
  if (!lease || !fields)
    return prepared.payload.error === "project-create-pending"
      ? createPending()
      : Response.json(prepared.payload, { status: prepared.status });
  const control = (op: string, extra: Record<string, unknown> = {}) =>
    callGallery<Record<string, unknown>>(env, "cloud-project-operation-" + op, {
      lease,
      userId: fields.userId,
      ...extra,
    });
  const pending = async (reason: string, blocked = false) => {
    const res = await control("defer", { reason, blocked });
    return res.payload.error === "project-create-pending"
      ? createPending()
      : Response.json(res.payload, { status: res.status });
  };
  // A retained grant skips the authority's usual identity lookup. Recheck it
  // before resuming an accepted create from a previous session or generation.
  if (grant) {
    const owner = String(fields.userId),
      identity = await lookupAccounts(env, [owner], false);
    if (identity instanceof Response)
      return identity.status === 409
        ? pending("identity-mismatch", true)
        : pending("identity-unavailable");
    if (identity.deleted.includes(owner)) {
      const retired = await control("owner-retired");
      return retired.status === 200
        ? Response.json({ error: "account-deleted" }, { status: 403 })
        : Response.json(retired.payload, { status: retired.status });
    }
    if (identity.missing) return pending("unknown-owner", true);
  }
  const reserved = await reserveRegionalProject(
    env,
    String(fields.id),
    String(fields.userId),
    { lease, grant, catchUp },
  );
  if ("refusedBeforeReservation" in reserved) {
    const closed = await control("refused");
    if (closed.payload.error === "project-create-pending")
      return createPending();
    return closed.status === 200
      ? reserved.refusedBeforeReservation
      : Response.json(closed.payload, { status: closed.status });
  }
  if (reserved instanceof Response) {
    const data = (await reserved.json()) as { error?: string };
    const reason = data.error ?? "quota-invalid-response";
    if (reason === "create-executor-fenced") return reservedFence();
    return pending(
      reason,
      ![
        "quota-authority-unavailable",
        "quota-outcome-unconfirmed",
        "sequence-gap",
        "quota-catch-up-unavailable",
      ].includes(reason),
    );
  }
  let previewSvg = "";
  try {
    const project = parseProject(String(fields.projectText));
    previewSvg = await renderPreview(
      project,
      createProjectSymbolResolver(project, builtInSymbols),
    );
  } catch {
    /* The shelf can show the same placeholder as a foreground save. */
  }
  let mayEditGallery = false;
  if (fields.requiresGalleryReview === true) {
    const allowed = await currentGalleryReviewer(env, String(fields.userId));
    if (allowed instanceof Response) return pending("identity-unavailable");
    if (!allowed) return pending("gallery-link-forbidden", true);
    mayEditGallery = true;
  }
  const saved = await callGallery<Work>(env, "cloud-project-create", {
    ...fields,
    mayEditGallery,
    previewSvg,
    createLease: lease,
    reservation: reserved.reservation,
  });
  if (saved.status < 300)
    return Response.json(saved.payload, { status: saved.status });
  if (saved.payload.error === "create-executor-fenced") return reservedFence();
  if (saved.status === 507 && saved.payload.error === "replication-capacity") {
    return saved.payload.mayFitAfterCompaction === true
      ? pending("replication-capacity")
      : pending("create-event-capacity", true);
  }
  return pending(saved.payload.error ?? "create-write-unverified", true);
}

function reservedFence() {
  return Response.json({ error: "create-executor-fenced" }, { status: 409 });
}

export async function beginProjectCreate(
  env: GalleryEnv,
  fields: Record<string, unknown>,
  ticket: string,
  catchUp: () => Promise<string | null>,
) {
  return driveProjectCreate(
    env,
    await callGallery<Work>(env, "cloud-project-operation-prepare", {
      ...fields,
      ticket,
    }),
    catchUp,
  );
}

export async function resumeProjectCreate(
  env: GalleryEnv,
  catchUp: () => Promise<string | null>,
) {
  const result = await callGallery<Work>(
    env,
    "cloud-project-operation-next",
    {},
  );
  if (result.payload.lease) await driveProjectCreate(env, result, catchUp);
}
