import { BRIDGE_SCRIPT } from "./bridge.ts";
import { toProxyPath } from "./paths.ts";

const URL_ATTRS = new Set([
  "href",
  "src",
  "action",
  "poster",
  "formaction",
  "cite",
  "background",
  "data",
  "xlink:href",
  "data-src",
  "data-href",
  "data-lazy-src",
  "data-original",
  "data-url",
]);

const SRCSET_ATTRS = new Set(["srcset", "imagesrcset", "data-srcset"]);
const DROP_ATTRS = new Set(["integrity", "nonce", "ping"]);
const RAW_TAGS = new Set(["script", "style", "textarea", "title"]);

export function rewriteHtml(html: string, pageUrl: URL, prefix: string): string {
  const found = extractBase(html, pageUrl);
  let out = "";
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      if (end === -1) {
        out += html.slice(i);
        break;
      }
      out += html.slice(i, end + 3);
      i = end + 3;
      continue;
    }
    if (html.startsWith("<!", i) || html.startsWith("<?", i)) {
      const end = html.indexOf(">", i);
      if (end === -1) {
        out += html.slice(i);
        break;
      }
      out += html.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (html[i] !== "<") {
      const next = html.indexOf("<", i);
      if (next === -1) {
        out += html.slice(i);
        break;
      }
      out += html.slice(i, next);
      i = next;
      continue;
    }

    const tag = readTag(html, i);
    if (!tag) {
      out += html[i];
      i += 1;
      continue;
    }
    if (tag.closing) {
      out += tag.raw;
      i = tag.end;
      continue;
    }

    const lower = tag.name.toLowerCase();
    if (lower === "base") {
      i = tag.end;
      continue;
    }

    const rewritten = rewriteOpenTag(tag, found.base, prefix, found.rewriteRelative);
    if (rewritten === null) {
      i = tag.end;
      continue;
    }

    if (RAW_TAGS.has(lower) && !tag.selfClosing) {
      const close = findClose(html, tag.end, lower);
      let inner = html.slice(tag.end, close.innerEnd);
      if (lower === "style") inner = rewriteCss(inner, found.base, prefix, found.rewriteRelative);
      out += rewritten + inner + html.slice(close.innerEnd, close.end);
      i = close.end;
      continue;
    }

    out += rewritten;
    i = tag.end;
  }

  return injectBridge(out);
}

export function rewriteCss(
  css: string,
  base: URL,
  prefix: string,
  rewriteRelative: boolean,
): string {
  const urls = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _quote, inner: string) => {
    const next = rewriteUrl(inner.trim(), base, prefix, rewriteRelative);
    if (!next) return full;
    return `url("${next.replace(/"/g, "%22")}")`;
  });
  return urls.replace(/@import\s+(['"])([^'"]+)\1/gi, (full, quote: string, inner: string) => {
    const next = rewriteUrl(inner.trim(), base, prefix, rewriteRelative);
    if (!next) return full;
    return `@import ${quote}${next}${quote}`;
  });
}

export function rewriteUrl(
  value: string,
  base: URL,
  prefix: string,
  rewriteRelative: boolean,
): string | null {
  const raw = decodeEntities(value).trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("?") || /[\s<>]/.test(raw)) return null;
  if (/^(data|blob|javascript|mailto|tel|about|sms):/i.test(raw)) return null;

  if (prefix && raw.startsWith(`${prefix}/relay/`)) return null;
  if (raw.startsWith("/relay/http")) return `${prefix}${raw}`;

  const absolute = raw.startsWith("//") || /^https?:/i.test(raw);
  const rooted = raw.startsWith("/");
  if (!absolute && !rooted && !rewriteRelative) return null;

  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const relayAt = url.pathname.indexOf("/relay/http");
  if (relayAt !== -1) {
    return `${prefix}${url.pathname.slice(relayAt)}${url.search}${url.hash}`;
  }
  return `${prefix}${toProxyPath(url)}`;
}

function extractBase(html: string, page: URL): { base: URL; rewriteRelative: boolean } {
  const match = html.match(/<base\b[^>]*>/i);
  if (!match) return { base: page, rewriteRelative: false };
  const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
  const value = decodeEntities(href?.[1] ?? href?.[2] ?? href?.[3] ?? "");
  if (!value) return { base: page, rewriteRelative: true };
  try {
    return { base: new URL(value, page), rewriteRelative: true };
  } catch {
    return { base: page, rewriteRelative: true };
  }
}

function rewriteOpenTag(
  tag: Tag,
  base: URL,
  prefix: string,
  rewriteRelative: boolean,
): string | null {
  const lower = tag.name.toLowerCase();
  const attrs = readAttrs(tag.attrs);
  if (lower === "meta" && shouldDropMeta(attrs)) return null;

  const next: Attr[] = [];
  for (const attr of attrs) {
    const name = attr.name.toLowerCase();
    if (DROP_ATTRS.has(name)) continue;
    if (attr.value == null) {
      next.push(attr);
      continue;
    }
    let value = decodeEntities(attr.value);
    if (lower === "meta" && name === "charset") value = "utf-8";
    if (lower === "meta" && name === "content") value = rewriteMetaContent(attrs, value, base, prefix, rewriteRelative);
    if (name === "style") value = rewriteCss(value, base, prefix, rewriteRelative);
    else if (SRCSET_ATTRS.has(name)) value = rewriteSrcset(value, base, prefix, rewriteRelative);
    else if (URL_ATTRS.has(name) && !(lower === "meta" && name === "content")) {
      const rewritten = rewriteUrl(value, base, prefix, rewriteRelative);
      if (rewritten) value = rewritten;
    }
    if (name === "target" && (value === "_top" || value === "_parent")) value = "_self";
    next.push({ name: attr.name, value });
  }

  const slash = tag.selfClosing ? " /" : "";
  return `<${tag.name}${emitAttrs(next)}${slash}>`;
}

