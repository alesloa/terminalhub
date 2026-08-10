import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Terminal } from "../../api/types";
import { useRoom } from "../../store/room";
import { lockCursor } from "../../lib/dragCursor";
import { TerminalView } from "../TerminalView";
import { TerminalList } from "../TerminalList";
import { GuiChatView } from "../Gui/GuiChatView";

export function TerminalDock({ workspaceId, folder, terminals, activeTerminal, onStartTerminal, starting }:
  {
    workspaceId: string;
    /** The workspace's host folder — the GUI chat runs its agent there and labels itself with it. */
    folder: string;
    terminals: Terminal[];
    activeTerminal: Terminal | null;
    onStartTerminal: () => void;
    starting: boolean;
  }) {
  const rightOpen = useRoom(s => s.rightOpen);
  // Width lives in the room store (hydrated from / persisted to the workspace's saved layout) so it
  // survives close/reopen, instead of resetting to the default each time the room mounts.
  const listWidth = useRoom(s => s.terminalListWidth);
  const setListWidth = useRoom(s => s.setTerminalListWidth);
  const rowRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);

  // Drag the divider to resize the terminals panel. Panel is right-docked, so width =
  // distance from the pointer to the row's right edge. Mirrors Room's dock-height handle.
  // lockCursor pins the col-resize cursor for the whole drag (no flicker as the pointer crosses
  // other elements); `resizing` lights the seam line while dragging.
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const release = lockCursor("col-resize");
    const onMove = (ev: PointerEvent) => {
      const rect = rowRef.current?.getBoundingClientRect();
      if (!rect) return;
      setListWidth(Math.max(160, Math.min(rect.width - 200, rect.right - ev.clientX)));
    };
    const onUp = () => {
      release();
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div ref={rowRef} className="flex min-h-0 h-full border-t border-edge">
      <div className="flex-1 min-w-0">
        {/* The active terminal's `mode` picks the surface: the xterm pane, or the in-app Claude chat
            in its place. Keyed by id AND mode so switching surfaces tears the old one down (the
            xterm instance / the GUI socket) instead of re-using its state. */}
        {activeTerminal ? (
          activeTerminal.mode === "gui" ? (
            <GuiChatView key={`${activeTerminal.id}:gui`} terminalId={activeTerminal.id} folder={folder} />
          ) : (
            <TerminalView key={activeTerminal.id} terminalId={activeTerminal.id} />
          )
        ) : (
          <div className="h-full flex items-center justify-center">
            <button onClick={onStartTerminal} disabled={starting}
              className="px-4 py-2 bg-blue-600 rounded disabled:opacity-40">
              Start terminal
            </button>
          </div>
        )}
      </div>
      {rightOpen && (
        <div className="relative shrink-0 flex flex-col min-h-0 border-l border-edge">
          {/* Resize splitter. The visible seam line sits on the seam (the list's left edge); the
              wider invisible grab strip straddles it — biased left so the cursor triggers centered on
              the line, while still leaving most of the terminal's always-on vertical scrollbar (xterm
              forces overflow-y:scroll, a 10px gutter at the pane's right edge) clear to grab. */}
          <div onPointerDown={startResize} title="Drag to resize"
            className="group absolute inset-y-0 -left-1 z-10 w-2.5 cursor-col-resize">
            <div className={`absolute inset-y-0 left-1 w-0.5 ${resizing ? "bg-accent/60" : "bg-transparent group-hover:bg-accent/40"}`} />
          </div>
          <TerminalList workspaceId={workspaceId} terminals={terminals} width={listWidth} />
        </div>
      )}
    </div>
  );
}
