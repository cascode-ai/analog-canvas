# Arrays and ladders

Owner: Agent reasoning. Strength: guidance. Trigger: repeated weighted, tapped,
or serial branches supported by connectivity or parameters.

## Evidence

- repeated branches have the same connectivity shape with systematic parameter,
  count, bit, weight, or tap variation;
- adjacent elements form a serial ladder or repeated shunt/tap relationship;
- switch controls or formal boundary terminals provide an ordering independent
  of Instance References;
- boundary Nets reveal shared top/bottom plates, references, terminations, or
  output summing nodes.

## Counterevidence and variants

Matching symbols do not prove an array. Dummy elements, common-mode branches,
split arrays, bridge capacitors, attenuation sections, parasitic models, or
calibration trims may intentionally break the pattern. Equal visual spacing must
not erase binary weight, segmentation, tap direction, or switched connectivity.

## Expression

Lay repeated units on a stable row or column and order them by evidenced bit,
weight, stage, or physical tap direction. Use consistent branch geometry and a
clear shared trunk/plate/rail. Show ratios or multiplicity in labels. Place bridge,
termination, dummy, or common-mode elements where their exceptional role is
obvious. Hierarchically represent a repeated unit only when its formal terminals
remain clear and the parent still exposes array order and weighting.

When a single row/column becomes much wider or taller than the useful page,
wrap it into a compact matrix while keeping explicit reading order and identical
local geometry. A compact 2-D arrangement may be clearer than preserving one
very long axis.

For repeated hierarchical units, make shared input, supply, bias, clock, or
reference relations visible through the least cluttered of a real trunk, a
clear boundary convention, or attached local labels. Do not combine a full
shared trunk with redundant labels at every pin. A visually regular block row
with unexplained stubs is incomplete, but a mechanically over-labeled row is not
better. Keep tap routes direct; avoid large U-shaped detours when a short
orthogonal branch can expose the same order.

## Near miss

A bag of equal capacitors connected to unrelated Nets is not a capacitor array.
Do not invent a bit order from identifiers or coordinates.
