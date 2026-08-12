import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type Store } from "./store.js";

// GUI mode used to mean Claude, full stop — a chat terminal stored no launch command of its own and
// nobody minded. Now the launch command is what decides WHICH agent the chat drives, so a chat with
// no command would inherit its workspace's: in a Codex workspace that silently re-points an existing
// Claude conversation at Codex, which cannot resume a Claude session id. The boot migration pins
// those rows to Claude once.

describe("gui agent backfill on a pre-Codex DB", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  /** A workspace launched with `codex` holding one terminal, created the way the caller says. */
  function seed(store: Store, over: { mode: "tmux" | "gui"; launchCommandOverride: string | null }) {
    const ws = store.createWorkspace({ name: "A", folder: "/w", launchCommand: "codex", color: null });
    return store.createTerminal({
      workspaceId: ws.id, title: "T", color: null, tmuxSession: "tr_x",
      launchCommandOverride: over.launchCommandOverride, mode: over.mode, agentSessionId: null,
    });
  }

  /** Drop the marker the first boot wrote, so the next one sees a DB that predates the migration. */
  function unmark(dbPath: string) {
    const raw = new Database(dbPath);
    raw.prepare(`DELETE FROM settings WHERE key='guiAgentBackfill'`).run();
    raw.close();
  }

  it("pins an existing chat that stored no launch command to Claude", () => {
    dir = mkdtempSync(join(tmpdir(), "th-gui-agent-mig-"));
    const dbPath = join(dir, "old.db");

    const first = createStore(dbPath);
    const chat = seed(first, { mode: "gui", launchCommandOverride: null });
    const pane = seed(first, { mode: "tmux", launchCommandOverride: null });
    unmark(dbPath);

    const second = createStore(dbPath);
    expect(second.getTerminal(chat.id)!.launchCommandOverride).toBe("claude");
    // A pane is untouched — it really does inherit the workspace's command.
    expect(second.getTerminal(pane.id)!.launchCommandOverride).toBeNull();
  });

  it("leaves a chat that named its own agent alone", () => {
    dir = mkdtempSync(join(tmpdir(), "th-gui-agent-mig2-"));
    const dbPath = join(dir, "old.db");

    const first = createStore(dbPath);
    const chat = seed(first, { mode: "gui", launchCommandOverride: "codex" });
    unmark(dbPath);

    expect(createStore(dbPath).getTerminal(chat.id)!.launchCommandOverride).toBe("codex");
  });

  it("runs once — a chat opened afterwards may still inherit its workspace's agent", () => {
    dir = mkdtempSync(join(tmpdir(), "th-gui-agent-mig3-"));
    const dbPath = join(dir, "old.db");

    const first = createStore(dbPath);
    // A pane switched into GUI keeps whatever command it had, including none.
    const chat = seed(first, { mode: "gui", launchCommandOverride: null });

    expect(createStore(dbPath).getTerminal(chat.id)!.launchCommandOverride).toBeNull();
  });
});
