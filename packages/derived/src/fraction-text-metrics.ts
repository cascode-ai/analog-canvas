/**
 * Proportional fraction advances in the schematic's default bold face.
 * hmtx advances from the existing dejavu-fonts-ttf 2.37.3 / DejaVuSans-Bold,
 * unitsPerEm = 2048. Keep layout stable when toggling weight or using a fallback
 * font: the SVG renderer pins the matching textLength. Ordinary text documents
 * retain their existing metrics. U+002E uses our round-period font's advance.
 */
const glyphs =
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψω°±×÷−√∞≈≠≤≥";
const advances = [
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
const widths = new Map(
  [...glyphs].map((glyph, index) => [glyph, advances[index]! / 2048]),
);

export function fractionTextAdvanceEm(value: string): number {
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
