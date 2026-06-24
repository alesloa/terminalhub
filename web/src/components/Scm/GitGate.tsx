import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { InitRepoModal } from "./InitRepoModal";

/**
 * Guards a git view: renders children only when git is installed AND the folder is a
 * repo. Otherwise shows a message with a Refresh button that re-probes. The "Not a git
 * repository" state also offers an Initialize button that runs `git init` right here, so the
 * user never has to drop to a terminal — on success the re-probe flips the gate to the repo view.
 */
export function GitGate({ rootPath, children }: { rootPath: string; children: ReactNode }) {
  const qc = useQueryClient();
  const [showInit, setShowInit] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["git", "info", rootPath],
    queryFn: () => api.git.info(rootPath),
    refetchInterval: 10_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["git"] });

  if (isLoading) return <Centered>checking git…</Centered>;
  if (isError || !data) return <Notice title="Couldn't reach git" hint="The git probe failed. Try again." onRefresh={refresh} />;
  if (!data.installed) return (
    <Notice title="Git isn't installed" onRefresh={refresh}
      hint="Install git on this machine, then refresh. macOS: xcode-select --install (or brew install git). Debian/Ubuntu: sudo apt install git. Fedora: sudo dnf install git." />
  );
  // The Initialize button opens a dialog that also picks the committing account + optional first
  // commit. On success the dialog invalidates ["git"], the info query refetches, and the gate flips.
  if (!data.isRepo) return (
    <>
      <Notice title="Not a git repository" onRefresh={refresh}
        hint="This folder isn't under version control yet."
        primary={{ label: "Initialize Repository", onClick: () => setShowInit(true) }} />
      {showInit && <InitRepoModal rootPath={rootPath} onClose={() => setShowInit(false)} />}
    </>
  );
  return <>{children}</>;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex-1 flex items-center justify-center text-xs text-dim p-4">{children}</div>;
}

function Notice({ title, hint, onRefresh, primary }:
  { title: string; hint: string; onRefresh: () => void; primary?: { label: string; onClick: () => void; disabled?: boolean } }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-5 text-center">
      <div className="text-fg text-sm font-medium">{title}</div>
      <div className="text-dim text-xs leading-relaxed">{hint}</div>
      <div className="mt-1 flex items-center gap-2">
        {primary && (
          <button onClick={primary.onClick} disabled={primary.disabled}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs text-white">
            {primary.label}
          </button>
        )}
        <button onClick={onRefresh} className="px-3 py-1.5 bg-elevated hover:bg-edge rounded text-xs text-fg">
          ↻ Refresh
        </button>
      </div>
    </div>
  );
}
