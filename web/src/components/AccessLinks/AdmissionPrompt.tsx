import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { usePresence } from "../../store/presence";

/**
 * Center-screen Accept / Decline for the host (mounted once in App, like ConfirmHost). When a teammate
 * opens a link the presence socket pushes a `joinRequest`; this pops the topmost one. Accept lets them
 * in; Decline ends the join AND revokes that link. Multiple pending joins queue — the next shows after
 * each decision. Rendered only for the owner (a teammate's socket never receives joinRequest frames).
 */
export function AdmissionPrompt() {
  const joinRequests = usePresence((s) => s.joinRequests);
  const removeJoinRequest = usePresence((s) => s.removeJoinRequest);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const current = joinRequests[0];
  if (!current) return null;

  const decide = async (decision: "accept" | "decline") => {
    if (busy) return;
    setBusy(true);
    removeJoinRequest(current.sessionId); // optimistic — the next prompt (if any) shows at once
    try { await api.accessKeys.admit(current.sessionId, decision); } catch { /* server already gone / handled */ }
    qc.invalidateQueries({ queryKey: ["accessKeys"] });
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-edge-strong bg-canvas shadow-2xl p-5">
        <div className="text-xs uppercase tracking-wider text-dim">Someone wants to join</div>
        <div className="mt-1 text-lg font-semibold text-bright break-words">{current.name}</div>
        <div className="mt-1 text-sm text-dim">is asking to join through one of your access links.</div>
        <div className="mt-5 flex gap-2">
          <button disabled={busy} onClick={() => decide("accept")}
            className="flex-1 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50">
            Accept
          </button>
          <button disabled={busy} onClick={() => decide("decline")}
            className="flex-1 py-2 rounded bg-elevated hover:bg-edge text-fg text-sm font-medium disabled:opacity-50">
            Decline
          </button>
        </div>
        <div className="mt-2 text-[11px] text-dim">Declining revokes the link they used.</div>
      </div>
    </div>
  );
}
