/**
 * Ids no new circuit is given: trap circuits once held them, and the block
 * records of that time still name them.
 */
const SHORT_ID = /^[23456789abcdefghjkmnpqrstvwxyz]{10}$/u;

export function isReservedGalleryId(id: string): boolean {
  if (!SHORT_ID.test(id)) return false;
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 999_983 === 271_828;
}
