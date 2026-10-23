// The usage policy in one line, wherever a reader or a program meets it: the
// page shell (build/usage-policy-head.ts), the Gallery's footnote, and the
// Worker's flood and block refusals. robots.txt and llms.txt state it at
// length in worker/usage-policy.ts.
import { SITE_PRIVACY_CONTACT } from "./components/site-resource-links";

/** Who grants bulk access to the Gallery's circuits: the site's operator. */
export const SITE_USAGE_CONTACT = SITE_PRIVACY_CONTACT;

export const SITE_USAGE_NOTE = `Occasional, manual use of individual circuits is welcome. Bulk collection is strictly prohibited without the site author's prior permission (${SITE_USAGE_CONTACT}); violators will receive a lawyer's letter.`;
