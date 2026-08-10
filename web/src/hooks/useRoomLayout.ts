import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Workspace } from "../api/types";
import { useRoom } from "../store/room";

const SAVE_DEBOUNCE_MS = 400;

/**
 * Persist the open room's layout (panel sizes + open/collapsed + active view) to the workspace
 * row, debounced, whenever it changes. The room store is the live source of truth while open;
 * this only mirrors it to the DB so a later reopen — here or on another machine — hydrates it.
 * The very first run is skipped: that's the freshly-hydrated state, with nothing new to save.
 */
export function usePersistRoomLayout(workspaceId: string) {
  const sidebarWidth = useRoom(s => s.sidebarWidth);
  const terminalListWidth = useRoom(s => s.terminalListWidth);
  const dockHeight = useRoom(s => s.dockHeight);
  const dockFull = useRoom(s => s.dockFull);
  const leftOpen = useRoom(s => s.leftOpen);
  const rightOpen = useRoom(s => s.rightOpen);
  const activeView = useRoom(s => s.activeView);
  const activeTerminalId = useRoom(s => s.activeTerminalId);
  const windowed = useRoom(s => s.windowed);
  const windowRect = useRoom(s => s.windowRect);
  const windowMoved = useRoom(s => s.windowMoved);
  const openFiles = useRoom(s => s.openFiles);
  const activeFile = useRoom(s => s.activeFile);
  const qc = useQueryClient();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const json = JSON.stringify({ sidebarWidth, terminalListWidth, dockHeight, dockFull, leftOpen, rightOpen, activeView, activeTerminalId, windowed, windowRect, windowMoved, openFiles, activeFile });
    const t = setTimeout(() => {
      api.updateWorkspace(workspaceId, { layout: json }).catch(() => { /* best-effort; the next change retries */ });
      // Mirror into the cached workspaces list so an immediate reopen hydrates the latest layout
      // without waiting for the periodic refetch. Patch in place — no invalidate, no refetch churn.
      qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (prev) =>
        prev ? { ...prev, workspaces: prev.workspaces.map(w => w.id === workspaceId ? { ...w, layout: json } : w) } : prev,
      );
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [sidebarWidth, terminalListWidth, dockHeight, dockFull, leftOpen, rightOpen, activeView, activeTerminalId, windowed, windowRect, windowMoved, openFiles, activeFile, workspaceId, qc]);
}
