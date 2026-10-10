import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { harnessModuleUrl } from "./helpers/harness-url";

// Synthetic numeric evidence, never a user's circuit or historical waveform.
// The large case deliberately has the historical 9,384 x 145 waveform shape.
function evidence(rows: number, signals: number) {
  const values = Array.from({ length: signals }, (_, signal) =>
    Array.from({ length: rows }, (_, row) =>
      signal === 0
        ? row * 0.05e-9
        : Math.sin(row * 0.002 + signal * 0.11) * (1 + signal * 0.001),
    ),
  );
  const csv = [
    Array.from({ length: signals }, (_, index) =>
      index === 0 ? "time" : `V(n${index})`,
    ).join(","),
  ];
  const raw = [
    "Title: Storage acceptance\nPlotname: Transient Analysis\nFlags: real",
    `No. Variables: ${signals}\nNo. Points: ${rows}\nVariables:`,
    ...values.map(
      (_, index) =>
        `\t${index}\t${index === 0 ? "time" : `v(n${index})`}\t${index === 0 ? "time" : "voltage"}`,
    ),
    "Values:",
  ];
  for (let row = 0; row < rows; row++) {
    csv.push(values.map((column) => column[row]!.toExponential(14)).join(","));
    raw.push(
      values
        .map(
          (column, index) =>
            `${index === 0 ? row : ""}\t${column[row]!.toExponential(15)}`,
        )
        .join("\n"),
    );
  }
  return [
    { name: "out.raw", role: "raw", text: raw.join("\n") + "\n" },
    {
      name: "result.json",
      role: "result-json",
      text: JSON.stringify({ analyses: [{ kind: "tran", vectors: values }] }),
    },
    {
      name: "tran-0.csv",
      role: "analysis-csv",
      text: csv.join("\r\n") + "\r\n",
    },
    {
      name: "op-1.csv",
      role: "analysis-csv",
      text: "\uFEFFnode,voltage\r\nvout,0.9\r\n",
    },
    {
      name: "ac-2.csv",
      role: "analysis-csv",
      text: "frequency,V(out).real,V(out).imag\r\n1,2,-3\r\n1000,1,-2\r\n",
    },
    {
      name: "dc-3.csv",
      role: "analysis-csv",
      text: "sweep,V(out)\r\n0,0\r\n1,0.95\r\n",
    },
    {
      name: "noise-4.csv",
      role: "analysis-csv",
      text: "frequency,onoise\r\n1,1e-9\r\n1000,3e-10\r\n",
    },
  ].map((file) => ({
    ...file,
    bytes: Buffer.byteLength(file.text),
    sha256: createHash("sha256").update(file.text).digest("hex"),
  }));
}

