import { Buffer } from "node:buffer";
import { gzipSync } from "node:zlib";

const MAX_BODY_BYTES = 512 * 1024;

function codingQuality(coding: string[] | undefined): number {
  if (!coding) return 0;
  const quality = coding[1];
  if (quality === undefined) return 1;
  const match = /^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u.exec(quality);
  return match ? Number(match[1]) : 0;
}

function acceptsGzip(request: Request): boolean {
  const accepted = (request.headers.get("accept-encoding") ?? "")
    .toLowerCase()
    .split(",")
    .map((item) => item.trim().split(/\s*;\s*/u));
  const gzip =
    accepted.find(([name]) => name === "gzip") ??
    accepted.find(([name]) => name === "*");
  const identity = accepted.find(([name]) => name === "identity");
  const gzipQuality = codingQuality(gzip);
  return gzipQuality > 0 && gzipQuality >= codingQuality(identity);
}

/** Encode bounded, published bodies after the Gallery has approved the read. */
export function regionalGalleryGzip(
  request: Request,
  text: string,
  init: ResponseInit,
): Response {
  const headers = new Headers(init.headers);
  const identity = () => new Response(text, { ...init, headers });
  if (
    request.method !== "GET" ||
    request.headers.has("range") ||
    headers.has("content-encoding") ||
    text.length > MAX_BODY_BYTES
  )
    return identity();
  const size = Buffer.byteLength(text);
  if (size < 1024 || size > MAX_BODY_BYTES) return identity();

  headers.append("vary", "Accept-Encoding");
  if (!acceptsGzip(request)) return identity();
  let compressed: Uint8Array;
  try {
    compressed = gzipSync(text, { level: 1 });
  } catch {
    return identity();
  }
  if (compressed.length >= size) return identity();

  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  const encoded = { ...init, headers, encodeBody: "manual" };
  return new Response(new Uint8Array(compressed), encoded);
}
