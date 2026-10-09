// Canvas nets are flat identifiers; Aether rejects '/' in native net/term names.
export function withNativeNames(source) {
  const result = structuredClone(source);
  const names = [...new Set([...source.nets, ...source.ports.map((port) => port.name)])];
  const occupied = new Set(names);
  const mapping = new Map();
  for (const name of [...names].sort()) {
    if (!name.includes("/")) continue;
    const base = name.replaceAll("/", "_slash_");
    let target = base;
    for (let suffix = 1; occupied.has(target); suffix++) target = `${base}_${suffix}`;
    occupied.add(target);
    mapping.set(name, target);
  }
  const rewrite = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(rewrite);
      return;
    }
    if (mapping.has(value.netName)) {
      value.sourceNetName = value.netName;
      value.netName = mapping.get(value.netName);
    }
    if ("netName" in value && mapping.has(value.name)) {
      value.sourceTerminalName = value.name;
      value.name = mapping.get(value.name);
    }
    Object.values(value).forEach(rewrite);
  };
  rewrite(result);
  result.nets = source.nets.map((name) => mapping.get(name) ?? name);
  result.nativeNameMap = Object.fromEntries(mapping);
  return result;
}
