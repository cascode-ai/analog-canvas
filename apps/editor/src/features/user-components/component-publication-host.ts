import { saveNativeComponent } from "../../hosts/native-component-library";
import { componentLibraryCapture } from "./component-library-origin";
import { executeComponentPublication } from "./component-publication-operation";
import type {
  SharedComponent,
  SharedDefinitionPayload,
} from "./component-library-contract";

/** Desktop stays offline; hosted publication retains its account-bound journal. */
export async function saveLibraryComponent(request: {
  componentId: string;
  revision: number;
  payload: SharedDefinitionPayload;
}) {
  if (!import.meta.env?.ICM_DESKTOP)
    return executeComponentPublication(request);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([request.componentId, request.revision, request.payload]),
    ),
  );
  const entry = await saveNativeComponent(
    request.componentId,
    request.revision,
    request.payload.definition,
    request.payload.circuit,
    {
      idempotencyKey: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    },
  );
  return {
    entry,
    outcome:
      request.revision === 0 ? ("created" as const) : ("updated" as const),
  };
}

/** Local-library identity is separate from public-cloud provenance. */
export async function captureLibraryComponent(
  entry: SharedComponent,
): Promise<SharedDefinitionPayload> {
  return import.meta.env?.ICM_DESKTOP
    ? structuredClone({
        definition: entry.definition,
        ...(entry.circuit ? { circuit: entry.circuit } : {}),
      })
    : componentLibraryCapture(entry);
}
