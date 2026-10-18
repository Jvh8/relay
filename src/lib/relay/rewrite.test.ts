import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rewriteSetCookie, cookieHeaderForHost } from "./cookies.ts";
import { isBlockedHostname } from "./guard.ts";
import { destinationFromInput, upstreamFromRelayPath } from "./paths.ts";
import { rewriteCss, rewriteHtml } from "./rewrite.ts";

const page = new URL("https://en.wikipedia.org/wiki/Main_Page");

describe("rewrite", () => {
  it("rewrites rooted and absolute urls and leaves relative ones", () => {
    const html = `<!doctype html><html><head><title>T</title></head><body>
      <a href="/wiki/Cat">c</a>
      <a href="Next">n</a>
      <a href="https://other.test/a?x=1&y=2">o</a>
      <img src="//cdn.test/a.png" srcset="/img/a.png 1x, b.png 2x">
      <a href="#frag">f</a>
    </body></html>`;
    const out = rewriteHtml(html, page, "");
    assert.match(out, /href="\/relay\/https\/en\.wikipedia\.org\/wiki\/Cat"/);
    assert.match(out, /href="Next"/);
    assert.match(out, /href="\/relay\/https\/other\.test\/a\?x=1&amp;y=2"/);
    assert.match(out, /src="\/relay\/https\/cdn\.test\/a\.png"/);
    assert.match(out, /srcset="\/relay\/https\/en\.wikipedia\.org\/img\/a\.png 1x, b.png 2x"/);
    assert.match(out, /href="#frag"/);
    assert.match(out, /data-nl-bridge/);
    assert.match(out, /<head[^>]*><script data-nl-bridge>/);
  });

  it("resolves relative urls when a base tag is present", () => {
    const out = rewriteHtml(`<head></head><base href="https://cdn.test/app/"><a href="Next">n</a>`, page, "");
    assert.match(out, /href="\/relay\/https\/cdn\.test\/app\/Next"/);
    assert.doesNotMatch(out, /<base\b/i);
  });

  it("prefixes relay urls for path-based previews", () => {
    const out = rewriteHtml(`<a href="/wiki/Cat">c</a>`, page, "/hds-abc-8080-def");
    assert.match(out, /href="\/hds-abc-8080-def\/relay\/https\/en\.wikipedia\.org\/wiki\/Cat"/);
  });

  it("rewrites css rooted and absolute urls only", () => {
    const css = rewriteCss(
      "a{background:url(/a.png)} b{background:url(b.png)} c{background:url(https://x.test/c.png)}",
      new URL("https://ex.test/s.css"),
      "",
      false,
    );
    assert.match(css, /url\("\/relay\/https\/ex\.test\/a\.png"\)/);
    assert.match(css, /url\(b\.png\)/);
    assert.match(css, /url\("\/relay\/https\/x\.test\/c\.png"\)/);
  });
});

describe("paths", () => {
  it("parses a relay path and a search", () => {
    const url = upstreamFromRelayPath("/relay/https/example.com/docs", "?q=1");
    assert.equal(url?.href, "https://example.com/docs?q=1");
  });

  it("sends words to search and hosts to https", () => {
    assert.equal(destinationFromInput("example.com/a"), "https://example.com/a");
    assert.match(destinationFromInput("northern lights") ?? "", /html\.duckduckgo\.com\/html\/\?q=northern%20lights/);
  });
});

describe("guard", () => {
  it("blocks private and local names", () => {
    assert.equal(isBlockedHostname("127.0.0.1"), true);
    assert.equal(isBlockedHostname("10.1.2.3"), true);
    assert.equal(isBlockedHostname("169.254.169.254"), true);
    assert.equal(isBlockedHostname("2130706433"), true);
    assert.equal(isBlockedHostname("::1"), true);
    assert.equal(isBlockedHostname("localhost"), true);
    assert.equal(isBlockedHostname("example.com"), false);
    assert.equal(isBlockedHostname("1.1.1.1"), false);
  });
});

describe("cookies", () => {
  it("scopes upstream cookies onto the relay path", () => {
    const header = rewriteSetCookie("session=abc; Path=/; HttpOnly", new URL("https://example.com/a"), "");
    assert.equal(header, "nl_example.com_session=abc; Path=/relay/https/example.com/; SameSite=Lax; HttpOnly");
    assert.equal(
      cookieHeaderForHost("nl_example.com_session=abc; nl-base=", "example.com"),
      "session=abc",
    );
  });
});
