import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useToasts } from "../../store/toasts";
import { useUi } from "../../store/ui";

/**
 * The "Connect Google Drive" action that sits above the left navigator. Connected Drives now live IN
 * the tree (as sibling roots to Computer), so this is purely the add affordance — no longer a Places
 * switcher. When no OAuth client is configured yet, clicking it opens Settings → Connections so the
 * user can paste their credentials; once configured it runs the OAuth connect flow. Reads
 * "Add another Google Drive" once at least one account is connected, so it isn't redundant.
 */
export function PlacesBar() {
  const push = useToasts((s) => s.push);
  const openSettingsTab = useUi((s) => s.openSettingsTab);

  // Whether the OAuth client is configured (settings or env); accounts only load once it is.
  const { data: config } = useQuery({
    queryKey: ["drive-config"], queryFn: api.driveGetConfig, retry: false, staleTime: 30_000,
  });
  const configured = config?.configured ?? false;
  const { data } = useQuery({
    queryKey: ["drive-accounts"], queryFn: api.driveAccounts, retry: false, staleTime: 30_000, enabled: configured,
  });
  const count = data?.accounts.length ?? 0;

  // Configured → run the OAuth connect (leave for Google). Not configured → open Settings → Connections.
  const connect = async () => {
    if (!configured) { openSettingsTab("connections"); return; }
    try { const { url } = await api.driveConnectUrl(); window.location.href = url; }
    catch (e) { push((e as Error).message); }
  };

  return (
    <div className="border-b border-edge py-1 text-sm select-none">
      <button className="w-full text-left px-3 h-7 flex items-center gap-2 text-dim hover:text-fg hover:bg-surface"
        onClick={connect}>
        <span className="w-4 text-center shrink-0">＋</span>
        <span className="truncate">{count > 0 ? "Add another Google Drive" : "Connect Google Drive"}</span>
      </button>
    </div>
  );
}
