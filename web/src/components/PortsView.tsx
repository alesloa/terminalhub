import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { PortInfo } from "../api/types";

type SortKey = "port" | "name" | "pid" | "address";

// The "Ports" tab of the System Monitor: every TCP socket in LISTEN state, kill what holds
// one to free it. Self-contained (own query/sort/kill/menu) so it can't regress the process
// table — it only shares the modal shell + filter string from SystemMonitor.
export function PortsView({ filter }: { filter: string }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["ports"],
    queryFn: api.listPorts,
    refetchInterval: 2000,
  });
  const [sortKey, setSortKey] = useState<SortKey>("port");
  const [asc, setAsc] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; port: PortInfo } | null>(null);
  const [killErr, setKillErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: globalThis.MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null); };
    const onScroll = () => setMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("scroll", onScroll, true); };
  }, [menu]);

  const kill = useMutation({
    mutationFn: ({ pid, signal }: { pid: number; signal: "TERM" | "KILL" }) => api.killProcess(pid, signal),
    // Killing the port owner also changes the process list — refresh both tabs.
    onSuccess: () => { setKillErr(null); qc.invalidateQueries({ queryKey: ["ports"] }); qc.invalidateQueries({ queryKey: ["processes"] }); },
    onError: (e: Error) => setKillErr(e.message),
  });

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = (data?.ports ?? []).filter(p =>
      !q || String(p.port).includes(q) || p.name.toLowerCase().includes(q) || String(p.pid) === q || p.address.toLowerCase().includes(q));
    const dir = asc ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [data, filter, sortKey, asc]);

  const setSort = (k: SortKey) => { if (k === sortKey) setAsc(a => !a); else { setSortKey(k); setAsc(true); } };

  // stopPropagation is load-bearing: without it the click bubbles to the backdrop and clears
  // the menu the same instant it opens. Sockets with no known owner (pid 0) aren't killable.
  const openMenu = (e: MouseEvent, port: PortInfo) => {
    e.preventDefault(); e.stopPropagation();
    setSelected(port.port);
    if (port.pid > 0) setMenu({ x: e.clientX, y: e.clientY, port });
  };
  const doKill = (signal: "TERM" | "KILL") => {
    if (!menu) return;
    const p = menu.port; setMenu(null);
    const verb = signal === "KILL" ? "Force kill" : "Kill";
    const who = p.name || `pid ${p.pid}`;
    if (confirm(`${verb} ${who} on port ${p.port} (pid ${p.pid})?`)) kill.mutate({ pid: p.pid, signal });
  };

  return (
    <>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-sm table-fixed">
          <thead className="sticky top-0 bg-panel text-muted select-none">
            <tr>
              <Th label="Port" k="port" sortKey={sortKey} asc={asc} setSort={setSort} className="w-24 text-right" />
              <Th label="Process" k="name" sortKey={sortKey} asc={asc} setSort={setSort} className="text-left" />
              <Th label="PID" k="pid" sortKey={sortKey} asc={asc} setSort={setSort} className="w-24 text-right" />
              <Th label="Address" k="address" sortKey={sortKey} asc={asc} setSort={setSort} className="w-44 text-right" />
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              // Zebra striping (matches the Processes tab): odd rows get a faint fg wash for readability.
              <tr key={`${p.protocol}:${p.address}:${p.port}:${p.pid}`} onClick={() => setSelected(p.port)} onContextMenu={e => openMenu(e, p)}
                className={`border-t border-surface cursor-default ${p.port === selected ? "bg-accent/20" : `${i % 2 ? "bg-fg/[0.04]" : ""} hover:bg-surface`}`}>
                <td className="px-3 py-1 text-right tabular-nums">{p.port}</td>
                <td className="px-3 py-1 truncate" title={`${p.address}:${p.port}`}>{p.name || <span className="text-dim">unknown</span>}</td>
                <td className="px-3 py-1 text-right tabular-nums text-muted">{p.pid || ""}</td>
                <td className="px-3 py-1 text-right tabular-nums text-muted truncate" title={p.address}>{p.address}</td>
                <td className="px-2 py-1 text-center">
                  {p.pid > 0 && (
                    <button onClick={e => openMenu(e, p)} title="Kill process on this port…"
                      className="text-dim hover:text-red-400 px-1 leading-none">✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading && <div className="p-4 text-dim text-sm">loading…</div>}
        {error && <div className="p-4 text-red-400 text-sm">{(error as Error).message}</div>}
        {data && rows.length === 0 && <div className="p-4 text-dim text-sm">no listening ports</div>}
      </div>

      <div className="h-8 shrink-0 flex items-center justify-between px-4 border-t border-edge text-xs">
        <span className="text-dim">{data ? `${data.ports.length} listening ports · click ✕ or right-click a row to kill · refreshes every 2s` : ""}</span>
        {killErr && <span className="text-red-400">kill failed: {killErr}</span>}
      </div>

      {/* Portal to <body>: the System Monitor window's open/close transform is the containing block
          for position:fixed, which would otherwise shove this menu off-screen (see TerminalContextMenu). */}
      {menu && createPortal(
        <div ref={menuRef} className="fixed z-[60] w-44 bg-panel border border-edge rounded shadow-lg py-1 text-sm"
          style={{ left: menu.x, top: menu.y }} onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
          <div className="px-3 py-1 text-xs text-dim truncate">:{menu.port.port} · {menu.port.name || `pid ${menu.port.pid}`}</div>
          <button onClick={() => doKill("TERM")} className="w-full text-left px-3 py-1.5 hover:bg-elevated">Kill</button>
          <button onClick={() => doKill("KILL")} className="w-full text-left px-3 py-1.5 text-red-300 hover:bg-elevated">Force kill</button>
        </div>,
        document.body,
      )}
    </>
  );
}

function Th({ label, k, sortKey, asc, setSort, className }:
  { label: string; k: SortKey; sortKey: SortKey; asc: boolean; setSort: (k: SortKey) => void; className?: string }) {
  return (
    <th onClick={() => setSort(k)} className={`px-3 py-1.5 font-medium cursor-pointer hover:text-fg ${className ?? ""}`}>
      {label}{sortKey === k ? (asc ? " ▲" : " ▼") : ""}
    </th>
  );
}