for (const large of [false, true]) {
  test(
    large
      ? "Large waveform bundle browser codec benchmark"
      : "Browser codec preserves complete OP/AC/DC/TRAN/Noise evidence",
    async ({ page }, testInfo) => {
      test.skip(
        large && process.env.ICM_EVIDENCE_BENCHMARK !== "1",
        "Opt-in large numeric corpus; never consumes a user's storage.",
      );
      test.setTimeout(120_000);
      const corpus = evidence(large ? 9384 : 1024, large ? 145 : 8);
      await page.route("**/evidence-fixture/*", async (route) => {
        const index = Number(
          new URL(route.request().url()).pathname.split("/").at(-1),
        );
        await route.fulfill({
          contentType: "text/plain",
          body: corpus[index]!.text,
        });
      });
      await page.goto("/editor");
      const session = await page.context().newCDPSession(page);
      await session.send("Performance.enable");
      const heap = async () =>
        (await session.send("Performance.getMetrics")).metrics.find(
          (metric: { name: string; value: number }) =>
            metric.name === "JSHeapUsedSize",
        )?.value ?? 0;
      const baselineHeap = await heap();
      let peakHeap = baselineHeap;
      const sampler = setInterval(() => {
        void heap()
          .then((bytes) => {
            peakHeap = Math.max(peakHeap, bytes);
          })
          .catch(() => {});
      }, 25);
      let result;
      try {
        result = await page.evaluate(
          async ({ artifactUrl, filesUrl, descriptors }) => {
            const { createBrowserSimulationArtifactStore } = await import(
              artifactUrl
            );
            const { SimulationFiles } = await import(filesUrl);
            const projectId = "codec-benchmark";
            const store = createBrowserSimulationArtifactStore(
              projectId,
              indexedDB,
              { compression: true, retainSession: true },
            );
            const files = new SimulationFiles(
              Date.now,
              undefined,
              undefined,
              store,
            );
            let beats = 0;
            const heartbeat = setInterval(() => {
              beats++;
            }, 10);
            const longTasks: number[] = [];
            const observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries())
                longTasks.push(entry.duration);
            });
            observer.observe({ type: "longtask", buffered: false });
            const started = performance.now();
            async function* entries() {
              for (const [index, file] of descriptors.entries()) {
                const response = await fetch("/evidence-fixture/" + index);
                // Fetch.text() removes UTF-8 BOM; the fixture supplies exact bytes.
                const text = new TextDecoder("utf-8", {
                  fatal: true,
                  ignoreBOM: true,
                }).decode(await response.arrayBuffer());
                yield {
                  name: file.name,
                  mediaType: file.name.endsWith("json")
                    ? "application/json"
                    : "text/plain",
                  text,
                  metadata: { role: file.role },
                };
              }
            }
            // Browser store accepts a lazy iterable. SimulationFiles consumes ordinary
            // iterable evidence; prepare each fixture's public identity in its worker.
            const identities: any[] = [];
            async function* bodies() {
              for await (const entry of entries()) {
                const file = descriptors[identities.length];
                if (!file) throw new Error("Missing fixture identity");
                const ref = {
                  id: crypto.randomUUID(),
                  fileId: crypto.randomUUID(),
                  name: file.name,
                  mediaType: entry.mediaType,
                  role: file.role,
                  byteLength: new Blob([entry.text]).size,
                  sha256: await store.digest(entry.text),
                };
                identities.push(ref);
                yield { ref, text: entry.text };
              }
            }
            await store.publishEvidence(bodies(), () => ({
              storedAt: Date.now(),
              catalog: {
                schemaVersion: 1,
                runId: "codec-run",
                preparedId: "prepared",
                inputRevision: "rev",
                execution: "completed",
                collection: "complete",
                retentionPolicy: "cache",
                files: identities,
                datasets: [],
              },
            }));
            const saveMs = performance.now() - started;
            const usage = await files.resourceUsage();
            const readStarted = performance.now();
            const reopened = createBrowserSimulationArtifactStore(
              projectId,
              indexedDB,
            );
            for (const [index, ref] of identities.entries()) {
              const original = descriptors[index];
              if (!original) throw new Error("Missing fixture descriptor");
              const restored = await reopened.get(ref.id);
              if (
                !restored ||
                new Blob([restored.text]).size !== original.bytes ||
                (await reopened.digest(restored.text)) !== original.sha256
              )
                throw new Error("Original evidence changed");
            }
            const readMs = performance.now() - readStarted;
            clearInterval(heartbeat);
            observer.disconnect();
            await store.releaseSession();
            return { saveMs, readMs, beats, longTasks, usage };
          },
          {
            artifactUrl: harnessModuleUrl("browser-simulation-artifact-store"),
            filesUrl: harnessModuleUrl("simulation-files"),
            descriptors: corpus.map(
              ({ text: _text, ...descriptor }) => descriptor,
            ),
          },
        );
      } finally {
        clearInterval(sampler);
        await session.detach();
      }
      const originalBytes = corpus.reduce((sum, file) => sum + file.bytes, 0);
      const report = {
        ...result,
        originalBytes,
        mainThreadBaselineHeap: baselineHeap,
        mainThreadPeakHeap: peakHeap,
        mainThreadPeakIncrease: peakHeap - baselineHeap,
        note: "CDP main-thread JS heap excludes Worker heaps, native Blobs and IndexedDB overhead; these are measured values, not a total-memory cap.",
      };
      await testInfo.attach("evidence-codec-benchmark.json", {
        body: JSON.stringify(report, null, 2),
        contentType: "application/json",
      });
      expect(result.usage.usedBytes).toBeLessThan(originalBytes);
      expect(result.usage.logicalBytes).toBe(originalBytes);
      expect(result.usage.fileCount).toBe(corpus.length);
      expect(result.beats).toBeGreaterThan(0);
      if (large) expect(originalBytes).toBeGreaterThan(80 * 1024 * 1024);
    },
  );
}
