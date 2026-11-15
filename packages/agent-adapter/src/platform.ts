/**
 * Browser-safe, dependency-free byte and encoding helpers shared by the agent
 * operation logic. They use only the `TextEncoder` Web global (available in
 * browsers and modern Node) and a portable base64 alphabet, so the agent
 * operation modules stay browser-importable.
 *
 * WP-WA1: these replace the former Node-only byte-length and base64 calls on
 * the read/render paths. Output is byte-identical to the Node equivalents.
 */

const textEncoder = new TextEncoder();

/** UTF-8 byte length of a string. */
export function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64 of a UTF-8 string. Implemented over the UTF-8 byte sequence so
 * multibyte content round-trips identically to the Node base64 encoding.
 */
export function base64EncodeUtf8(value: string): string {
  const bytes = textEncoder.encode(value);
  let output = "";
  let index = 0;
  for (; index + 3 <= bytes.length; index += 3) {
    const byte0 = bytes[index]!;
    const byte1 = bytes[index + 1]!;
    const byte2 = bytes[index + 2]!;
    output +=
      BASE64_ALPHABET[byte0 >> 2]! +
      BASE64_ALPHABET[((byte0 & 0x03) << 4) | (byte1 >> 4)]! +
      BASE64_ALPHABET[((byte1 & 0x0f) << 2) | (byte2 >> 6)]! +
      BASE64_ALPHABET[byte2 & 0x3f]!;
  }
  const remaining = bytes.length - index;
  if (remaining === 1) {
    const byte0 = bytes[index]!;
    output +=
      BASE64_ALPHABET[byte0 >> 2]! +
      BASE64_ALPHABET[(byte0 & 0x03) << 4]! +
      "==";
  } else if (remaining === 2) {
    const byte0 = bytes[index]!;
    const byte1 = bytes[index + 1]!;
    output +=
      BASE64_ALPHABET[byte0 >> 2]! +
      BASE64_ALPHABET[((byte0 & 0x03) << 4) | (byte1 >> 4)]! +
      BASE64_ALPHABET[(byte1 & 0x0f) << 2]! +
      "=";
  }
  return output;
}

/** Base64 of arbitrary bytes. */
export function base64EncodeBytes(bytes: Uint8Array): string {
  let output = "";
  let index = 0;
  for (; index + 3 <= bytes.length; index += 3) {
    const byte0 = bytes[index]!;
    const byte1 = bytes[index + 1]!;
    const byte2 = bytes[index + 2]!;
    output +=
      BASE64_ALPHABET[byte0 >> 2]! +
      BASE64_ALPHABET[((byte0 & 0x03) << 4) | (byte1 >> 4)]! +
      BASE64_ALPHABET[((byte1 & 0x0f) << 2) | (byte2 >> 6)]! +
      BASE64_ALPHABET[byte2 & 0x3f]!;
  }
  const remaining = bytes.length - index;
  if (remaining === 1) {
    const byte0 = bytes[index]!;
    output +=
      BASE64_ALPHABET[byte0 >> 2]! +
      BASE64_ALPHABET[(byte0 & 0x03) << 4]! +
      "==";
  } else if (remaining === 2) {
    const byte0 = bytes[index]!;
    const byte1 = bytes[index + 1]!;
    output +=
      BASE64_ALPHABET[byte0 >> 2]! +
      BASE64_ALPHABET[((byte0 & 0x03) << 4) | (byte1 >> 4)]! +
      BASE64_ALPHABET[(byte1 & 0x0f) << 2]! +
      "=";
  }
  return output;
}

/** Decode canonical base64 without Node or browser-only globals. */
export function base64DecodeBytes(value: string): Uint8Array | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const contentLength = value.length - padding;
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let offset = 0;
  // Validate while decoding so a large valid file does not exhaust the stack.
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64_ALPHABET.indexOf(value[index]!);
    const b = BASE64_ALPHABET.indexOf(value[index + 1]!);
    const c =
      index + 2 < contentLength
        ? BASE64_ALPHABET.indexOf(value[index + 2]!)
        : 0;
    const d =
      index + 3 < contentLength
        ? BASE64_ALPHABET.indexOf(value[index + 3]!)
        : 0;
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;
    const packed = (a << 18) | (b << 12) | (c << 6) | d;
    if (offset < bytes.length) bytes[offset++] = packed >> 16;
    if (offset < bytes.length) bytes[offset++] = (packed >> 8) & 0xff;
    if (offset < bytes.length) bytes[offset++] = packed & 0xff;
  }
  return bytes;
}
