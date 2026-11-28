# Simulation acceptance Projects

The `hosted-*.json` acceptance manifests and `ota-5t*` inputs are retained as
service-level ngspice regression fixtures.

The five bundled ngspice simulation Projects live under
`apps/editor/src/examples/` (31 experiments total):

| Project                             | Experiments | Electrical intent                                                                  |
| ----------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `simulation-rc.icproj.json`         | 4           | Low/high-pass AC and step response; 10 kΩ, 10 nF, 1.59155 kHz cutoff               |
| `simulation-rlc.icproj.json`        | 3           | AC plus transient at under/critical/over damping; 10 mH, 100 nF                    |
| `simulation-common-source.icproj.json` | 4        | SKY130 bias/device OP, DC transfer, AC, small/large-signal transient               |
| `simulation-ota.icproj.json`        | 8           | Preserved user OTA, OP/DC, TT/FF/SS AC, open-loop transient, noise, unity feedback |
| `five-transistor-ota-sky130.icproj.json` | 12     | Library OTA lab: OP/DC, TT/FF/SS/FS/SF AC, pulse and sine transient, noise         |

All 31 experiments use ngspice source and config v2 targeting
`sky130-core-continuous-ngspice46-v1`.
