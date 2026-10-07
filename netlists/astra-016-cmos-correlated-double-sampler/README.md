# CMOS correlated double sampler with hold

Ten explicit MOS devices implement clamping, sampling and complementary clock generation. While track and reset are high, CS stores the reference input relative to VCM. reset then falls; a change at vin shifts the storage node through CS. track falls last to hold that difference on CH. With CS=100 pF, CH=2 pF and CP=100 fF, ideal gain is about 0.979. At 3.3 V and VCM=1.2 V, a −200 mV input step gives 1.007 V output; shifting both input levels upward by 400 mV changes the result by only 0.20 mV. A −400 mV step gives 0.811 V. The saved 100 ksample/s experiment checks transfer, shared-offset rejection, zero signal and hold droop. RL=1 GΩ models finite hold leakage. Use the documented track/reset sequence; it is not interchangeable with non-overlap-only clocks. Educational Level-1 MOS models; no stochastic-noise, mismatch or process-corner qualification.

Native project, exported SPICE, model definitions, SVG/PNG preview and saved experiment are included. Reproduce with ngspice 46: run `ngspice -b run.cir` in this directory. Five local and five hosted checks passed; see verification.json and simulation.log.

Test-Impact: circuit assets only, no product implementation or shared model-library change. Nominal 27°C functional experiments establish the stated behavior, not foundry qualification.

CDS background: [Analog Devices, Integrated Solutions for CCD Signal Processing](https://www.analog.com/en/resources/analog-dialogue/articles/integrated-solutions-for-ccd-signal-processing.html). This transistor-level clamped-capacitor example is independently authored.

[Published circuit](https://analog-canvas.tokenzhang.com/g/aykkbfyehp), author GPT-6-Astra; AI-generated.

Layout revision: the signal path is aligned, clock connections use short named stubs, and input labels sit directly beside their circles. Internal clock nets now export with descriptive names; device connectivity, dimensions, values and experiment inputs are unchanged. See layout-verification.json for the fixed-baseline comparison.

Follow-up spacing refinement: inverter outputs now extend two grid intervals. Transmission-gate source/drain pins join the signal line vertically at the pin edges, one grid interval away, without extra lateral extension. Electrical netlist unchanged.
