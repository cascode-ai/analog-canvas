import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { razaviTextbookProfile } from "../packages/derived/dist/style-profile.js";
import { rasterizeSvgBytes } from "../packages/exporters/dist/node.js";
import { renderSymbolDefinitionBody } from "../packages/render-svg/dist/index.js";

const check = process.argv.includes("--check");
const publicRoot = resolve("apps/editor/public");
const iconPath = resolve(publicRoot, "icon.svg");
const component = JSON.parse(
  await readFile(resolve("packages/components/definitions/nmos.json"), "utf8"),
);
const symbol = component.symbol;
const variant = symbol.variants.find(
  (candidate) => candidate.id === symbol.defaultVariantId,
);
if (!variant) throw new Error("NMOS default variant is missing");
const visiblePrimitives = [
  ...symbol.primitives.filter(
    (primitive) => !variant.hiddenPrimitiveParts?.includes(primitive.part),
  ),
  ...variant.additionalPrimitives,
];
const visiblePoints = visiblePrimitives.flatMap((primitive) => [
  ...(primitive.points ?? []),
  ...(primitive.from ? [primitive.from] : []),
  ...(primitive.to ? [primitive.to] : []),
]);
if (visiblePoints.length === 0)
  throw new Error("NMOS icon has no visible geometry");
const bounds = {
  minX: Math.min(...visiblePoints.map(({ x }) => x)),
  maxX: Math.max(...visiblePoints.map(({ x }) => x)),
  minY: Math.min(...visiblePoints.map(({ y }) => y)),
  maxY: Math.max(...visiblePoints.map(({ y }) => y)),
};
const artworkCenter = {
  x: (bounds.minX + bounds.maxX) / 2,
  y: (bounds.minY + bounds.maxY) / 2,
};
const formatCoordinate = (value) => Number(value.toFixed(6)).toString();
const iconSymbolScale = 0.85;
const body = renderSymbolDefinitionBody(
  symbol,
  variant.hiddenPrimitiveParts,
  variant.additionalPrimitives,
  razaviTextbookProfile,
).replaceAll(razaviTextbookProfile.foreground, "#fff");
const { x, y, width, height } = symbol.viewBox;
const viewCenter = { x: x + width / 2, y: y + height / 2 };
const centerTransform =
  `translate(${formatCoordinate(viewCenter.x)} ${formatCoordinate(viewCenter.y)}) ` +
  `scale(${iconSymbolScale}) ` +
  `translate(${formatCoordinate(-artworkCenter.x)} ${formatCoordinate(-artworkCenter.y)})`;
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}">\n` +
  `  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#000"/>\n` +
  `  <g transform="${centerTransform}" fill="none" stroke="#fff" stroke-width="${razaviTextbookProfile.strokes.symbol}" stroke-linecap="${razaviTextbookProfile.lineCap}" stroke-linejoin="${razaviTextbookProfile.lineJoin}" stroke-miterlimit="${razaviTextbookProfile.miterLimit}">${body}</g>\n` +
  `</svg>\n`;

if (check) {
  const expected = await readFile(iconPath, "utf8");
  if (expected !== svg) {
    throw new Error("PWA source icon differs from the component-library NMOS");
  }
} else {
  await writeFile(iconPath, svg);
}
for (const size of [192, 512]) {
  const path = resolve(publicRoot, `icon-${size}.png`);
  const bytes = Buffer.from(rasterizeSvgBytes(svg, size));
  if (check) {
    const expected = await readFile(path);
    if (!expected.equals(bytes)) throw new Error(`PWA icon differs: ${size}`);
  } else {
    await writeFile(path, bytes);
  }
}
process.stdout.write(`PWA icons ${check ? "match" : "written"}.\n`);
