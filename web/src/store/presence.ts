import { create } from "zustand";
import type { PresenceSession } from "../api/types";
import type { WinRect, OpenFile, RoomViewState } from "./ui";

// Where THIS browser stands with the host. "connecting" before the socket says hello; the owner
// (role "main") is "admitted" at once; a teammate (role "key") waits at "pending" until the host
// accepts, then "admitted" — or "declined" / "kicked" if refused / disconnected.
export type Admission = "connecting" | "pending" | "admitted" | "declined" | "kicked";

// A live participant (the owner(s) + admitted teammates) in the awareness layer.
export interface Peer { id: string; name: string; color: string; }
// Another participant's last-known cursor, in canvas (scroll-space) coords — see SpaceCanvas.
export interface RemoteCursor { space: string | null; x: number; y: number; name: string; color: string; }

// One open TopBar panel in the owner's mirrored view: a stable panel id + its live floating geometry
// (null until the panel reports it). A mirror viewer opens the same panel and adopts the geometry.
export interface MirrorPanel { id: string; rect: WinRect | null; }

// Presentation mirroring: the slice of the owner's UI nav that a mirror viewer's screen follows. The
// owner broadcasts it; a mirrored viewer applies it — switches space, opens/closes the same rooms (and
// matches each room's fullscreen mode), opens the same TopBar panels at the same geometry, and matches
// the System Monitor / Localhost windows. Opaque to the server — it just relays it to mirror viewers.
// (Workspace-card positions are NOT here: they're shared canvas state synced BOTH ways over a separate
// `cards` frame, so an unlocked teammate moving a card is reflected back to the host too.)
export interface ViewState {
  activeSpaceId: string;
  rooms: { workspaceId: string; maximized: boolean; activeTerminalId?: string | null; rect?: WinRect | null; openFiles?: OpenFile[]; activeFile?: string; view?: RoomViewState }[]; // + the host's active terminal, window geometry, open editor tabs, and sidebar/panel chrome in each room
  panels: MirrorPanel[];   // open TopBar panels + geometry (mirror-safe set; excludes the owner-only Share panel)
  monitor: boolean;        // System Monitor window open
  localhost: boolean;      // Localhost preview window open
  viewport?: { w: number; h: number }; // the host's CSS viewport size, so a viewer on a different-sized
                                        // screen can render the app at the host's size and scale-to-fit (MirrorStage)
}

interface PresenceState {
  role: "main" | "key" | null;
  admission: Admission;
  joinRequests: PresenceSession[]; // owner side: pending joins awaiting an Accept/Decline
  // Live awareness (Subsystem B): who else is connected, their cursors, and how to send mine.
  selfId: string | null;
  peers: Record<string, Peer>;            // peerId → identity
  cursors: Record<string, RemoteCursor>;  // peerId → last cursor (self excluded; server never echoes)
  sendCursor: ((c: { space: string | null; x: number; y: number }) => void) | null;
  // Shared canvas state: broadcast a workspace-card move to every other participant (relayed to all,
  // not just mirror viewers) so card positions track BOTH ways. null until the socket hands us a sender.
  sendCards: ((cards: { id: string; x: number; y: number }[]) => void) | null;
  // Presentation flags for THIS browser (from the hello frame). A key viewer's link can mirror the
  // owner's view and/or lock their input; the owner is never mirrored or locked.
  mirrored: boolean;                       // this viewer follows the owner's nav (applies incoming `view`)
  locked: boolean;                         // this viewer is a passive spectator (mouse + typing disabled)
  viewState: ViewState | null;             // the owner's last broadcast view (a mirror viewer applies it)
  sendView: ((v: ViewState) => void) | null; // owner-side: broadcast my view to mirror viewers
  setHello(role: "main" | "key", opts?: { mirror?: boolean; lock?: boolean }): void;
  setViewState(v: ViewState): void;
  setSendView(fn: PresenceState["sendView"]): void;
  setAdmission(a: Admission): void;
  addJoinRequest(s: PresenceSession): void;
  removeJoinRequest(sessionId: string): void;
  keepJoinRequests(stillPending: Set<string>): void; // prune prompts the server says are gone/handled
  setSelf(id: string): void;
  setPeers(list: Peer[]): void;            // also drops cursors for peers who left
  setCursor(from: string, c: { space: string | null; x: number; y: number }): void;
  setSendCursor(fn: PresenceState["sendCursor"]): void;
  setSendCards(fn: PresenceState["sendCards"]): void;
  reset(): void;
}

// Select single fields (`usePresence(s => s.admission)`) — never return a fresh object literal, which
// would break Zustand's snapshot caching. Mirrors the useToasts / useConfirm pattern.
export const usePresence = create<PresenceState>((set) => ({
  role: null,
  admission: "connecting",
  joinRequests: [],
  selfId: null,
  peers: {},
  cursors: {},
  sendCursor: null,
  sendCards: null,
  mirrored: false,
  locked: false,
  viewState: null,
  sendView: null,
  setHello: (role, opts) => set({
    role,
    admission: role === "main" ? "admitted" : "pending",
    mirrored: role === "key" && !!opts?.mirror,
    locked: role === "key" && !!opts?.lock,
  }),
  setViewState: (viewState) => set({ viewState }),
  setSendView: (fn) => set({ sendView: fn }),
  setAdmission: (admission) => set({ admission }),
  addJoinRequest: (s) => set((st) => (st.joinRequests.some((j) => j.sessionId === s.sessionId) ? st : { joinRequests: [...st.joinRequests, s] })),
  removeJoinRequest: (sessionId) => set((st) => ({ joinRequests: st.joinRequests.filter((j) => j.sessionId !== sessionId) })),
  keepJoinRequests: (stillPending) => set((st) => ({ joinRequests: st.joinRequests.filter((j) => stillPending.has(j.sessionId)) })),
  setSelf: (id) => set({ selfId: id }),
  setPeers: (list) => set((st) => {
    const peers: Record<string, Peer> = {};
    for (const p of list) peers[p.id] = p;
    // Drop cursors for anyone who left so their ghost disappears.
    const cursors: Record<string, RemoteCursor> = {};
    for (const [id, c] of Object.entries(st.cursors)) if (peers[id]) cursors[id] = c;
    return { peers, cursors };
  }),
  setCursor: (from, c) => set((st) => {
    if (from === st.selfId) return st;                 // never draw our own
    const p = st.peers[from];
    return { cursors: { ...st.cursors, [from]: { ...c, name: p?.name ?? "Guest", color: p?.color ?? "#3b82f6" } } };
  }),
  setSendCursor: (fn) => set({ sendCursor: fn }),
  setSendCards: (fn) => set({ sendCards: fn }),
  reset: () => set({ role: null, admission: "connecting", joinRequests: [], selfId: null, peers: {}, cursors: {}, sendCursor: null, sendCards: null, mirrored: false, locked: false, viewState: null, sendView: null }),
}));
