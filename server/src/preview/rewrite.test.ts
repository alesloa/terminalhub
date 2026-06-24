import { describe, it, expect } from "vitest";
import { previewRewriteUrl, prefixPreviewHtml, prefixModuleSpecifiers, prefixAssetUrls } from "./rewrite.js";

const PREVIEW_REFERER = "https://terminal.example.com/api/preview/3396/app/la-vaka";
const TERMINALHUB_REFERER = "https://terminal.example.com/";

describe("previewRewriteUrl", () => {
  it("re-prefixes an origin-root asset to the port from the preview Referer", () => {
    // The app's HTML referenced /assets/app.css by absolute path; the browser fetched it from the
    // origin root. The Referer says it came from inside the :3396 preview iframe, so route it there.
    expect(previewRewriteUrl("/assets/app.css", PREVIEW_REFERER)).toBe("/api/preview/3396/assets/app.css");
  });

  it("preserves the query string when re-prefixing", () => {
    expect(previewRewriteUrl("/api/data?id=7", PREVIEW_REFERER)).toBe("/api/preview/3396/api/data?id=7");
  });

  it("leaves an already-targeted /api/preview/ request untouched (no double-prefix)", () => {
    expect(previewRewriteUrl("/api/preview/3396/assets/app.css", PREVIEW_REFERER)).toBe("/api/preview/3396/assets/app.css");
  });

  it("leaves a request with no Referer untouched (terminalhub's own boot/navigation)", () => {
    expect(previewRewriteUrl("/assets/index.js", undefined)).toBe("/assets/index.js");
  });

  it("leaves a request whose Referer is a normal terminalhub page untouched", () => {
    expect(previewRewriteUrl("/assets/index.js", TERMINALHUB_REFERER)).toBe("/assets/index.js");
  });

  it("never throws on a malformed Referer", () => {
    expect(previewRewriteUrl("/x", "::::not a url::::")).toBe("/x");
  });
});

describe("prefixPreviewHtml", () => {
  const P = "/api/preview/3090";

  it("prefixes a root-absolute <script src> so the browser loads it under the preview prefix", () => {
    const out = prefixPreviewHtml(`<script type="module" src="/src/main.tsx"></script>`, P);
    expect(out).toContain(`src="/api/preview/3090/src/main.tsx"`);
  });

  it("prefixes the Vite client script and a <link href>", () => {
    const out = prefixPreviewHtml(`<script type="module" src="/@vite/client"></script><link rel="stylesheet" href="/style.css">`, P);
    expect(out).toContain(`src="/api/preview/3090/@vite/client"`);
    expect(out).toContain(`href="/api/preview/3090/style.css"`);
  });

  it("prefixes an absolute ES-module specifier in an inline script (the react-refresh preamble)", () => {
    const out = prefixPreviewHtml(`<script type="module">import R from "/@react-refresh"</script>`, P);
    expect(out).toContain(`import R from "/api/preview/3090/@react-refresh"`);
  });

  it("injects a <base> so the previewed app's relative URLs resolve under the prefix too", () => {
    const out = prefixPreviewHtml(`<html><head><title>x</title></head></html>`, P);
    expect(out).toContain(`<base href="/api/preview/3090/">`);
  });

  it("injects a prefix-strip script that runs before module scripts so the app's router sees real paths", () => {
    const out = prefixPreviewHtml(`<html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>`, P);
    expect(out).toContain(`history.replaceState`);
    expect(out).toContain(`"/api/preview/3090"`);
    // The strip must come before any module script (it's a classic <script>; modules are deferred,
    // but ordering it first in <head> is the clearest guarantee).
    expect(out.indexOf("replaceState")).toBeLessThan(out.indexOf('type="module"'));
  });

});

describe("prefixModuleSpecifiers", () => {
  const P = "/api/preview/3090";

  it("prefixes absolute import/export specifiers so a module's children stay under the prefix", () => {
    const js = [
      `import React from "/node_modules/.vite/deps/react.js?v=ca60a18a";`,
      `import { router } from "/src/router.tsx?t=1";`,
      `import "/src/index.css";`,
      `export { x } from "/src/util.ts";`,
      `const c = import("/src/lazy.tsx");`,
    ].join("\n");
    const out = prefixModuleSpecifiers(js, P);
    expect(out).toContain(`from "/api/preview/3090/node_modules/.vite/deps/react.js?v=ca60a18a"`);
    expect(out).toContain(`from "/api/preview/3090/src/router.tsx?t=1"`);
    expect(out).toContain(`import "/api/preview/3090/src/index.css"`);
    expect(out).toContain(`from "/api/preview/3090/src/util.ts"`);
    expect(out).toContain(`import("/api/preview/3090/src/lazy.tsx")`);
  });

  it("leaves non-import string literals, protocol-relative and already-prefixed specifiers alone", () => {
    expect(prefixModuleSpecifiers(`fetch("/api/data")`, P)).toBe(`fetch("/api/data")`);
    expect(prefixModuleSpecifiers(`import x from "//cdn/a.js"`, P)).toBe(`import x from "//cdn/a.js"`);
    expect(prefixModuleSpecifiers(`import x from "/api/preview/3090/src/a.js"`, P)).toBe(`import x from "/api/preview/3090/src/a.js"`);
  });
});

describe("prefixAssetUrls", () => {
  const P = "/api/preview/3090";

  it("prefixes root-absolute public-asset URL literals (img src etc.) so they resolve through the proxy", () => {
    expect(prefixAssetUrls(`{ src: "/variants/v10/hero.jpg" }`, P)).toBe(`{ src: "/api/preview/3090/variants/v10/hero.jpg" }`);
    expect(prefixAssetUrls(`url("/landing/bg.webp")`, P)).toBe(`url("/api/preview/3090/landing/bg.webp")`);
    expect(prefixAssetUrls(`"/fonts/x.woff2?v=2"`, P)).toBe(`"/api/preview/3090/fonts/x.woff2?v=2"`);
  });

  it("ignores external, protocol-relative, already-prefixed, and non-asset (.js/.json/route) strings", () => {
    expect(prefixAssetUrls(`"https://cdn/x.png"`, P)).toBe(`"https://cdn/x.png"`);
    expect(prefixAssetUrls(`"//cdn/x.png"`, P)).toBe(`"//cdn/x.png"`);
    expect(prefixAssetUrls(`"/api/preview/3090/a.png"`, P)).toBe(`"/api/preview/3090/a.png"`);
    expect(prefixAssetUrls(`fetch("/api/orders")`, P)).toBe(`fetch("/api/orders")`);
    expect(prefixAssetUrls(`to="/owner/qr"`, P)).toBe(`to="/owner/qr"`);
  });

  it("leaves external (https) and protocol-relative URLs alone", () => {
    const html = `<link href="https://cdn.example.com/a.css"><script src="//cdn.example.com/b.js"></script>`;
    expect(prefixPreviewHtml(html, P)).toBe(html);
  });

  it("does not double-prefix a URL already under the preview prefix", () => {
    const out = prefixPreviewHtml(`<script src="/api/preview/3090/src/main.tsx"></script>`, P);
    expect(out).not.toContain(`/api/preview/3090/api/preview/3090`);
  });
});
