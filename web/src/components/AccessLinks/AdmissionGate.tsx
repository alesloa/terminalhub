import { useMemo, type ReactNode } from "react";
import { usePresenceSocket } from "../../hooks/usePresenceSocket";
import { useMirrorBroadcast, useMirrorApply } from "../../hooks/useMirror";
import { usePresence } from "../../store/presence";
import { ViewerLock } from "../ViewerLock";
import { MirrorStage } from "../MirrorStage";

// Did this tab arrive through a temp access link? Only such visitors are gated; the owner and anyone
// who typed the token in the AccessGate render straight through. Set by consumeAccessLink() on boot.
function arrivedViaLink(): boolean {
  try { return sessionStorage.getItem("tr.viaLink") === "1"; } catch { return false; }
}

function Curtain({ title, body, spinner }: { title: string; body: string; spinner?: boolean }) {
  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-canvas text-center px-6">
      {spinner && (
        <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-20" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      <div className="text-lg font-semibold text-bright">{title}</div>
      <div className="max-w-sm text-sm text-dim">{body}</div>
    </div>
  );
}

/**
 * Gates a teammate who arrived via a temp link behind the host's approval. Holds the single
 * `/ws/presence` connection (also feeds the owner's join prompts + roster). The owner / token visitor
 * (role "main") and an admitted teammate render the app; a pending teammate sees a "waiting for host"
 * curtain; declined / kicked see an "access ended" curtain. Mount: AccessGate → AdmissionGate → App.
 */
export function AdmissionGate({ children }: { children: ReactNode }) {
  usePresenceSocket(); // one shared presence socket for the whole app
  useMirrorBroadcast(); // owner: push my view to mirror viewers
  useMirrorApply();     // viewer: follow the host's view when mirrored
  const admission = usePresence((s) => s.admission);
  const role = usePresence((s) => s.role);
  const viaLink = useMemo(arrivedViaLink, []);

  // Owner / manual token visitor (no link) is never gated — render immediately, don't wait on the
  // socket (so an older server without /ws/presence can't lock the owner out). ViewerLock rides along
  // (it only renders for a locked viewer) so a passive spectator can't interact with the mirrored view.
  // MirrorStage scales the app to the host's size for a mirrored teammate on a different screen (and is
  // a passthrough for everyone else). ViewerLock stays OUTSIDE the stage so the spectator input-blocker
  // covers the viewer's whole physical screen, not the scaled-down stage.
  if (!viaLink || role === "main" || admission === "admitted") return <><MirrorStage>{children}</MirrorStage><ViewerLock /></>;
  if (admission === "declined") return <Curtain title="Access ended" body="The host declined your request to join." />;
  if (admission === "kicked") return <Curtain title="Disconnected" body="The host ended your session. Open the link again to ask to rejoin." />;
  return <Curtain spinner title="Waiting for the host…" body="Your request to join was sent. You'll come straight in once they let you in." />;
}
