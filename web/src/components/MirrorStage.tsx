import { type ReactNode } from "react";
import { usePresence } from "../store/presence";

// Exact-replica framing for a mirror viewer whose screen differs in size from the host's. The host
// broadcasts its own CSS viewport size; we render the WHOLE app at THAT size, 1:1 (never scaled by us),
// inside a scrollable box. So the layout is pixel-for-pixel the host's:
//   • Host bigger than the viewer's screen → the viewer gets scrollbars and pans around it, OR zooms out
//     with their own browser zoom (Cmd/Ctrl −) — which is crisper than a CSS transform.
//   • Once they've zoomed out (or are on a bigger screen) past the host's size → the box is smaller than
//     their viewport, so `place-content: safe center` centers it and the black backdrop shows as
//     letterbox. `safe` keeps the top-left reachable by scroll while the box still overflows.
// The inner box's `transform` makes IT the containing block for the app's `position: fixed` windows, so
// their host-pixel coordinates land exactly where the host put them AND they pan with the scroll.
//
// Passthrough for everyone who isn't a mirrored teammate (the owner, a non-mirror key, or before the
// first view arrives), so the normal full-screen app is completely untouched.
export function MirrorStage({ children }: { children: ReactNode }) {
  const role = usePresence((s) => s.role);
  const mirrored = usePresence((s) => s.mirrored);
  // Primitive selects (not the nested object) so a new view frame only re-renders the stage when the
  // host's size actually changes — not on every nav tick.
  const hostW = usePresence((s) => s.viewState?.viewport?.w);
  const hostH = usePresence((s) => s.viewState?.viewport?.h);

  if (role !== "key" || !mirrored || !hostW || !hostH) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-0 overflow-auto bg-black grid" style={{ placeContent: "safe center" }}>
      {/* translate(0,0): an identity transform, purely to capture the app's position:fixed overlays into
          this host-sized box so they pan with the scroll instead of pinning to the physical viewport. */}
      <div style={{ width: hostW, height: hostH, transform: "translate(0, 0)" }}>{children}</div>
    </div>
  );
}
