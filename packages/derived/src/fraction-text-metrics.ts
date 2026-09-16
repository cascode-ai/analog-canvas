/**
 * Proportional schematic-text advances from the existing
 * dejavu-fonts-ttf 2.37.3 faces, unitsPerEm = 2048. Oblique faces retain the
 * matching upright hmtx advances, so weight is the only width dimension.
 * U+002E uses our round-period font's advance.
 *
 * These numbers position independent SVG decorations and script attachment
 * columns. They must never be imposed on glyph outlines with
 * `lengthAdjust="spacingAndGlyphs"`: doing so visibly stretches narrow letters.
 */
const glyphs =
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψω°±×÷−√∞≈≠≤≥";
const plainAdvances = [
  651, 821, 942, 1716, 1303, 1946, 1597, 563, 799, 799, 1024, 1716, 651, 739,
  651, 690, 1303, 1303, 1303, 1303, 1303, 1303, 1303, 1303, 1303, 1303, 690,
  690, 1716, 1716, 1716, 1087, 2048, 1401, 1405, 1430, 1577, 1294, 1178, 1587,
  1540, 604, 604, 1343, 1141, 1767, 1532, 1612, 1235, 1612, 1423, 1300, 1251,
  1499, 1401, 2025, 1403, 1251, 1403, 799, 690, 799, 1716, 1024, 1024, 1255,
  1300, 1126, 1300, 1260, 721, 1300, 1298, 569, 569, 1186, 569, 1995, 1298,
  1253, 1300, 1300, 842, 1067, 803, 1298, 1212, 1675, 1212, 1212, 1075, 1303,
  690, 1303, 1716, 1401, 1405, 1141, 1401, 1294, 1403, 1540, 1612, 604, 1343,
  1401, 1767, 1532, 1294, 1612, 1540, 1235, 1294, 1251, 1251, 1612, 1403, 1612,
  1565, 604, 1251, 1350, 1107, 1298, 693, 1185, 1350, 1307, 1212, 1253, 1107,
  1114, 1298, 1253, 693, 1207, 1212, 1303, 1144, 1142, 1253, 1233, 1300, 1202,
  1298, 1233, 1185, 1351, 1183, 1351, 1715, 1024, 1716, 1716, 1716, 1716, 1305,
  1706, 1716, 1716, 1716, 1716,
];
const boldAdvances = [
  713, 934, 1067, 1716, 1425, 2052, 1786, 627, 936, 936, 1071, 1716, 778, 850,
  778, 748, 1425, 1425, 1425, 1425, 1425, 1425, 1425, 1425, 1425, 1425, 819,
  819, 1716, 1716, 1716, 1188, 2048, 1585, 1561, 1503, 1700, 1399, 1399, 1681,
  1714, 762, 762, 1587, 1305, 2038, 1714, 1741, 1501, 1741, 1577, 1475, 1397,
  1663, 1585, 2259, 1579, 1483, 1485, 936, 748, 936, 1716, 1024, 1024, 1382,
  1466, 1214, 1466, 1389, 891, 1466, 1458, 702, 702, 1362, 702, 2134, 1458,
  1407, 1466, 1466, 1010, 1219, 979, 1458, 1335, 1892, 1321, 1335, 1192, 1458,
  748, 1458, 1716, 1585, 1561, 1305, 1585, 1399, 1485, 1714, 1741, 762, 1587,
  1585, 2038, 1714, 1294, 1741, 1714, 1501, 1399, 1397, 1483, 1741, 1579, 1740,
  1741, 762, 1483, 1407, 1140, 1458, 798, 1383, 1407, 1466, 1395, 1407, 1140,
  1210, 1458, 1407, 798, 1455, 1296, 1507, 1395, 1210, 1407, 1620, 1466, 1214,
  1595, 1307, 1383, 1602, 1321, 1626, 1780, 1024, 1716, 1716, 1716, 1716, 1366,
  1706, 1716, 1716, 1716, 1716,
];
const plainWidths = new Map(
  [...glyphs].map((glyph, index) => [glyph, plainAdvances[index]! / 2048]),
);
const boldWidths = new Map(
  [...glyphs].map((glyph, index) => [glyph, boldAdvances[index]! / 2048]),
);

export function schematicTextAdvanceEm(
  value: string,
  weight: "plain" | "bold",
): number {
  const widths = weight === "bold" ? boldWidths : plainWidths;
  return [...value].reduce(
    (width, glyph) =>
      width +
      (glyph === "."
        ? 0.36
        : (widths.get(glyph) ??
          (/\p{Mark}/u.test(glyph)
            ? 0
            : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
                  glyph,
                )
              ? 1
              : 0.7))),
    0,
  );
}

export function fractionTextAdvanceEm(value: string): number {
  return schematicTextAdvanceEm(value, "bold");
}
