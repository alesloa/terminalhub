import { forwardRef, useEffect, useImperativeHandle, useState, type CSSProperties, type ReactNode, type TransitionEventHandler } from "react";
import type { WinRect } from "../store/ui";
import { spacesBarBottom } from "../store/ui";
import { useDraggableWindow, type WindowHandle } from "../hooks/useDraggableWindow";
import { ResizeHandles } from "./ResizeHandles";
import { copyText } from "../lib/clipboard";

// The CLAUDE.md / AGENTS.md block a user pastes into a project so the agent pings the dashboard on
// its own. Plain double-quoted JS strings (NOT template literals) so the shell's ${...}/$(...) and
// single quotes survive verbatim; only the JSON " are escaped. Mirrors docs/AGENT-MESSAGING.md.
const CLAUDE_SNIPPET = [
  "## Message me through Terminal Hub",
  "",
  "You're running inside a Terminal Hub terminal. When you finish a long task, get blocked, need a",
  "decision, or hit an error I should see, ping my dashboard so I notice even when I'm not looking",
  "at this terminal — it pops a toast and reads the message aloud:",
  "",
  "```bash",
  "curl -sS -X POST http://127.0.0.1:8189/api/notify \\",
  "  -H 'content-type: application/json' \\",
  "  -d '{\"text\":\"Ready for review\",\"level\":\"success\",\"session\":\"'\"$(tmux display-message -p '#S' 2>/dev/null)\"'\"}'",
  "```",
  "",
  "- text (required): the message. title: optional short label. level: info | success | warn | error.",
  "- Keep the session part as-is — it lets me click the toast to jump straight to this terminal.",
  "- Speaks aloud by default; add \"speak\":false for a silent toast. No token needed on localhost.",
].join("\n");

// A bare one-liner for sending a test message by hand from any terminal in the room.
const CURL_ONELINER =
  "curl -sS -X POST http://127.0.0.1:8189/api/notify -H 'content-type: application/json' -d '{\"text\":\"hello from your agent\",\"session\":\"'\"$(tmux display-message -p '#S' 2>/dev/null)\"'\"}'";

// The CLAUDE.md / AGENTS.md block that teaches an agent to keep the task board current. The board
// API takes plain JSON, so only the JSON " need escaping; \\ is a shell line-continuation.
const BOARD_SNIPPET = [
  "## Keep my Terminal Hub task board updated",
  "",
  "You're running inside a Terminal Hub terminal. I keep a kanban board with three columns —",
  "`todo`, `doing`, and `done`. Keep it current as you work: move a card to `doing` when you",
  "start it, to `done` when it's finished, and add a card for any new task you take on. The",
  "board is on the host next to the server, so reach it on 127.0.0.1 with no token.",
  "",
  "```bash",
  "# list the board — each card has an \"id\" like bc_...",
  "curl -sS http://127.0.0.1:8189/api/board",
  "",
  "# add a card to To Do",
  "curl -sS -X POST http://127.0.0.1:8189/api/board/cards \\",
  "  -H 'content-type: application/json' \\",
  "  -d '{\"title\":\"Wire up auth\",\"body\":\"use the existing guard\"}'",
  "",
  "# move a card between columns (todo | doing | done)",
  "curl -sS -X PATCH http://127.0.0.1:8189/api/board/cards/<id> \\",
  "  -H 'content-type: application/json' \\",
  "  -d '{\"column\":\"doing\"}'",
  "",
  "# recolor a card (hex accent stripe) — send \"color\":null to clear it",
  "curl -sS -X PATCH http://127.0.0.1:8189/api/board/cards/<id> \\",
  "  -H 'content-type: application/json' \\",
  "  -d '{\"color\":\"#22c55e\"}'",
  "",
  "# delete a card",
  "curl -sS -X DELETE http://127.0.0.1:8189/api/board/cards/<id>",
  "```",
  "",
  "- Get <id> from the list call. One PATCH does everything: title, body, color (hex), column,",
  "  and position (the index within a column, 0 = top; omit it to append).",
].join("\n");

// A bare one-liner for adding a test card by hand from any terminal.
const BOARD_TEST =
  "curl -sS -X POST http://127.0.0.1:8189/api/board/cards -H 'content-type: application/json' -d '{\"title\":\"hello from your agent\"}'";