function shouldDropMeta(attrs: Attr[]): boolean {
  const equiv = (attrValue(attrs, "http-equiv") ?? "").toLowerCase();
  return equiv.includes("content-security-policy") || equiv === "x-frame-options";
}

function rewriteMetaContent(
  attrs: Attr[],
  content: string,
  base: URL,
  prefix: string,
  rewriteRelative: boolean,
): string {
  const equiv = (attrValue(attrs, "http-equiv") ?? "").toLowerCase();
  if (equiv === "content-type") return content.replace(/charset\s*=\s*[^;]+/i, "charset=utf-8");
  if (equiv !== "refresh") return content;
  return content.replace(/url\s*=\s*(['"]?)([^'">]+)\1/i, (full, _q, inner: string) => {
    const next = rewriteUrl(inner.trim(), base, prefix, rewriteRelative);
    return next ? `url=${next}` : full;
  });
}

function rewriteSrcset(value: string, base: URL, prefix: string, rewriteRelative: boolean): string {
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      const match = /^(\S+)([\s\S]*)$/.exec(trimmed);
      if (!match) return trimmed;
      const next = rewriteUrl(match[1] ?? "", base, prefix, rewriteRelative);
      if (!next) return trimmed;
      return `${next}${match[2] ?? ""}`;
    })
    .join(", ");
}

type Attr = { name: string; value: string | null };
type Tag = { raw: string; name: string; attrs: string; end: number; closing: boolean; selfClosing: boolean };

function readTag(html: string, index: number): Tag | null {
  if (html[index] !== "<") return null;
  const closing = html[index + 1] === "/";
  let cursor = index + 1 + (closing ? 1 : 0);
  if (!/[A-Za-z]/.test(html[cursor] ?? "")) return null;
  const nameStart = cursor;
  while (cursor < html.length && /[\w:-]/.test(html[cursor] ?? "")) cursor += 1;
  const name = html.slice(nameStart, cursor);
  const attrStart = cursor;
  let quote = "";
  while (cursor < html.length) {
    const char = html[cursor] ?? "";
    if (quote) {
      if (char === quote) quote = "";
      cursor += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      cursor += 1;
      continue;
    }
    if (char === ">") {
      cursor += 1;
      break;
    }
    cursor += 1;
  }
  const raw = html.slice(index, cursor);
  const attrs = html.slice(attrStart, html[cursor - 1] === ">" ? cursor - 1 : cursor);
  return {
    raw,
    name,
    attrs: attrs.replace(/\/\s*$/, ""),
    end: cursor,
    closing,
    selfClosing: /\/\s*>$/.test(raw),
  };
}

function readAttrs(input: string): Attr[] {
  const attrs: Attr[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i] ?? "")) i += 1;
    if (i >= input.length) break;
    const start = i;
    while (i < input.length && /[^\s=]/.test(input[i] ?? "")) i += 1;
    const name = input.slice(start, i);
    if (!name) {
      i += 1;
      continue;
    }
    while (i < input.length && /\s/.test(input[i] ?? "")) i += 1;
    if (input[i] !== "=") {
      attrs.push({ name, value: null });
      continue;
    }
    i += 1;
    while (i < input.length && /\s/.test(input[i] ?? "")) i += 1;
    let value = "";
    const quote = input[i];
    if (quote === '"' || quote === "'") {
      i += 1;
      const valueStart = i;
      while (i < input.length && input[i] !== quote) i += 1;
      value = input.slice(valueStart, i);
      if (input[i] === quote) i += 1;
    } else {
      const valueStart = i;
      while (i < input.length && !/\s/.test(input[i] ?? "")) i += 1;
      value = input.slice(valueStart, i);
    }
    attrs.push({ name, value });
  }
  return attrs;
}

function emitAttrs(attrs: Attr[]): string {
  let out = "";
  for (const attr of attrs) {
    if (attr.value == null) out += ` ${attr.name}`;
    else out += ` ${attr.name}="${escapeAttr(attr.value)}"`;
  }
  return out;
}

function findClose(html: string, from: number, tag: string): { innerEnd: number; end: number } {
  const re = new RegExp(`</${tag}\\s*>`, "i");
  const match = re.exec(html.slice(from));
  if (!match) return { innerEnd: html.length, end: html.length };
  return { innerEnd: from + match.index, end: from + match.index + match[0].length };
}

function attrValue(attrs: Attr[], name: string): string | null {
  const found = attrs.find((attr) => attr.name.toLowerCase() === name);
  return found?.value ?? null;
}

function injectBridge(html: string): string {
  const tag = `<script data-nl-bridge>${BRIDGE_SCRIPT}</script>`;
  const match = /<head\b[^>]*>/i.exec(html);
  if (!match) return tag + html;
  const at = match.index + match[0].length;
  return html.slice(0, at) + tag + html.slice(at);
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
