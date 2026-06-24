// Origin-root sub-resource recovery for the path-prefix preview proxy.
//
// A host-local app viewed through /api/preview/<port>/… usually references its assets by ABSOLUTE
// path (`/assets/app.css`, `/logo.png`, `/api/data`). The browser resolves those against the ORIGIN
// root, NOT the /api/preview/<port> prefix — so they hit terminalhub (SPA/404) and the page renders
// unstyled with broken images. There's no subdomain or wildcard cert to lean on (by design), so we
// recover the upstream from the Referer: a sub-resource fetched from inside a preview iframe carries
// that iframe's document URL (…/api/preview/<port>/…) as its Referer. Re-prefix those requests so
// they reach the right upstream. Requests without a preview Referer (terminalhub's own assets/API, or a
// fresh navigation) are left untouched, so this never steals terminalhub's own traffic.
//
// Known limits (inherent to prefix-proxying without a subdomain): an app that navigates the iframe
// to its own absolute path drops the prefix from the document URL (its next assets' Referer no
// longer carries it), and an app that sends `Referrer-Policy: no-referrer` strips the signal. The
// common "open the dev server, see it rendered" case works.

const PREVIEW_PREFIX = "/api/preview/";
// The port that owns the referring iframe. 1–5 digits, followed by a slash or end-of-string so a
// bare `/api/preview/3396` (no trailing slash) still matches.
const REFERER_RE = /\/api\/preview\/(\d{1,5})(?:\/|$)/;

/** Re-route an origin-root request to its preview upstream when the Referer says it came from inside
 *  a preview iframe; return the URL unchanged for everything else. Pure, and never throws — it runs
 *  in Fastify's `rewriteUrl` on EVERY request, so a bad input must degrade to the original URL. */
export function previewRewriteUrl(url: string, referer: string | undefined): string {
  try {
    if (!url || !referer) return url;
    if (url.startsWith(PREVIEW_PREFIX)) return url; // already targeted — don't double-prefix
    const m = REFERER_RE.exec(referer);
    if (!m) return url;
    return `${PREVIEW_PREFIX}${m[1]}${url.startsWith("/") ? url : `/${url}`}`;
  } catch {
    return url;
  }
}

// Seed the preview prefix into a proxied app's HTML. The Referer rewrite above can only carry the
// prefix forward if the browser's module-graph URLs already contain it — but a dev server emits
// ROOT-absolute URLs (`/src/main.tsx`, `/@vite/client`, `import "/@react-refresh"`) that resolve to
// the origin root, so the entry modules load WITHOUT the prefix and the chain breaks one level in
// (the symptom: only the document + its direct scripts load, then nothing). Rewriting the entry
// document's root-absolute URLs to `/api/preview/<port>/…` fixes that: each entry then loads UNDER
// the prefix, so its own sub-imports carry a prefixed Referer and previewRewriteUrl routes the whole
// transitive graph. Only the HTML is touched; JS/CSS bodies ride the Referer propagation untouched.
// Protocol-relative (`//cdn`) and already-prefixed (`/api/preview/…`) URLs are left alone.
export function prefixPreviewHtml(html: string, prefix: string): string {
  try {
    let out = prefixModuleSpecifiers(html, prefix) // inline-script imports: from "/x", import("/x")
      // src="/x" / href="/x" attributes (the entry <script>/<link> — URLs, not module specifiers)
      .replace(/(\s(?:src|href)\s*=\s*["'])\/(?!\/)(?!api\/preview\/)/gi, `$1${prefix}/`);
    out = prefixAssetUrls(out, prefix); // inline-style url()/asset literals not in src=/href= attrs
    // Strip the proxy prefix from the iframe's URL on load, BEFORE the app's router reads it. A
    // client-side router (React Router etc.) matches its own routes against location.pathname — which
    // here is `/api/preview/<port>/…` — so without this every route 404s (the app's own NotFound).
    // Running first (classic <script>, synchronous, before the deferred module scripts) means the
    // router sees the real path (`/`, `/owner/qr`) and matches. Modules/assets still load prefixed
    // (their URLs were rewritten above), independent of the document URL, so stripping it is safe.
    const strip = `<script>(function(){try{var b=${JSON.stringify(prefix)},p=location.pathname;`
      + `if(p.indexOf(b)===0)history.replaceState(history.state,"",(p.slice(b.length)||"/")+location.search+location.hash);}catch(e){}})();</script>`;
    // <base> backstop so the app's RELATIVE URLs (and relative in-app navigation) resolve under the
    // prefix too. Absolute URLs ignore <base>, which is why they're prefixed explicitly.
    out = out.replace(/<head([^>]*)>/i, `<head$1>${strip}<base href="${prefix}/">`);
    return out;
  } catch {
    return html;
  }
}

// Rewrite ABSOLUTE ES-module specifiers in a JS (or inline-script) body to carry the preview prefix:
// `import x from "/node_modules/…"` / `import("/src/…")` / `export … from "/…"`. This is the
// load-bearing fix for dev servers (Vite): they emit absolute specifiers, and server-side URL
// rewriting is transparent — the browser would record each module at a NON-prefixed URL, so its own
// imports lose the prefix and the deep chunks 404/503 against terminalhub's own server. An import map
// would do this client-side, but browser extensions (e.g. Console Ninja) that start module loading at
// document_start make Chrome silently discard it — so we rewrite the bodies on the way out instead.
// Only import/export specifiers are touched (not arbitrary "/..." string literals); protocol-relative
// (`//`) and already-prefixed specifiers are left alone.
export function prefixModuleSpecifiers(code: string, prefix: string): string {
  try {
    return code.replace(/((?:\bfrom|\bimport|\bexport)\s*\(?\s*["'])\/(?!\/)(?!api\/preview\/)/g, `$1${prefix}/`);
  } catch {
    return code;
  }
}

// Static assets referenced by ROOT-ABSOLUTE string literals — `<img src="/variants/hero.jpg">`,
// CSS `url("/bg.webp")`, fonts — are NOT module specifiers, so prefixModuleSpecifiers misses them,
// and they're served from the app's public/ root (not /src or /node_modules) so the import map /
// path heuristics don't cover them either. They only load if the request reaches the right port, and
// relying on the Referer is fragile (a stricter Referrer-Policy drops it → the asset 404s to
// terminalhub's SPA). Prefix the literals directly: match a quoted string that is a root-absolute path
// ending in a known ASSET extension (so route paths like "/owner/qr", API paths, and .js/.json/.css
// modules are left untouched), and route it through /api/preview/<port>/.
const ASSET_EXT = "jpe?g|png|gif|webp|avif|svg|ico|bmp|mp4|webm|mov|m4v|mp3|wav|ogg|flac|woff2?|ttf|otf|eot|wasm";
const ASSET_URL_RE = new RegExp(
  `(["'\`])(\\/(?!\\/)(?!api\\/preview\\/)[^"'\`\\s]*?\\.(?:${ASSET_EXT}))((?:\\?[^"'\`\\s]*)?)\\1`,
  "gi",
);
export function prefixAssetUrls(code: string, prefix: string): string {
  try {
    return code.replace(ASSET_URL_RE, (_m, q, path, query) => `${q}${prefix}${path}${query}${q}`);
  } catch {
    return code;
  }
}
