# Razavi Calibration Tools

These tools support deliberate human review of the accepted Razavi visual
authority. They are not CI gates and never establish electrical correctness.

Build the workspace before running the JavaScript tools:

```powershell
pnpm build
node scripts/calibration/razavi/symbol-fidelity-diff.mjs <target...>
node scripts/calibration/razavi/text-fidelity-diff.mjs --reference <reference.png>
```

`symbol-fidelity-diff.mjs` accepts only manifest-registered Symbol targets. It
does not restore the retired circuit/formal-scene calibration path.

The geometry measurement helper additionally requires Python 3.11+, OpenCV,
and NumPy:

```powershell
python scripts/calibration/razavi/measure-reference.py <reference.png>
```

Generated reports belong under `output/calibration/` and remain untracked.
