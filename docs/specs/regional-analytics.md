# Regional visitor statistics

Status: `accepted`

Primary owner: first-party analytics and regional runtime. #2174.

- Preserve the existing overseas AnalyticsDO identity, visitor cookie, public
  response shapes and every existing page. Only the privacy notice's retention
  explanation changes. A returning browser, not an account, is a visitor.
- Back up both current stores and verify isolated restores before enabling
  replication. Keep the overseas history in place. Imports never replace a
  live database or recompute the lifetime counter from surviving identities.
- China commits collection and its outbound event together. Neither collection
  nor public statistics reads waits for overseas. The authority computes one
  global result; China serves its last confirmed summary through existing APIs.
- Collector batches stay immutable until acknowledged. The authority applies
  each consecutive batch and its receipt in one transaction; replay returns the
  receipt without counting again. Changed replays and gaps are refused.
- Events retain their server collection time and UTC date. Preserve the
  authority's first-counted visitor attribution and first-counted source for
  each visitor/day. A browser observed in both regions contributes one lifetime
  visitor and one visitor on each day it was observed.
- Retain daily deduplication hashes for seven UTC days, including today, to
  accept delayed events. Older batches are blocked and retained, never silently
  dropped or added as unverified unique visitors. Alert before this boundary.
  The authority keeps lifetime deduplication hashes for 372 days after last
  seen (the existing 366-day expiry plus six delayed UTC dates). This covers
  valid cookies collected just before expiry but delivered later. Cookie
  lifetime is unchanged; load reports carry no visitor hash. DNT, GPC and
  opt-out rules remain unchanged.
- Freeze the China legacy baseline atomically when collection switches to the
  queue. Import it once under its immutable digest. Refuse ambiguous historical
  deduplication or attribution instead of guessing. Preserve the original
  snapshot outside the live counting tables for recovery. The initial importer
  accepts only the observed single-browser, single-day China baseline (or an
  empty store), with daily identities still available on both sides. Larger
  or already-retired histories require explicit reconciliation before import.
- Sync and migration endpoints require existing trusted peer or local admin
  credentials. Never expose visitor hashes publicly or put them in logs.
- Unknown visitor locations remain unknown; the collector's server location
  is not evidence of a visitor's country.
- Reverting program code must preserve the baseline, pending events, receipts,
  sequence and cached summary. After activation, do not deploy a version that
  cannot collect the durable stream; route new traffic to the authority first.
