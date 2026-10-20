import { cookieHeaderForHost, rewriteSetCookie } from "@/lib/relay/cookies";
import { assertPublicTarget, isSelfRelay, RelayError } from "@/lib/relay/guard";
import { sanitizePrefix, upstreamFromRelayPath } from "@/lib/relay/paths";
import { rewriteCss, rewriteHtml } from "@/lib/relay/rewrite";

const MAX_TEXT = 8_000_000;
const MAX_BODY = 8_000_000;
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const DROP_RESPONSE = new Set([
  "alt-svc",
  "connection",
  "content-encoding",
  "content-length",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "keep-alive",
  "nel",
  "permissions-policy",
  "proxy-authenticate",
  "public-key-pins",
  "report-to",
  "set-cookie",
  "strict-transport-security",
  "transfer-encoding",
  "x-frame-options",
]);

export async function handleRelay(request: Request): Promise<Response> {
  const prefix = sanitizePrefix(readCookie(request.headers.get("cookie"), "nl-base"));
  const current = new URL(request.url);
  const target = upstreamFromRelayPath(current.pathname, current.search);
  if (!target) {
    return errorResponse("This relay address is incomplete.", "Open a full http or https address.", 400);
  }

  try {
    await assertPublicTarget(target);
    if (isSelfRelay(target)) throw new RelayError("That address loops back into the relay.");
    return await proxy(request, target, prefix);
  } catch (error) {
    if (error instanceof RelayError) return errorResponse("Page refused", error.message, error.status);
    console.error("[northline]", target.host, error instanceof Error ? error.message : "failed");
    return errorResponse("The page did not load", "The site did not answer the relay.", 502);
  }
}

async function proxy(request: Request, target: URL, prefix: string): Promise<Response> {
  const method = request.method.toUpperCase();
  const headers = new Headers();
  headers.set("user-agent", readCookie(request.headers.get("cookie"), "nl-ua") === "mobile" ? MOBILE_UA : DESKTOP_UA);
  headers.set("accept-encoding", "identity");
  const accept = request.headers.get("accept");
  const language = request.headers.get("accept-language");
  if (accept) headers.set("accept", accept);
  if (language) headers.set("accept-language", language);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const range = request.headers.get("range");
  if (range) headers.set("range", range);
  headers.set("origin", target.origin);
  headers.set("referer", target.href);
  const cookies = cookieHeaderForHost(request.headers.get("cookie"), target.host);
  if (cookies) headers.set("cookie", cookies);

  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY) {
      return errorResponse("Upload too large", "That form is larger than this relay accepts.", 413);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new RelayError(timedOut ? "The site took too long to answer." : "The site did not answer the relay.", 502);
  }

  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  const rewrittenCookies = setCookies
    .map((cookie) => rewriteSetCookie(cookie, target, prefix))
    .filter((cookie): cookie is string => Boolean(cookie));

  if ([301, 302, 303, 307, 308].includes(upstream.status)) {
    const location = upstream.headers.get("location");
    if (!location) return errorResponse("Redirect missing", "The site redirected without a destination.", 502);
    const next = new URL(location, target);
    await assertPublicTarget(next);
    if (isSelfRelay(next)) throw new RelayError("That redirect loops back into the relay.");
    const headersOut = new Headers();
    headersOut.set("location", `${prefix}${locationHeader(next)}`);
    headersOut.set("cache-control", "no-store");
    headersOut.set("x-robots-tag", "noindex");
    for (const cookie of rewrittenCookies) headersOut.append("set-cookie", cookie);
    return new Response(null, { status: upstream.status, headers: headersOut });
  }

  const responseType = upstream.headers.get("content-type") ?? "";
  const kind = mediaKind(responseType);
  const headersOut = cleanHeaders(upstream.headers);
  headersOut.set("cache-control", "private, no-store");
  headersOut.set("referrer-policy", "no-referrer");
  headersOut.set("x-content-type-options", "nosniff");
  headersOut.set("x-robots-tag", "noindex");
  for (const cookie of rewrittenCookies) headersOut.append("set-cookie", cookie);

  if (method === "HEAD" || upstream.status === 204 || upstream.status === 304) {
    return new Response(null, { status: upstream.status, headers: headersOut });
  }

  if (kind === "other") {
    return new Response(upstream.body, { status: upstream.status, headers: headersOut });
  }

  const buffer = await upstream.arrayBuffer();
  if (buffer.byteLength > MAX_TEXT) {
    return errorResponse("Page too large", "This page is too large to rewrite.", 413);
  }
  const text = decodeBuffer(buffer, responseType);
  const output =
    kind === "html"
      ? rewriteHtml(text, target, prefix)
      : rewriteCss(text, target, prefix, false);
  headersOut.set("content-type", withUtf8(kind === "html" ? "text/html" : "text/css"));
  return new Response(output, { status: upstream.status, headers: headersOut });
}

function locationHeader(target: URL): string {
  const proto = target.protocol === "http:" ? "http" : "https";
  return `/relay/${proto}/${target.host}${target.pathname}${target.search}${target.hash}`;
}

function mediaKind(contentType: string): "html" | "css" | "other" {
  const value = contentType.toLowerCase();
  if (value.includes("text/html") || value.includes("application/xhtml")) return "html";
  if (value.includes("text/css")) return "css";
  return "other";
}

function cleanHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (DROP_RESPONSE.has(key.toLowerCase())) return;
    headers.append(key, value);
  });
  return headers;
}

function withUtf8(contentType: string): string {
  if (/charset=/i.test(contentType)) return contentType.replace(/charset=[^;]+/i, "charset=utf-8");
  return `${contentType}; charset=utf-8`;
}

function decodeBuffer(buffer: ArrayBuffer, contentType: string): string {
  const match = /charset=([^;\s]+)/i.exec(contentType);
  let charset = match?.[1]?.replace(/["']/g, "").toLowerCase() ?? "utf-8";
  if (charset === "latin1" || charset === "iso-8859-1") charset = "windows-1252";
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function errorResponse(title: string, message: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0e0f11;color:#eceae4;font:16px/1.5 Outfit,system-ui,sans-serif"><main style="max-width:28rem;padding:32px"><h1 style="margin:0;font:500 32px/1.1 Georgia,serif">${escapeHtml(title)}</h1><p style="margin:12px 0 0;color:#9a9690">${escapeHtml(message)}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
