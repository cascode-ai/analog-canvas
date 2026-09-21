/** Only old formula artifacts need recovery; ordinary stored artwork stays intact. */
export function formulaPreviewNeedsRefresh(svg: string): boolean {
  return (
    svg.includes('data-role="formula-pending"') ||
    (svg.includes('data-role="formula"') &&
      !svg.includes('data-formula-typography="sans-v2"'))
  );
}
