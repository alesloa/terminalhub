import { promises as fs } from "node:fs";
import path from "node:path";
import type { SessionNames } from "./types.js";

// Custom session titles live in session-names.json alongside the transcripts — the same
// file the CLI + VS Code extension use, so renames stay compatible across all three.

export async function getCustomNames(dir: string): Promise<Record<string, string>> {
  const filePath = path.join(dir, "session-names.json");
  try {
    const parsed: SessionNames = JSON.parse(await fs.readFile(filePath, "utf-8"));
    return parsed.names || {};
  } catch {
    return {};
  }
}

export async function setCustomName(dir: string, sessionId: string, name: string): Promise<void> {
  const filePath = path.join(dir, "session-names.json");
  let existing: SessionNames = { names: {} };
  try {
    existing = JSON.parse(await fs.readFile(filePath, "utf-8"));
    if (!existing.names) existing.names = {};
  } catch {
    // file doesn't exist yet — start fresh
  }
  existing.names[sessionId] = name;
  await fs.writeFile(filePath, JSON.stringify(existing, null, 2));
}

export async function removeCustomName(dir: string, sessionId: string): Promise<void> {
  const filePath = path.join(dir, "session-names.json");
  try {
    const existing: SessionNames = JSON.parse(await fs.readFile(filePath, "utf-8"));
    if (existing.names) {
      delete existing.names[sessionId];
      await fs.writeFile(filePath, JSON.stringify(existing, null, 2));
    }
  } catch {
    // nothing to remove
  }
}

export async function clearAllCustomNames(dir: string): Promise<void> {
  const filePath = path.join(dir, "session-names.json");
  try {
    await fs.writeFile(filePath, JSON.stringify({ names: {} }, null, 2));
  } catch {
    // no-op if the directory doesn't exist
  }
}
