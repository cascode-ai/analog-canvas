import type { CircuitProject } from "@icm/model";

/**
 * The author's own SPICE subcircuit `name`, external definition `own-<name>`
 * with its ports in `ports` order, implemented by a model source of the
 * Project.
 */
export function addOwnSubcircuit(
  project: CircuitProject,
  name: string,
  ports: readonly string[],
): void {
  const sourceId = `own-source-${name}`;
  (project.modelSources ??= []).push({
    id: sourceId,
    language: "spice",
    revision: 1,
    entry: `${name}.spice`,
    dependencies: [],
    files: [
      {
        path: `${name}.spice`,
        text: `.subckt ${name} ${ports.join(" ")}\nR1 ${ports[0]} ${ports[1]} 1k\n.ends ${name}\n`,
      },
    ],
  });
  project.externalSubcircuitDefinitions.push({
    id: `own-${name}`,
    name,
    interfaceStatus: "declared",
    formalParameters: [],
    terminals: ports.map((port) => ({
      id: `own-${name}-${port}`,
      name: port,
      direction: "inout" as const,
    })),
    implementation: { kind: "source", sourceId, entry: name },
  });
}