// CLAUDE.md / AGENTS.md block teaching an agent to save notes into the Notes panel. The notes API
// takes plain JSON, so only the JSON " need escaping; \\ is a shell line-continuation. `\\n` inside a
// JSON string survives single quotes as the two chars backslash-n, which the server's JSON.parse then
// turns into a real newline — so multi-line markdown content lands correctly.
const NOTES_SNIPPET = [
  "## Save notes to my Terminal Hub notepad",
  "",
  "You're running inside a Terminal Hub terminal. I keep a Notes panel — a notepad of markdown notes,",
  "optionally filed into named groups. When you produce something worth keeping (a summary, a plan, a",
  "snippet, findings), save it as a note so it's waiting in my dashboard. It's on the host next to the",
  "server, so reach it on 127.0.0.1 with no token.",
  "",
  "```bash",
  "# list my notes — each has an \"id\" like np_..., a title, content (markdown), and a groupId",
  "curl -sS http://127.0.0.1:8189/api/notes",
  "",
  "# add a note — content is markdown; title is optional (I show the first line when it's blank)",
  "curl -sS -X POST http://127.0.0.1:8189/api/notes \\",
  "  -H 'content-type: application/json' \\",
  "  -d '{\"title\":\"Auth findings\",\"content\":\"# Summary\\n- uses the existing guard\\n- token on the WS only\"}'",
  "",
  "# list groups (collections) — each has an \"id\" like ng_... and a name",
  "curl -sS http://127.0.0.1:8189/api/note-groups",
  "",
  "# create a group, then file a note into it by its groupId (send \"groupId\":null to un-file)",
  "curl -sS -X POST http://127.0.0.1:8189/api/note-groups \\",
  "  -H 'content-type: application/json' -d '{\"name\":\"Research\"}'",
  "curl -sS -X PATCH http://127.0.0.1:8189/api/notes/<id> \\",
  "  -H 'content-type: application/json' -d '{\"groupId\":\"<groupId>\"}'",
  "",
  "# delete a note",
  "curl -sS -X DELETE http://127.0.0.1:8189/api/notes/<id>",
  "```",
  "",
  "- content is markdown — the note opens in the rich editor (headings, lists, bold, code, tables).",
  "- Leave groupId off (or null) for an ungrouped note; set a ng_... id to file it in a group.",
  "- One PATCH updates any of title, content, or groupId. Get the ids from the list calls.",
].join("\n");

// A bare one-liner for adding a test note by hand from any terminal.
const NOTES_TEST =
  "curl -sS -X POST http://127.0.0.1:8189/api/notes -H 'content-type: application/json' -d '{\"title\":\"hello from your agent\",\"content\":\"# Notes\\nThis note was created from a terminal.\"}'";

// CLAUDE.md / AGENTS.md block teaching an agent to mint one-time, end-to-end-encrypted burnable
// links via gpg + curl against the external onetime/Yopass service (NOT the Terminal Hub server). Plain
// double-quoted JS strings so the shell's ${...}/$(...)/single-quotes survive; only JSON/shell " are
// escaped and \\ is a shell line-continuation. Mirrors .claude/commands/onetime-secret.md.
const SECRET_SNIPPET = [
  "## Create one-time burnable secret links",
  "",
  "When I ask you to share a password, API key, or any secret, mint a one-time end-to-end-encrypted",
  "link instead of pasting it in plaintext. Encrypt locally with gpg, upload only the ciphertext, and",
  "keep the decryption key in the URL fragment — the server never sees the secret or the key.",
  "",
  "```bash",
  "BASE=https://your-onetime-instance.example",
  "KEY=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 22)            # URL-safe decryption key",
  "ENC=$(printf '%s' \"YOUR SECRET\" | \\",
  "  gpg --batch --yes --symmetric --armor --cipher-algo AES256 --passphrase \"$KEY\" --pinentry-mode loopback)",
  "RESP=$(curl -sS \"$BASE/create/secret\" -H 'content-type: application/json' \\",
  "  -d \"$(jq -n --arg m \"$ENC\" '{message:$m, expiration:3600, one_time:true, creator_burn_only:true}')\")",
  "ID=$(printf '%s' \"$RESP\" | jq -r '.message')",
  "BURN=$(printf '%s' \"$RESP\" | jq -r '.burn_token // empty')             # keep this to burn it early",
  "echo \"$BASE/#/s/$ID/$KEY\"",
  "```",
  "",
  "- expiration is seconds (3600=1h, 86400=1d, 604800=1w); one_time:true self-destructs after first open.",
  "- creator_burn_only:true returns a burn_token; destroy early with:",
  "  curl -X DELETE \"$BASE/secret/$ID\" -H \"X-Yopass-Burn-Token: $BURN\"",
  "- Share the one-click link as-is, or share \"$BASE/#/s/$ID\" and send the key \"$KEY\" separately.",
  "- Needs gpg, curl, jq. Never print the plaintext secret back — share the link only.",
].join("\n");

// A bare one-liner that mints a burnable link by hand from any terminal (needs gpg, curl, jq).
const SECRET_TEST =
  "BASE=https://your-onetime-instance.example; KEY=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom|head -c 22); ENC=$(printf 'hello from your agent'|gpg --batch --yes --symmetric --armor --cipher-algo AES256 --passphrase \"$KEY\" --pinentry-mode loopback); ID=$(curl -sS \"$BASE/create/secret\" -H 'content-type: application/json' -d \"$(jq -n --arg m \"$ENC\" '{message:$m,expiration:3600,one_time:true,creator_burn_only:true}')\"|jq -r .message); echo \"$BASE/#/s/$ID/$KEY\"";

