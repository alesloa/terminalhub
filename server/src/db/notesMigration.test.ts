import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "../context.js";

// Regression for the "no such column: groupId" boot crash: a prod DB whose `notes` table predates the
// groups feature must migrate cleanly. The index on notes(groupId) must be created AFTER the ALTER
// adds the column (in the store migration), never in schema.sql — there it runs against the old table
// before the column exists and throws during schema.exec, crash-looping the server on boot.
describe("notes groupId migration on a pre-groups DB", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("boots cleanly against an old notes table, adding groupId + its index without losing rows", () => {
    dir = mkdtempSync(join(tmpdir(), "th-notes-mig-"));
    const dbPath = join(dir, "old.db");

    // Seed an OLD-schema notes table (no groupId) with a row — exactly like a prod DB from before groups.
    const seed = new Database(dbPath);
    seed.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`);
    seed.prepare(`INSERT INTO notes (id,title,content,createdAt,updatedAt) VALUES (?,?,?,?,?)`).run("np_old", "Old", "kept", 1, 1);
    seed.close();

    // Booting the store against that file must NOT throw (this is what crash-looped prod).
    const ctx = createContext(dbPath);

    // The pre-existing note survives and is now ungrouped.
    const notes = ctx.store.listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe("np_old");
    expect(notes[0].groupId).toBeNull();

    // The index + column are usable: a group + assignment round-trips.
    const g = ctx.store.createNoteGroup({ name: "Research" });
    ctx.store.updateNote("np_old", { groupId: g.id });
    expect(ctx.store.getNote("np_old")!.groupId).toBe(g.id);
  });
});
