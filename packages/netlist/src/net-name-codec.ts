export type NetlistFormat = "spice" | "spectre";
export type NetlistNamingProfile = "native" | "cadence-bang";

export type EncodedNetName =
  | { ok: true; token: string; collisionKey: string }
  | { ok: false; code: string; message: string };

const NGSPICE_TOKEN = /^[A-Za-z0-9_!+./:$-]+$/u;
const SPECTRE_PLAIN_TOKEN = /^[A-Za-z0-9_!]+$/u;
const SPECTRE_ESCAPABLE = new Set([
  "+",
  "-",
  ".",
  "/",
  ":",
  "<",
  ">",
  "[",
  "]",
]);
const SPECTRE_RESERVED = new Set([
  "ends",
  "global",
  "parameters",
  "simulator",
  "subckt",
]);

function profileSpelling(
  name: string,
  scope: "local" | "global",
  profile: NetlistNamingProfile,
): string {
  if (
    profile !== "cadence-bang" ||
    scope !== "global" ||
    name === "0" ||
    name.endsWith("!")
  ) {
    return name;
  }
  return `${name}!`;
}

function encodeNgspice(name: string): EncodedNetName {
  if (!NGSPICE_TOKEN.test(name)) {
    return {
      ok: false,
      code: "UNREPRESENTABLE_NGSPICE_NET_NAME",
      message: `Net name ${name} contains characters that ngspice cannot safely read as one node token`,
    };
  }
  return { ok: true, token: name, collisionKey: name.toLowerCase() };
}

function encodeSpectre(name: string): EncodedNetName {
  if (SPECTRE_RESERVED.has(name.toLowerCase())) {
    return {
      ok: false,
      code: "RESERVED_SPECTRE_NET_NAME",
      message: `Net name ${name} is reserved by Spectre`,
    };
  }
  if (SPECTRE_PLAIN_TOKEN.test(name)) {
    return { ok: true, token: name, collisionKey: name };
  }
  let token = "";
  for (const character of name) {
    if (/[A-Za-z0-9_!]/u.test(character)) {
      token += character;
    } else if (SPECTRE_ESCAPABLE.has(character)) {
      token += `\\${character}`;
    } else {
      return {
        ok: false,
        code: "UNREPRESENTABLE_SPECTRE_NET_NAME",
        message: `Net name ${name} contains a character without a supported Spectre escape`,
      };
    }
  }
  return { ok: true, token, collisionKey: token };
}

/** Pure dialect projection for one semantic Net name and scope. */
export function encodeNetName(
  name: string,
  scope: "local" | "global",
  format: NetlistFormat,
  profile: NetlistNamingProfile = "native",
): EncodedNetName {
  const spelling = profileSpelling(name.trim(), scope, profile);
  if (!spelling) {
    return {
      ok: false,
      code: "EMPTY_NET_NAME",
      message: "Net name is empty",
    };
  }
  if (spelling === "0") {
    return { ok: true, token: "0", collisionKey: "0" };
  }
  return format === "spice" ? encodeNgspice(spelling) : encodeSpectre(spelling);
}

export function encodedNetNameCollisionKey(
  token: string,
  format: NetlistFormat,
): string {
  return format === "spice" ? token.toLowerCase() : token;
}