// CLAUDE.md / AGENTS.md block teaching an agent to schedule calendar reminders. Reminders API is
// plain JSON, so only the JSON " need escaping; \\ is a shell line-continuation. Mirrors
// docs/AGENT-CALENDAR.md.
const CALENDAR_SNIPPET = [
  "## Schedule reminders through Terminal Hub",
  "",
  "You're running inside a Terminal Hub terminal. When I ask you to remind me about something — a deploy",
  "window, a meeting, \"ping me in 2 hours\" — schedule it so it fires a dashboard toast (and a push to",
  "my phone if I've set up Pushover). It's on the host next to the server, so reach it on 127.0.0.1",
  "with no token.",
  "",
  "```bash",
  "# remind me in 2 hours (no epoch-ms math needed)",
  "curl -sS -X POST http://127.0.0.1:8189/api/reminders \\",
  "  -H 'content-type: application/json' \\",
  "  -d '{\"title\":\"Check the deploy\",\"fireInMinutes\":120}'",
  "",
  "# or at an absolute local time — include my timezone offset",
  "curl -sS -X POST http://127.0.0.1:8189/api/reminders \\",
  "  -H 'content-type: application/json' \\",
  "  -d '{\"title\":\"Standup\",\"fireAtISO\":\"2026-06-20T09:00:00-07:00\"}'",
  "```",
  "",
  "- title (required). Set the time with ONE of: fireInMinutes (relative), fireAtISO (absolute ISO),",
  "  or fireAt (epoch ms). body is an optional description.",
  "- channels defaults to in-app + spoken; add \"channels\":{\"inApp\":true,\"pushover\":true,\"speak\":true} to also push to my phone.",
  "- To repeat: \"recurrence\":{\"freq\":\"weekly\",\"interval\":1,\"until\":null,\"count\":null} (freq: daily|weekly|monthly|yearly).",
].join("\n");

// A bare one-liner for scheduling a test reminder (fires in ~1 minute) by hand from any terminal.
const CALENDAR_TEST =
  "curl -sS -X POST http://127.0.0.1:8189/api/reminders -H 'content-type: application/json' -d '{\"title\":\"hello from your agent\",\"fireInMinutes\":1}'";

// CLAUDE.md / AGENTS.md block teaching an agent to track work time on the Timesheet. The time API is
// plain JSON, so only the JSON " need escaping; \\ is a shell line-continuation. Start auto-adds any
// unknown client/project/task to the catalog, so there's no setup step. Mirrors docs/FEATURES.md.
const TIMESHEET_SNIPPET = [
  "## Track my work time in Terminal Hub",
  "",
  "You're running inside a Terminal Hub terminal. When I tell you to start working on something for a",
  "client, start a timer; when it's done or I say stop, stop it. It's the Timesheet tool, server-backed",
  "on 127.0.0.1 with no token. Unknown client/project/task names are auto-added to the catalog — no setup.",
  "",
  "```bash",
  "# start a timer (client required; project/task/notes optional) — returns the entry with its \"id\"",
  "curl -sS -X POST http://127.0.0.1:8189/api/time/start \\",
  "  -H 'content-type: application/json' \\",
  "  -d '{\"client\":\"Acme Co\",\"project\":\"Website\",\"task\":\"Programming\",\"notes\":\"hero section\"}'",
  "",
  "# stop a timer: by id, OR by \"client\" (stops every running timer for that client), OR {} (stops the latest)",
  "curl -sS -X POST http://127.0.0.1:8189/api/time/stop \\",
  "  -H 'content-type: application/json' \\",
  "  -d '{\"id\":\"te_...\"}'",
  "",
  "# see today's entries — each has an \"id\", a \"startedAt\", and \"stoppedAt\" (null = still running)",
  "curl -sS http://127.0.0.1:8189/api/time/entries",
  "```",
  "",
  "- Only client is required to start; project, task, and notes are optional. Grab the id from the start call.",
  "- A null stoppedAt means the timer is still running. Several timers can run at once.",
  "- Review another day with epoch-ms bounds: /api/time/entries?from=<ms>&to=<ms>.",
].join("\n");

// A bare one-liner for starting a test timer by hand from any terminal.
const TIMESHEET_TEST =
  "curl -sS -X POST http://127.0.0.1:8189/api/time/start -H 'content-type: application/json' -d '{\"client\":\"Test Client\",\"task\":\"Programming\"}'";

type Tab = "messaging" | "board" | "notes" | "calendar" | "timesheet" | "secrets" | "sharing" | "copilot";

const RECT_KEY = "tr.helpRect"; // remembered window geometry (per-browser)
const MIN_W = 520, MIN_H = 360;
const DURATION = 300;           // ms — grow-from-icon / minimize-to-icon animation

/** A comfortable reading width, centered and clamped below the spaces bar. */
function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(860, Math.round(vw * 0.72));
  const h = Math.min(680, Math.round(vh * 0.8));
  const top = spacesBarBottom() + 8;
  return { w, h, x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(top, Math.round((vh - h) / 2)) };
}

