import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";

export async function readLimited(
  path: string,
  maximum = 16 * 1024 * 1024,
): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum)
      throw new Error("File exceeds its size limit");
    const buffer = Buffer.alloc(Math.min(stat.size + 1, maximum + 1));
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    // Refuse files that changed size during the read, rather than truncating them.
    if (length !== stat.size || (await file.stat()).size !== stat.size)
      throw new Error("File changed while reading; retry");
    return Buffer.from(buffer.subarray(0, length));
  } finally {
    await file.close();
  }
}

export async function writeDurable(
  path: string,
  bytes: string | Buffer,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
