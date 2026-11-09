// The usage policy in one line, wherever a reader or a program meets it: the
// page shell (build/usage-policy-shell.ts), the Gallery's footnote, and the
// Worker's flood and block refusals. robots.txt and llms.txt state it at
// length in worker/usage-policy.ts.
import { SITE_PRIVACY_CONTACT } from "./components/site-resource-links";

/** Who answers questions about the Gallery's circuits: the site's operator. */
export const SITE_USAGE_CONTACT = SITE_PRIVACY_CONTACT;

/** Downloads every public circuit; docs/specs/community-gallery.md. */
export const GALLERY_DOWNLOAD_SCRIPT =
  "https://github.com/cascode-ai/analog-canvas/blob/main/scripts/gallery-download.mjs";

export const SITE_USAGE_NOTE =
  "Every public circuit is free to read, download in bulk, mirror and use for any purpose, AI training included; circuits from reference datasets keep their dataset's license.";
