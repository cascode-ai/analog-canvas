import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { format } from "prettier";

const root = resolve(import.meta.dirname, "..");
const referenceRoot = resolve(
  root,
  "fixtures/visual-reference/razavi-reference-v1",
);
const pdfPath = process.argv[process.argv.indexOf("--pdf") + 1];
if (!pdfPath || process.argv.indexOf("--pdf") < 0) {
  throw new Error(
    "Usage: node scripts/extract-razavi-capacitor-section-pdf.mjs --pdf <razavi-2nd-edition.pdf>",
  );
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceSha256 = hash(await readFile(pdfPath));
if (
  sourceSha256 !==
  "a6031d1149c2c6191a1f0e541065165b72dafc4bc4ab4b0ea37af41b7cb0f739"
) {
  throw new Error("Expected the reference-pinned second-edition Razavi PDF");
}
const temporaryRoot = await mkdtemp(
  resolve(tmpdir(), "razavi-capacitor-section-"),
);
try {
  const svgPath = resolve(temporaryRoot, "page.svg");
  execFileSync("pdftocairo", [
    "-f",
    "581",
    "-l",
    "581",
    "-svg",
    pdfPath,
    svgPath,
  ]);
  const svg = await readFile(svgPath, "utf8");
  const signatures = [
    ["top-contact", "278.13757, 131.622228"],
    ["top-plate", "271.049413, 134.723921"],
    ["dielectric", "271.037429, 138.161148"],
    ["bottom-plate", "271.048414, 139.884755"],
    ["bottom-contact", "252.94655, 138.542618"],
    ["substrate", "249.543276, 145.886421"],
  ];
  const nativeObjects = signatures.map(([part, signature]) => {
    const element = svg
      .split("\n")
      .find((line) => line.startsWith("<path ") && line.includes(signature));
    if (!element) throw new Error(`Missing native Figure 13.42 path ${part}`);
    const data = element.match(/ d="([^"]+)"/)[1];
    if (!/^[ML\d.\s-]+$/.test(data))
      throw new Error(`Unexpected path commands in ${part}`);
    const matrix = element
      .match(/transform="matrix\(([^)]+)\)"/)[1]
      .split(",")
      .map(Number);
    const points = [...data.matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)].map(
      ([, x, y]) => ({
        x: Number(x) * matrix[0] + matrix[4],
        y: Number(y) * matrix[3] + matrix[5],
      }),
    );
    return {
      part,
      svgElement: element,
      points,
      sourceStrokeWidth:
        Number(element.match(/stroke-width="([^"]+)"/)[1]) * matrix[0],
    };
  });
  const topContact = nativeObjects.find((item) => item.part === "top-contact");
  const bottomContact = nativeObjects.find(
    (item) => item.part === "bottom-contact",
  );
  const sourceOriginPdf = {
    x: (topContact.points[0].x + topContact.points[1].x) / 2,
    y: bottomContact.points[0].y,
  };
  const logicalUnitsPerPdfPoint = 1.2;
  const round = (value) => Number(value.toFixed(6));
  const point = ({ x, y }) => ({
    x: round((x - sourceOriginPdf.x) * logicalUnitsPerPdfPoint),
    y: round((y - sourceOriginPdf.y) * logicalUnitsPerPdfPoint),
  });
  const normal = { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" };
  const bottomPlate = nativeObjects.find(
    (item) => item.part === "bottom-plate",
  );
  const bottomPlateTop = Math.min(...bottomPlate.points.map((p) => p.y));
  const visiblePoints = (item) => {
    if (item.part !== "dielectric") return item.points;
    // The source white bottom-plate mask hides the lower dielectric outline.
    // Clip it here instead of painting opaque white over instance colors.
    const xs = item.points.map((p) => p.x);
    const top = Math.min(...item.points.map((p) => p.y));
    return [
      { x: Math.min(...xs), y: bottomPlateTop },
      { x: Math.min(...xs), y: top },
      { x: Math.max(...xs), y: top },
      { x: Math.max(...xs), y: bottomPlateTop },
    ];
  };
  const primitives = nativeObjects.map((item) => ({
    kind: "polyline",
    part: item.part,
    points: visiblePoints(item).map(point),
    style: {
      ...normal,
      strokeRole: item.part.endsWith("contact") ? "emphasis" : "normal",
    },
  }));
  // The PDF's plate textures are raster masks. Keep the plate outlines as
  // native vectors and represent their section texture with vector hatching.
  for (const part of ["top-plate", "bottom-plate"]) {
    const plate = nativeObjects.find((item) => item.part === part);
    const xs = plate.points.map((p) => p.x);
    const ys = plate.points.map((p) => p.y);
    const top = Math.min(...ys),
      bottom = Math.max(...ys);
    const inset = 0.35;
    for (let x = Math.min(...xs) + 1; x + 1.5 < Math.max(...xs); x += 3) {
      primitives.push({
        kind: "line",
        part: `${part}-hatch`,
        from: point({
          x,
          y: part === "top-plate" ? bottom - inset : top + inset,
        }),
        to: point({
          x: x + 1.5,
          y: part === "top-plate" ? top + inset : bottom - inset,
        }),
        style: { strokeRole: "normal", lineCap: "butt" },
      });
    }
  }
  primitives.push(
    {
      kind: "line",
      part: "top-lead",
      from: { x: 0, y: -20 },
      to: { x: 0, y: point(topContact.points[0]).y },
      style: normal,
    },
    {
      kind: "line",
      part: "bottom-lead",
      from: { x: -40, y: 0 },
      to: point(bottomContact.points[0]),
      style: normal,
    },
  );
  const symbolDefinition = {
    schemaVersion: 1,
    id: "capacitor-section",
    name: "Capacitor Section",
    viewBox: { x: -44, y: -24, width: 80, height: 40 },
    pins: [
      {
        name: "1",
        role: "passive",
        at: { x: 0, y: -20 },
        direction: "north",
        presentation: { visibility: "visible", leadLength: 10 },
      },
      {
        name: "2",
        role: "passive",
        at: { x: -40, y: 0 },
        direction: "west",
        presentation: { visibility: "visible", leadLength: 10 },
      },
    ],
    primitives,
    variants: [],
  };
  const rasterName = "capacitor-section-reference.png";
  const rasterPrefix = resolve(temporaryRoot, "crop");
  // 4 pixels per PDF point; crop contains only the section and its local leads.
  const crop = { x: 248, y: 124, width: 60, height: 24 };
  execFileSync("pdftoppm", [
    "-f",
    "581",
    "-l",
    "581",
    "-singlefile",
    "-r",
    "288",
    "-x",
    String(crop.x * 4),
    "-y",
    String(crop.y * 4),
    "-W",
    String(crop.width * 4),
    "-H",
    String(crop.height * 4),
    "-png",
    pdfPath,
    rasterPrefix,
  ]);
  await writeFile(
    resolve(referenceRoot, rasterName),
    await readFile(`${rasterPrefix}.png`),
  );
  const evidence = {
    schemaVersion: 1,
    id: "razavi-textbook-capacitor-section",
    kind: "pdf-vector-extract",
    source: {
      title: "Design of Analog CMOS Integrated Circuits, Second Edition",
      sha256: sourceSha256,
      pdfPage: 581,
      printedPage: 562,
      figure: "13.42",
    },
    selection: {
      method: "native-pdf-section-paths",
      scope:
        "Top plate, dielectric outline, bottom plate, contact bars and substrate baseline; circuit wiring and adjacent devices excluded",
      nativeObjectCount: nativeObjects.length,
      nativeObjects,
    },
    normalization: {
      sourceOriginPdf,
      logicalUnitsPerPdfPoint,
      adjustments: [
        "External leads terminate at the nearest useful 10-unit grid anchors; surrounding sampler wiring is excluded.",
        "Raster plate textures are represented by vector hatching; gray dielectric fill is omitted so instance colors remain uniform.",
        "Clip the dielectric outline where the source bottom-plate white mask hides it; retain the source opposite plate-hatching directions.",
        "Substrate is artwork only: no third terminal, parasitic capacitance or substrate simulation model.",
      ],
      symbolDefinition,
    },
    rasterWitness: {
      kind: "source-pdf-crop",
      assetPath: rasterName,
      sourcePdfPage: 581,
      sourceCropPdf: crop,
      pixelsPerPdfPoint: 4,
    },
  };
  await writeFile(
    resolve(referenceRoot, "capacitor-section-vector-source.json"),
    await format(JSON.stringify(evidence), { parser: "json" }),
  );
  console.log(
    "Extracted Figure 13.42 capacitor section vectors and source crop",
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