/** Restore saved geometry, clamped back into the current viewport. */
function loadRect(): WinRect {
  try {
    const raw = localStorage.getItem(RECT_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<WinRect>;
      if (typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.h === "number") {
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = Math.max(MIN_W, Math.min(r.w, vw - 16));
        const h = Math.max(MIN_H, Math.min(r.h, vh - 16));
        return { w, h, x: Math.max(8, Math.min(vw - 80, r.x)), y: Math.max(8, Math.min(vh - 60, r.y)) };
      }
    }
  } catch { /* ignore corrupt/blocked storage */ }
  return defaultRect();
}

/** Help: how a coding agent running inside a room works with the dashboard — one tab for messaging
 *  (toast + voice) and one for the task board (read/move cards). A free-floating, draggable,
 *  resizable window (like the notepad/board) that grows out of the `?` icon and minimizes back into
 *  it on close. Copy-paste blocks for CLAUDE.md / AGENTS.md so each is always within reach. */
export const HelpModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(function HelpModal({ origin, onClose }, ref) {
  const [tab, setTab] = useState<Tab>("messaging");
  const [seed] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "help");

  // Grow-from-icon on open, minimize-to-icon on close (same trick as the notepad/board windows).
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const handleClose = () => { if (reduce) { onClose(); return; } setExpanded(false); };
  // Expose the same minimize-to-icon close to the TopBar Help icon so a second press collapses it.
  useImperativeHandle(ref, () => ({ close: handleClose }));
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
  };

  // Remember geometry, debounced so drag/resize doesn't hammer localStorage every frame.
  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(RECT_KEY, JSON.stringify(rect)); } catch { /* blocked */ } }, 300);
    return () => window.clearTimeout(t);
  }, [rect]);

  const collapsed = origin
    ? `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px) scale(${origin.w / rect.w}, ${origin.h / rect.h})`
    : "scale(0.94)";
  const style: CSSProperties = {
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    ...(reduce ? {} : {
      transformOrigin: origin ? "0 0" : "50% 50%",
      transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
      opacity: expanded ? 1 : 0,
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  return (
    <div onTransitionEnd={onTransitionEnd} style={style}
      className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
      <div onPointerDown={beginDrag}
        className="h-8 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none">
        <div className="font-semibold">How agents work with Terminal Hub</div>
        <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={handleClose} title="Close"
            className="px-3 h-6 inline-flex items-center bg-elevated rounded text-sm">Close</button>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-1 px-4 border-b border-edge">
        <TabButton active={tab === "messaging"} onClick={() => setTab("messaging")}>Messaging</TabButton>
        <TabButton active={tab === "board"} onClick={() => setTab("board")}>Task board</TabButton>
        <TabButton active={tab === "notes"} onClick={() => setTab("notes")}>Notes</TabButton>
        <TabButton active={tab === "calendar"} onClick={() => setTab("calendar")}>Calendar</TabButton>
        <TabButton active={tab === "timesheet"} onClick={() => setTab("timesheet")}>Timesheet</TabButton>
        <TabButton active={tab === "secrets"} onClick={() => setTab("secrets")}>Secrets</TabButton>
        <TabButton active={tab === "sharing"} onClick={() => setTab("sharing")}>Sharing</TabButton>
        <TabButton active={tab === "copilot"} onClick={() => setTab("copilot")}>Assistant</TabButton>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-5 space-y-6 text-sm leading-relaxed">
        {tab === "messaging" ? <MessagingHelp /> : tab === "board" ? <BoardHelp /> : tab === "notes" ? <NotesHelp /> : tab === "calendar" ? <CalendarHelp /> : tab === "timesheet" ? <TimesheetHelp /> : tab === "secrets" ? <SecretsHelp /> : tab === "sharing" ? <SharingHelp /> : <CopilotHelp />}
      </div>

      <ResizeHandles onStart={beginResize} />
    </div>
  );
});

/** Tab one: pinging the dashboard (toast + voice). */
function MessagingHelp() {
  return (
    <>
      <p className="text-fg">
        A coding agent running in a room can ping this dashboard — a toast slides in, a chime
        plays, and the message is read aloud — so you notice even when you're looking at another
        terminal or space. The agent is on the host next to the server, so it always reaches it
        on <code className="text-bright">127.0.0.1</code> with no token.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-bright">1. Make your agent do it automatically</div>
          <CopyButton text={CLAUDE_SNIPPET} label="Copy snippet" />
        </div>
        <p className="text-dim">
          Paste this into the <code className="text-fg">CLAUDE.md</code> (or{" "}
          <code className="text-fg">AGENTS.md</code>) of any project you open as a workspace. The
          agent reads it on launch and pings you at the right moments.
        </p>
        <CodeBlock text={CLAUDE_SNIPPET} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-bright">2. Or send one yourself to test</div>
          <CopyButton text={CURL_ONELINER} label="Copy command" />
        </div>
        <p className="text-dim">Run this in any terminal inside a room — you should get a toast.</p>
        <CodeBlock text={CURL_ONELINER} />
      </div>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">Good to know</div>
        <ul className="list-disc pl-5 space-y-1">
          <li><span className="text-fg">level</span> is <span className="text-fg">info</span>, <span className="text-fg">success</span>, <span className="text-fg">warn</span>, or <span className="text-fg">error</span> — it colors the toast.</li>
          <li>Clicking a toast jumps to the terminal that sent it (slides to its space, restores it if minimized).</li>
          <li>Tune it in <span className="text-fg">Settings → Voice &amp; Speech</span>: toast position, speak on/off, chime, and speed.</li>
          <li>Default port is <span className="text-fg">8189</span> — if you changed <span className="text-fg">PORT</span>, use that instead.</li>
          <li>Full reference: <span className="text-fg">docs/AGENT-MESSAGING.md</span>.</li>
        </ul>
      </div>
    </>
  );
}

/** Tab two: reading and moving cards on the task board. */
function BoardHelp() {
  return (
    <>
      <p className="text-fg">
        The task board (the kanban window) is server-backed, so an agent in a room can drive it too —
        add a task, push it to <code className="text-bright">In&nbsp;Progress</code>, mark it{" "}
        <code className="text-bright">Done</code>. It's on <code className="text-bright">127.0.0.1</code>{" "}
        with no token, and the board reflects the change on its own within a couple seconds.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-bright">1. Teach your agent to keep it updated</div>
          <CopyButton text={BOARD_SNIPPET} label="Copy snippet" />
        </div>
        <p className="text-dim">
          Paste this into the <code className="text-fg">CLAUDE.md</code> (or{" "}
          <code className="text-fg">AGENTS.md</code>) of any project you open as a workspace, so the
          agent moves cards as it works.
        </p>
        <CodeBlock text={BOARD_SNIPPET} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-bright">2. Or add one yourself to test</div>
          <CopyButton text={BOARD_TEST} label="Copy command" />
        </div>
        <p className="text-dim">Run this in any terminal — a card lands in To Do within a couple seconds.</p>
        <CodeBlock text={BOARD_TEST} />
      </div>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">Good to know</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Columns are <span className="text-fg">todo</span> (To Do), <span className="text-fg">doing</span> (In Progress), and <span className="text-fg">done</span> (Done).</li>
          <li><span className="text-fg">position</span> orders cards within a column (0 = top); <span className="text-fg">color</span> is a hex accent (or <span className="text-fg">null</span> to clear).</li>
          <li>On the board itself: drag cards between lanes, double-click to edit, and <span className="text-fg">right-click</span> a card for color (the shade picker), move, or delete.</li>
          <li>Click a card to select it, then press <span className="text-fg">Delete</span> (or Backspace) to remove it.</li>
          <li>Cards live in SQLite (table <span className="text-fg">board_cards</span>) — color and all — durable across restarts and refreshes.</li>
          <li>Default port is <span className="text-fg">8189</span> — if you changed <span className="text-fg">PORT</span>, use that instead.</li>
        </ul>
      </div>
    </>
  );
}

/** Tab: saving notes into the Notes panel (markdown notes, optionally filed into groups). */
function NotesHelp() {
  return (
    <>
      <p className="text-fg">
        The Notes panel (the notepad window) is server-backed too, so an agent in a room can write to it —
        save a summary, a plan, or findings as a markdown note, and file it into a group if you like. It's
        on <code className="text-bright">127.0.0.1</code> with no token, and the panel shows the new note
        on its own the next time it's opened.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-bright">1. Teach your agent to save notes</div>
          <CopyButton text={NOTES_SNIPPET} label="Copy snippet" />
        </div>
        <p className="text-dim">
          Paste this into the <code className="text-fg">CLAUDE.md</code> (or{" "}
          <code className="text-fg">AGENTS.md</code>) of any project you open as a workspace, so the
          agent jots notes into the panel as it works.
        </p>
        <CodeBlock text={NOTES_SNIPPET} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-bright">2. Or add one yourself to test</div>
          <CopyButton text={NOTES_TEST} label="Copy command" />
        </div>
        <p className="text-dim">Run this in any terminal — a note appears in the Notes panel.</p>
        <CodeBlock text={NOTES_TEST} />
      </div>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">Good to know</div>
        <ul className="list-disc pl-5 space-y-1">
          <li><span className="text-fg">content</span> is markdown — the note opens in the rich editor (bold, headings, lists, links, tables, code), with a raw-source toggle.</li>
          <li><span className="text-fg">groupId</span> files a note into a group (a <span className="text-fg">ng_…</span> id from <span className="text-fg">/api/note-groups</span>); omit it or send <span className="text-fg">null</span> to leave it ungrouped.</li>
          <li>One <span className="text-fg">PATCH /api/notes/&lt;id&gt;</span> updates any of title, content, or groupId; <span className="text-fg">DELETE</span> removes a note.</li>
          <li>In the panel itself: drag a note onto a group, <span className="text-fg">right-click</span> for Copy / Duplicate / Move / Delete, and search across every note.</li>
          <li>Notes live in SQLite (tables <span className="text-fg">notes</span> + <span className="text-fg">note_groups</span>) — durable across restarts and refreshes.</li>
          <li>Default port is <span className="text-fg">8189</span> — if you changed <span className="text-fg">PORT</span>, use that instead.</li>
        </ul>
      </div>
    </>
  );
}

/** Tab: scheduling calendar reminders that fire a toast / Pushover push. */
function CalendarHelp() {
  return (
    <>
      <p className="text-fg">
        The <code className="text-bright">Calendar</code> (launcher → Tools) is server-backed, so an
        agent in a room can schedule reminders too — "ping me in 2 hours", a deploy window, a meeting.
        At the set time it fires a dashboard toast (read aloud), and pushes to your phone if you've set
        up Pushover. It's on <code className="text-bright">127.0.0.1</code> with no token.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-bright">1. Teach your agent to schedule reminders</div>
          <CopyButton text={CALENDAR_SNIPPET} label="Copy snippet" />
        </div>
        <p className="text-dim">
          Paste this into the <code className="text-fg">CLAUDE.md</code> (or{" "}
          <code className="text-fg">AGENTS.md</code>) of any project you open as a workspace.
        </p>
        <CodeBlock text={CALENDAR_SNIPPET} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-bright">2. Or schedule one yourself to test</div>
          <CopyButton text={CALENDAR_TEST} label="Copy command" />
        </div>
        <p className="text-dim">Run this in any terminal — a toast fires in about a minute, and it lands in the bell.</p>
        <CodeBlock text={CALENDAR_TEST} />
      </div>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">Good to know</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Set the time with <span className="text-fg">fireInMinutes</span> (relative), <span className="text-fg">fireAtISO</span> (absolute ISO with your offset), or <span className="text-fg">fireAt</span> (epoch ms) — no shell date math needed.</li>
          <li><span className="text-fg">channels</span> defaults to in-app + spoken; add <span className="text-fg">pushover:true</span> to push to your phone (needs keys in Settings → Voice &amp; Speech).</li>
          <li>Repeat with <span className="text-fg">recurrence</span> (daily / weekly / monthly / yearly); <span className="text-fg">leadMinutes</span> alerts you ahead of time.</li>
          <li>Reminders fire within ~30s and survive restarts; one missed while the server was down fires on the next boot, tagged "(missed)".</li>
          <li>Full reference: <span className="text-fg">docs/AGENT-CALENDAR.md</span>.</li>
        </ul>
      </div>
    </>
  );
}

/** Tab: tracking work time on the Timesheet (start/stop timers, review totals). */
function TimesheetHelp() {
  return (
    <>
      <p className="text-fg">
        The <code className="text-bright">Timesheet</code> (launcher → Tools) is a Harvest-style time
        tracker, server-backed — so an agent in a room can run your clock too. Tell it to start working
        for a client and it starts a timer; when the job's done, it stops it. It's on{" "}
        <code className="text-bright">127.0.0.1</code> with no token, and unknown client / project /
        task names are <span className="text-bright">auto-added to the catalog</span>, so there's no
        setup step.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-bright">1. Teach your agent to track time</div>
          <CopyButton text={TIMESHEET_SNIPPET} label="Copy snippet" />
        </div>
        <p className="text-dim">
          Paste this into the <code className="text-fg">CLAUDE.md</code> (or{" "}
          <code className="text-fg">AGENTS.md</code>) of any project you open as a workspace, so the
          agent starts and stops timers as it works.
        </p>
        <CodeBlock text={TIMESHEET_SNIPPET} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-bright">2. Or start one yourself to test</div>
          <CopyButton text={TIMESHEET_TEST} label="Copy command" />
        </div>
        <p className="text-dim">Run this in any terminal — a running timer for “Test Client” shows up in the Timesheet within a couple seconds.</p>
        <CodeBlock text={TIMESHEET_TEST} />
      </div>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">Good to know</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Only <span className="text-fg">client</span> is required to start; <span className="text-fg">project</span>, <span className="text-fg">task</span>, and <span className="text-fg">notes</span> are optional.</li>
          <li>Stop by <span className="text-fg">id</span>, by <span className="text-fg">client</span> (stops every running timer for that client), or with an empty body <span className="text-fg">{"{}"}</span> (stops the most recent).</li>
          <li>A <span className="text-fg">null</span> stoppedAt means a timer is still running — and several can run at once.</li>
          <li>Log forgotten time with <span className="text-fg">POST /api/time/entries</span> (supply <span className="text-fg">startedAt</span>, optional <span className="text-fg">stoppedAt</span>); edit or delete an entry by id with PATCH / DELETE.</li>
          <li>Review any day, week, or month in the panel — or fetch a range with <span className="text-fg">/api/time/entries?from=&lt;ms&gt;&amp;to=&lt;ms&gt;</span> (epoch ms).</li>
          <li>Manage clients, projects, and task types (and the look) in the Timesheet's own <span className="text-fg">Settings</span> tab.</li>
          <li>Default port is <span className="text-fg">8189</span> — if you changed <span className="text-fg">PORT</span>, use that instead.</li>
        </ul>
      </div>
    </>
  );
}

/** Tab: the in-app Copilot — what it is and how to use it (chat, skills, email, schedules). */
function CopilotHelp() {
  return (
    <>
      <p className="text-fg">
        The <code className="text-bright">Assistant</code> is an in-app AI assistant that knows this whole
        app and can act on it. Open it from the floating <span className="text-bright">orb</span> in the
        corner of the canvas or the <span className="text-bright">Assistant</span> tile in the launcher.
        Turn it on/off and place the orb in <code className="text-bright">Settings → Assistant</code>.
      </p>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">Chat — ask or tell</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Ask about any feature ("how do I share a room?") — it answers from the app's own docs.</li>
          <li>Tell it to do things: <span className="text-fg">"add milk to my notes"</span>, <span className="text-fg">"move the deploy card to Done"</span>, <span className="text-fg">"remind me in 30 minutes"</span>. Each action shows as a chip with its result.</li>
          <li>Anything that types into a terminal asks you to <span className="text-fg">confirm</span> first.</li>
          <li>It runs on whichever AI provider you've configured (Anthropic or any OpenAI-compatible key).</li>
        </ul>
      </div>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">Skills — give it new abilities</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>The <span className="text-fg">Skills</span> tab lists capabilities you toggle on. <span className="text-fg">Core</span> (notes, board, reminders, alerts, terminals) is always on.</li>
          <li><span className="text-fg">Email</span>: connect a mailbox (Gmail, iCloud, Outlook, Yahoo, or any IMAP) with an <span className="text-fg">app-specific password</span> — stored on the server, never shown again. Then ask <span className="text-fg">"any unread from my bank this week?"</span> and it checks the right mailbox.</li>
        </ul>
      </div>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">Schedules — loops that report back</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Put a tool on a repeating loop: <span className="text-fg">"check my email every 30 minutes and tell me when something new lands"</span>, or build one in the <span className="text-fg">Schedules</span> tab.</li>
          <li>Pick how it reports: every run, only when the result changes, or only when it finds something — via toast, voice, or Pushover.</li>
          <li>Loops run server-side, survive restarts, and never auto-run a terminal-typing tool. Pause or delete any from the Schedules tab.</li>
        </ul>
      </div>
    </>
  );
}

/** Tab three: the one-time burnable secret link tool (the Secret window + the CLI recipe). */
function SecretsHelp() {
  return (
    <>
      <p className="text-fg">
        The <code className="text-bright">Secret</code> tool (launcher → Tools) creates a burnable,
        end-to-end-encrypted link for a password or any secret. Your text is encrypted{" "}
        <span className="text-bright">in your browser</span> before anything is sent — the server
        only ever stores ciphertext, and the decryption key rides in the link's{" "}
        <code className="text-fg">#</code> fragment, which the server never receives. The link
        self-destructs after the first open (or after the views / expiry you pick).
      </p>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">In the dashboard</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Type the secret, choose how long it lives, and how many opens (1 = one-time).</li>
          <li>You get three things: a <span className="text-fg">one-click link</span> (key in the URL), a <span className="text-fg">short link</span>, and the <span className="text-fg">decryption key</span> to send separately.</li>
          <li><span className="text-fg">Who can destroy it early</span>: “Only me” keeps a burn key in this browser; “Anyone with the link” lets any holder destroy it.</li>
          <li><span className="text-fg">Destroy now</span> burns the link before it expires.</li>
        </ul>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-bright">Let your agent mint links from the CLI</div>
          <CopyButton text={SECRET_SNIPPET} label="Copy snippet" />
        </div>
        <p className="text-dim">
          Paste this into the <code className="text-fg">CLAUDE.md</code> (or{" "}
          <code className="text-fg">AGENTS.md</code>) of any project, or drop the{" "}
          <code className="text-fg">/onetime-secret</code> command into{" "}
          <code className="text-fg">.claude/commands/</code>. The agent encrypts locally with gpg and
          uploads only ciphertext — the same zero-knowledge model as the dashboard.
        </p>
        <CodeBlock text={SECRET_SNIPPET} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-bright">Or mint one yourself to test</div>
          <CopyButton text={SECRET_TEST} label="Copy command" />
        </div>
        <p className="text-dim">
          Needs <span className="text-fg">gpg</span>, <span className="text-fg">curl</span>, and{" "}
          <span className="text-fg">jq</span> — prints a one-click link.
        </p>
        <CodeBlock text={SECRET_TEST} />
      </div>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">Good to know</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>This talks to an external service (<span className="text-fg">your-onetime-instance.example</span>), not the Terminal Hub server — so it works the same from your browser, the VPS, or any terminal.</li>
          <li><span className="text-fg">creator_burn_only</span> returns a <span className="text-fg">burn_token</span> — the only way to destroy a link early; it stays in your browser (or your shell).</li>
          <li>The decryption key never reaches the server, so a leaked short link without its key is useless on its own.</li>
          <li>Self-hosting? Point <span className="text-fg">ONETIME_BASE</span> at your own instance — the API is Yopass-compatible.</li>
          <li>Full API + recipes: the <span className="text-fg">/onetime-secret</span> command file.</li>
        </ul>
      </div>
    </>
  );
}

/** Tab: sharing a temporary access link so a friend/teammate can join your session. */
function SharingHelp() {
  return (
    <>
      <p className="text-fg">
        The <code className="text-bright">Share</code> tool (launcher → System) lets a friend or
        teammate into <span className="text-bright">your live session</span> with a temporary link —
        no need to hand out your access token. They land in the same rooms you're in, and because the
        terminals are tmux-backed, you're both driving the <span className="text-bright">same live
        panes</span> at once.
      </p>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">1. Generate &amp; share a link</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Open <span className="text-fg">Share</span>, name the link (who it's for), optionally point it at a <span className="text-fg">room</span> (it auto-opens for them on arrival), and pick a <span className="text-fg">time limit</span> (1h / 24h / 7d / 30d / never).</li>
          <li>Hit <span className="text-fg">Generate</span>, then <span className="text-fg">Copy link</span> and send it however you like. Opening it drops them straight in — the secret is pulled from the link and stripped from their address bar, so there's nothing to type.</li>
        </ul>
      </div>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">2. Let them in (or don't)</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Using a link doesn't let them in yet — an <span className="text-fg">Accept / Decline</span> box pops in the center of your screen first. <span className="text-fg">Accept</span> lets them in; <span className="text-fg">Decline</span> revokes that link.</li>
          <li>Once accepted, a refresh or a brief network drop won't re-ask you — they come straight back in until you kick or revoke.</li>
        </ul>
      </div>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">3. Stay in control</div>
        <ul className="list-disc pl-5 space-y-1">
          <li><span className="text-fg">Who's here</span> lists everyone connected. <span className="text-fg">Kick</span> disconnects them now (the link still works — they can ask to rejoin).</li>
          <li><span className="text-fg">Revoke</span> on a link kills it for good and closes all of that person's connections instantly. Expired links delete themselves.</li>
        </ul>
      </div>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">Reaching someone off your network</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>A friend across the world can only reach you through a <span className="text-fg">public address</span>, not your <span className="text-fg">192.168.x.x</span> LAN IP (which only works on your own WiFi). Your home router blocks incoming connections, so the traffic has to come in through a tunnel.</li>
          <li>Easiest way: hit <span className="text-fg">Make a public link</span> at the bottom of the Share window. It spins up a free <span className="text-fg">Cloudflare tunnel</span> (no account) and fills in a <span className="font-mono text-fg">https://….trycloudflare.com</span> address that every link then uses. One-time setup: install the <span className="font-mono">cloudflared</span> tool (<span className="font-mono">brew install cloudflared</span>). The link stays up until you press <span className="text-fg">Stop</span> or quit the server, and you get a fresh address each time.</li>
          <li>Already run your own tunnel? Just paste its URL into the <span className="text-fg">Public share URL</span> field instead — when you're on localhost/LAN that field turns <span className="text-amber-400">amber</span> to remind you.</li>
        </ul>
      </div>

      <div className="space-y-1.5 text-dim">
        <div className="font-medium text-bright">Good to know</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>The link's secret is like a password in the URL — prefer short expiries, and revoke when you're done.</li>
          <li>Anyone with a live link has <span className="text-fg">full access</span> (same as you) once admitted — only share with people you trust.</li>
          <li>Admission resets if the <span className="text-fg">server restarts</span> — they'll ask to rejoin, and you'll re-accept.</li>
          <li>Teammates don't see the <span className="text-fg">Share</span> tool — only you (the host) can mint, revoke, accept, or kick.</li>
        </ul>
      </div>
    </>
  );
}

/** Underlined tab button — active tab gets the accent border + bright text. */
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 -mb-px ${active ? "border-blue-500 text-bright" : "border-transparent text-dim hover:text-fg"}`}>
      {children}
    </button>
  );
}

/** A monospace, horizontally-scrollable code block. */
function CodeBlock({ text }: { text: string }) {
  return (
    <pre className="rounded-md border border-edge bg-panel p-3 overflow-x-auto text-xs text-fg whitespace-pre">{text}</pre>
  );
}

/** Copy-to-clipboard button with a brief "Copied" confirmation. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void copyText(text).then((ok) => {
          if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
        });
      }}
      className="shrink-0 px-2.5 py-1 rounded bg-elevated hover:bg-edge text-xs text-fg hover:text-bright"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
