import { useState } from "react";

/**
 * One preview tab's iframe. Kept mounted while inactive (hidden via CSS) so the framed app's scroll
 * and in-memory state survive tab switches. Keyed by url+reloadSeq upstream, so a reload or address
 * change remounts it fresh (and resets the loading veil) — which also sidesteps the cross-origin
 * `contentWindow.location.reload()` throw in direct mode.
 */
export function PreviewTab({ url, title, active, frameRef }: {
  url: string;
  title: string;
  active: boolean;
  frameRef?: (el: HTMLIFrameElement | null) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={active ? "absolute inset-0" : "hidden"}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center text-dim text-sm pointer-events-none">
          loading {title}…
        </div>
      )}
      {/* bg-white: dev servers assume a white canvas; don't bleed the dark app chrome through. */}
      <iframe
        ref={frameRef}
        src={url}
        title={title}
        onLoad={() => setLoaded(true)}
        className="w-full h-full border-0 bg-white"
        // Local, trusted dev servers — allow the usual capabilities. (Same-origin under the proxy, so
        // we don't add `sandbox`, which would also block the app from working normally.)
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  );
}
