/**
 * Messages between the PowerPoint add-in's task pane and the editor it opens
 * as a dialog. Office passes strings between them, so each message is JSON,
 * sent in chunks a host's message limit cannot refuse.
 * `public/office/taskpane.js` speaks the same protocol.
 */
const OFFICE_DIALOG_PARAMETER = "office";
/** The dialog keeps its mode across the editor's own page changes. */
const OFFICE_SESSION_KEY = "icm.office-dialog";
const CHUNK_CHARACTERS = 30_000;

/** True in the editor the PowerPoint add-in opens as its dialog. */
export function isOfficeDialog(): boolean {
  if (typeof window === "undefined") return false;
  if (
    new URLSearchParams(window.location.search).get(OFFICE_DIALOG_PARAMETER) ===
    "dialog"
  ) {
    window.sessionStorage.setItem(OFFICE_SESSION_KEY, "1");
    return true;
  }
  return window.sessionStorage.getItem(OFFICE_SESSION_KEY) === "1";
}

export type OfficeMessage =
  | { type: "ready" }
  | {
      type: "open";
      project?: string;
      documentId?: string;
      name?: string;
      /** The page changed: keep what is on screen, open nothing. */
      attach?: boolean;
    }
  | {
      type: "save";
      requestId: string;
      name: string;
      project: string;
      documentId: string;
      svg: string;
    }
  | { type: "ack"; requestId: string; ok: boolean; error?: string };

interface Chunk {
  readonly ac: 1;
  readonly id: string;
  readonly i: number;
  readonly n: number;
  readonly data: string;
}

export function sendChunked(
  post: (text: string) => void,
  message: OfficeMessage,
): void {
  const text = JSON.stringify(message);
  const id = crypto.randomUUID();
  const n = Math.max(1, Math.ceil(text.length / CHUNK_CHARACTERS));
  for (let i = 0; i < n; i++)
    post(
      JSON.stringify({
        ac: 1,
        id,
        i,
        n,
        data: text.slice(i * CHUNK_CHARACTERS, (i + 1) * CHUNK_CHARACTERS),
      } satisfies Chunk),
    );
}

/** Joins each message's chunks, in whatever order they arrive. */
export function createChunkReceiver(
  receive: (message: OfficeMessage) => void,
): (text: string) => void {
  const pending = new Map<string, string[]>();
  return (text) => {
    let chunk: Chunk;
    try {
      chunk = JSON.parse(text) as Chunk;
    } catch {
      return;
    }
    if (chunk.ac !== 1) return;
    const parts = pending.get(chunk.id) ?? new Array<string>(chunk.n);
    parts[chunk.i] = chunk.data;
    pending.set(chunk.id, parts);
    if (parts.filter((part) => part !== undefined).length < chunk.n) return;
    pending.delete(chunk.id);
    receive(JSON.parse(parts.join("")) as OfficeMessage);
  };
}
