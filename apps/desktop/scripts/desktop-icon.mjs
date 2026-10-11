import { readFile, writeFile } from "node:fs/promises";
import { rasterizeSvgBytes } from "../../../packages/exporters/dist/node.js";

/** Windows icon sizes are all rendered from the website's canonical SVG. */
export async function writeDesktopIcon(svgPath, icoPath) {
  const svg = await readFile(svgPath, "utf8");
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => Buffer.from(rasterizeSvgBytes(svg, size)));
  const directory = Buffer.alloc(6 + 16 * sizes.length);
  directory.writeUInt16LE(1, 2); // ICO, not a cursor.
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] =
      sizes[index] === 256 ? 0 : sizes[index];
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  }
  await writeFile(icoPath, Buffer.concat([directory, ...images]));
}
