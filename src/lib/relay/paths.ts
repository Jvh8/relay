const PREVIEW_PREFIX = /^\/hds-[a-z0-9]+-\d+-[a-z0-9]+/i;

export function sanitizePrefix(raw: string | undefined | null): string {
  if (!raw) return "";
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return "";
  }
  if (!/^\/hds-[a-z0-9]+-\d+-[a-z0-9]+$/i.test(value)) return "";
  return value;
}

export function stripPreviewPrefix(pathname: string): string {
  const stripped = pathname.replace(PREVIEW_PREFIX, "");
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

export function toProxyPath(target: string | URL): string {
  const url = typeof target === "string" ? new URL(target) : target;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only web addresses can be opened.");
  }
  if (url.username || url.password) {
    throw new Error("Remove the username and password from the address.");
  }
  const proto = url.protocol === "http:" ? "http" : "https";
  return `/relay/${proto}/${url.host}${url.pathname}${url.search}${url.hash}`;
}

export function upstreamFromRelayPath(pathname: string, search: string): URL | null {
  const path = stripPreviewPrefix(pathname);
  const match = path.match(/^\/relay\/(https?)\/([^/]+)(\/.*)?$/i);
  if (!match) return null;
  const proto = match[1].toLowerCase();
  const host = match[2];
  const rest = match[3] || "/";
  try {
    const url = new URL(`${proto}://${host}${rest}${search}`);
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function upstreamFromLocation(pathname: string, search: string): string | null {
  const url = upstreamFromRelayPath(pathname, search);
  return url ? url.href : null;
}

export function destinationFromInput(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).href;
    } catch {
      return null;
    }
  }
  if (!/\s/.test(text) && /^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(text)) {
    try {
      return new URL(`https://${text}`).href;
    } catch {
      return null;
    }
  }
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(text)}`;
}

export function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}
