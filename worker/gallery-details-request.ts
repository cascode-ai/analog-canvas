import { fieldText } from "./gallery-requests";
import {
  GALLERY_MAX_NAME_LENGTH,
  GALLERY_MAX_DESCRIPTION_LENGTH,
} from "./gallery-store";

/** Shared legacy and regional metadata validation; it does not change the drawing. */
export function galleryDetails(
  body: unknown,
): { name: string; description: string } | null {
  const value =
    body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const name = fieldText(value?.name, GALLERY_MAX_NAME_LENGTH);
  const description = fieldText(
    value?.description,
    GALLERY_MAX_DESCRIPTION_LENGTH,
  );
  return name && description !== null ? { name, description } : null;
}
