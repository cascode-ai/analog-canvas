# Gallery red-line corpus

Snapshots of real published Gallery documents, used by
`packages/edit-engine/src/conductor-topology-redline.test.ts` to assert one
invariant: **same-Net conductor canonicalization never changes terminal
connectivity**. A failure there means canonicalization altered real users'
circuits.

These are fixtures, not live data: the test never touches the network. The
snapshot was taken 2026-08-31 from `https://analog-canvas.tokenzhang.com`.

## Why these six

A representative subset instead of the full wall (119 entries, ~5MB), chosen
for pathology and coverage, ~410KB total:

| File | Entry | Why it is here |
| --- | --- | --- |
| `ycg43babwa` | LTC3452 | The original feedback pathology: six-route collinear tangles, an opposite-direction duplicate redraw, bend-tail overlaps. |
| `3tfmrzevfe` | deadtime | Heaviest branch-vertex materialization in the corpus (four new canonical junctions). |
| `b5cn37k3a9` | widlar | Mixed coalescing and materialization in one small hand-drawn document. |
| `2rmm2vb45f` | Switched_Capacitor_DAC_6bit | SPICE-import provenance — geometry produced by the importer, not the wire tool. |
| `7sxpwb4am7` | Figure 17.19(b) | Multi-document project — hierarchy exercises the per-document walk. |
| `f22q5vhdb5` | suppression of skew | Control: canonicalization changes nothing here, guarding against a pass that "always finds something". |

## Refreshing the snapshot

```bash
node scripts/refresh-gallery-redline.mjs
```

The script re-fetches exactly these entry ids from the public Gallery API and
rewrites the `.icproj.json` files. Refresh deliberately keeps the same ids: the
value of the corpus is that these documents are known-pathological; swap an id
only when a document is deleted upstream, and record the replacement's
pathology in the table above.
