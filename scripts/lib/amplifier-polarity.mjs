/**
 * Canonical signed amplifier artwork is drawn beside its named semantic pair.
 * This validates presentation only; electrical consumers never infer pins or
 * connectivity from marks. Unmarked components need no polarity artwork.
 */
export function validateAmplifierPolarity(symbol) {
  for (const side of ["input", "output"]) {
    const positive = symbol.primitives.filter(
      (primitive) => primitive.part === `${side}-polarity`,
    );
    const negative = symbol.primitives.filter(
      (primitive) => primitive.part === `upright-${side}-polarity-negative`,
    );
    if (!positive.length && !negative.length) continue;
    const positivePin = symbol.pins.find((pin) =>
      side === "input"
        ? pin.role === "non-inverting-input"
        : pin.name === "OUT+",
    );
    const negativePin = symbol.pins.find((pin) =>
      side === "input" ? pin.role === "inverting-input" : pin.name === "OUT-",
    );
    if (
      !positivePin ||
      !negativePin ||
      positive.length !== 2 ||
      negative.length !== 1
    )
      throw new Error(
        `${symbol.id}: ${side} polarity must mark one semantic pair`,
      );
    const horizontal = (stroke) =>
      stroke.kind === "line" &&
      stroke.from.y === stroke.to.y &&
      stroke.from.x !== stroke.to.x;
    const vertical = (stroke) =>
      stroke.kind === "line" &&
      stroke.from.x === stroke.to.x &&
      stroke.from.y !== stroke.to.y;
    if (
      positive.filter(horizontal).length !== 1 ||
      positive.filter(vertical).length !== 1 ||
      !horizontal(negative[0])
    )
      throw new Error(`${symbol.id}: polarity must draw a plus and a minus`);
    const positiveCenter = positive.map((stroke) => {
      if (stroke.kind !== "line")
        throw new Error(`${symbol.id}: invalid polarity stroke`);
      return {
        x: (stroke.from.x + stroke.to.x) / 2,
        y: (stroke.from.y + stroke.to.y) / 2,
      };
    });
    if (
      positiveCenter[0].x !== positiveCenter[1].x ||
      positiveCenter[0].y !== positiveCenter[1].y
    )
      throw new Error(
        `${symbol.id}: positive polarity strokes must share a center`,
      );
    for (const [strokes, pin, other] of [
      [positive, positivePin, negativePin],
      [negative, negativePin, positivePin],
    ]) {
      for (const stroke of strokes) {
        if (stroke.kind !== "line")
          throw new Error(`${symbol.id}: invalid polarity stroke`);
        const y = (stroke.from.y + stroke.to.y) / 2;
        if (Math.abs(y - pin.at.y) >= Math.abs(y - other.at.y))
          throw new Error(
            `${symbol.id}: ${side} polarity contradicts pin ${pin.name}`,
          );
      }
    }
  }
}
