/** The formula typographies current previews carry: label type, or MathJax. */
const CURRENT_FORMULA_TYPOGRAPHY =
  /data-formula-typography="(?:label-v4|sans-v4)"/u;

/**
 * Only old formula artifacts need recovery; ordinary stored artwork stays
 * intact. A formula drawn before its current typography — pending, MathJax
 * sans before formulas were set in label type — is redrawn once.
 */
export function formulaPreviewNeedsRefresh(svg: string): boolean {
  if (svg.includes('data-role="formula-pending"')) return true;
  return (svg.match(/data-role="formula"[^>]*>/gu) ?? []).some(
    (tag) => !CURRENT_FORMULA_TYPOGRAPHY.test(tag),
  );
}
