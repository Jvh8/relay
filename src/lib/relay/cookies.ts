export function cookieNamePrefix(host: string): string {
  return `nl_${host.toLowerCase().replace(/[^a-z0-9.-]/g, "_")}_`;
}

export function scopedCookiePath(upstream: URL, cookiePath: string, prefix: string): string {
  const proto = upstream.protocol === "http:" ? "http" : "https";
  let path = cookiePath.trim() || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  const root = `/relay/${proto}/${upstream.host}`;
  const scoped = path === "/" ? `${root}/` : `${root}${path}`;
  return `${prefix}${scoped}`;
}

export function rewriteSetCookie(raw: string, upstream: URL, prefix: string): string | null {
  if (!raw || /[\r\n]/.test(raw)) return null;
  const parts = splitCookie(raw);
  if (parts.length === 0) return null;
  const first = parts[0] ?? "";
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name || /[\s;]/.test(name)) return null;

  let path = "/";
  let maxAge: string | null = null;
  let expires: string | null = null;
  let httpOnly = false;
  for (const part of parts.slice(1)) {
    const key = part.split("=")[0]?.trim().toLowerCase() ?? "";
    const attr = part.slice(part.indexOf("=") + 1).trim();
    if (key === "path") path = attr || "/";
    else if (key === "max-age" && /^\d+$/.test(attr)) maxAge = attr;
    else if (key === "expires" && !/[\r\n;]/.test(attr)) expires = attr;
    else if (key === "httponly") httpOnly = true;
  }

  const scoped = scopedCookiePath(upstream, path, prefix);
  let out = `${cookieNamePrefix(upstream.host)}${name}=${value}; Path=${scoped}; SameSite=Lax`;
  if (maxAge) out += `; Max-Age=${maxAge}`;
  else if (expires) out += `; Expires=${expires}`;
  if (httpOnly) out += "; HttpOnly";
  return out;
}

export function cookieHeaderForHost(header: string | null, host: string): string {
  if (!header) return "";
  const prefix = cookieNamePrefix(host);
  const pairs: string[] = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name.startsWith(prefix)) pairs.push(`${name.slice(prefix.length)}=${value}`);
  }
  return pairs.join("; ");
}

function splitCookie(raw: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote = "";
  for (const char of raw) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ";") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
