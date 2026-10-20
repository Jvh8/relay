import { lookup } from "node:dns/promises";

const ALLOWED_PORTS = new Set([80, 443, 8000, 8080, 8443, 8888]);

export class RelayError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "RelayError";
    this.status = status;
  }
}

export async function assertPublicTarget(target: URL): Promise<void> {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new RelayError("Only web addresses can be opened.");
  }
  if (target.username || target.password) {
    throw new RelayError("Remove the username and password from the address.");
  }

  const port =
    target.port === "" ? (target.protocol === "https:" ? 443 : 80) : Number(target.port);
  if (!ALLOWED_PORTS.has(port)) {
    throw new RelayError("That port is not open on this relay.");
  }

  const hostname = target.hostname.replace(/^\[|\]$/g, "");
  if (!hostname || hostname.length > 253) {
    throw new RelayError("That address is not allowed.");
  }
  if (isBlockedHostname(hostname)) {
    throw new RelayError("Private and local addresses are refused.");
  }
  if (isIpLiteral(hostname)) return;

  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
      throw new RelayError("That host did not resolve.", 502);
    }
    throw new RelayError("Could not check that host.", 502);
  }
  if (records.length === 0) throw new RelayError("That host did not resolve.", 502);
  for (const record of records) {
    if (isBlockedHostname(record.address)) {
      throw new RelayError("Private and local addresses are refused.");
    }
  }
}

export function isSelfRelay(target: URL): boolean {
  return target.pathname.includes("/relay/http");
}

function isIpLiteral(hostname: string): boolean {
  return parseV4(hostname) !== null || hostname.includes(":");
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localdomain")
  ) {
    return true;
  }
  const v4 = parseV4(host);
  if (v4) return isPrivateV4(v4);
  if (host.includes(":")) return isPrivateV6(host);
  return false;
}

function parseV4(host: string): [number, number, number, number] | null {
  if (host.includes(":")) return null;
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  if (!parts.every((part) => /^\d+$/.test(part))) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffffffff)) return null;

  let octets: number[];
  if (parts.length === 1) {
    const n = nums[0] ?? 0;
    octets = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  } else if (parts.length === 2) {
    const n = nums[1] ?? 0;
    octets = [nums[0] ?? 0, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  } else if (parts.length === 3) {
    const n = nums[2] ?? 0;
    octets = [nums[0] ?? 0, nums[1] ?? 0, (n >>> 8) & 255, n & 255];
  } else {
    octets = nums;
  }
  if (octets.some((n) => n > 255)) return null;
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
}

function isPrivateV4(octets: [number, number, number, number]): boolean {
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateV6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe80:") || normalized.startsWith("fec0:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) {
    const v4 = parseV4(mapped[1]);
    return v4 ? isPrivateV4(v4) : true;
  }
  return false;
}
