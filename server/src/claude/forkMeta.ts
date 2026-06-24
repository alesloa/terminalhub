import { promises as fs } from "node:fs";
import path from "node:path";
import type { ForkInfo, ForkMetadata } from "./types.js";

// Parent→child fork relationships live in fork-metadata.json beside the transcripts (same
// file the extension uses). Lets us show a forked session under its parent and cascade-delete.

export async function getForkMetadata(dir: string): Promise<ForkMetadata> {
  try {
    const parsed: ForkMetadata = JSON.parse(await fs.readFile(path.join(dir, "fork-metadata.json"), "utf-8"));
    return parsed.forks ? parsed : { forks: {} };
  } catch {
    return { forks: {} };
  }
}

export async function addFork(dir: string, newSessionId: string, parentSessionId: string): Promise<void> {
  const metadata = await getForkMetadata(dir);
  metadata.forks[newSessionId] = { parentSessionId, forkedAt: new Date().toISOString() };
  await fs.writeFile(path.join(dir, "fork-metadata.json"), JSON.stringify(metadata, null, 2));
}

export async function removeFork(dir: string, sessionId: string): Promise<void> {
  const metadata = await getForkMetadata(dir);
  delete metadata.forks[sessionId];
  await fs.writeFile(path.join(dir, "fork-metadata.json"), JSON.stringify(metadata, null, 2));
}

export function getForkInfo(metadata: ForkMetadata, sessionId: string): ForkInfo | undefined {
  return metadata.forks[sessionId];
}

/** Child session ids whose parent is `sessionId` (one level). */
export function childrenOf(metadata: ForkMetadata, sessionId: string): string[] {
  return Object.entries(metadata.forks)
    .filter(([, info]) => info.parentSessionId === sessionId)
    .map(([childId]) => childId);
}

export async function clearAllForks(dir: string): Promise<void> {
  try {
    await fs.writeFile(path.join(dir, "fork-metadata.json"), JSON.stringify({ forks: {} }, null, 2));
  } catch {
    // no-op if directory doesn't exist
  }
}
