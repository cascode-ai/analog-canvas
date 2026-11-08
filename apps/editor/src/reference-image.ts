// A reference image as PUT /api/gallery/<id>/reference takes it: PNG, JPEG
// or WebP of at most 480 KB, else redrawn as WebP of at most 1600 px.

const LIMIT = 480 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

function base64Of(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(text);
}

/** The image to upload, or null when the file is no readable image. */
async function referenceImageOf(
  file: File,
): Promise<{ type: string; data: string } | null> {
  if (TYPES.includes(file.type) && file.size <= LIMIT)
    return {
      type: file.type,
      data: base64Of(new Uint8Array(await file.arrayBuffer())),
    };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.86, 0.72, 0.58, 0.44]) {
    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, "image/webp", quality),
    );
    if (blob && blob.size <= LIMIT)
      return {
        type: "image/webp",
        data: base64Of(new Uint8Array(await blob.arrayBuffer())),
      };
  }
  return null;
}

export const REFERENCE_SAVED = "Reference image saved";

/** Upload one; the message to show, REFERENCE_SAVED when it worked. */
export async function uploadReferenceImage(
  entryId: string,
  file: File,
  fetchLike: typeof fetch = fetch,
): Promise<string> {
  const image = await referenceImageOf(file);
  if (!image) return "That file is not an image we can use.";
  const response = await fetchLike(
    `/api/gallery/${encodeURIComponent(entryId)}/reference`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image, rights: true }),
    },
  ).catch(() => null);
  return response?.ok
    ? REFERENCE_SAVED
    : "The reference image could not be saved.";
}
