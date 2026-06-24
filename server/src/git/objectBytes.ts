import { execFile } from "node:child_process";

/** Runs `git <args>` capturing stdout as RAW BYTES (not utf8). Injectable so tests stay off real git,
 *  mirroring the GitRunner pattern. `code` is the process exit code (non-zero = the object is absent). */
export type BufferExec = (args: string[], cwd: string) => Promise<{ buffer: Buffer; code: number }>;

const MAX_OBJECT_BYTES = 25 * 1024 * 1024; // same ceiling the binary fs read uses

const realExec: BufferExec = (args, cwd) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 }, (err: any, stdout) => {
      const code = typeof err?.code === "number" ? err.code : err ? -1 : 0;
      resolve({ buffer: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ""), code });
    });
  });

/**
 * Raw bytes of a file at a git revision (`git show <rev>:<file>`), or null when the file is absent at
 * that rev (added/deleted/root commit → git exits non-zero) or is empty/oversized. The text `showFile`
 * decodes stdout as utf8, which corrupts binary; image diffs read the bytes through here instead. `rev`
 * is a ref/hash/`hash^`, or "" for the index (stage 0) — exactly like showFile.
 */
export async function gitObjectBytes(
  cwd: string, rev: string, file: string, exec: BufferExec = realExec,
): Promise<Buffer | null> {
  const { buffer, code } = await exec(["show", `${rev}:${file}`], cwd);
  if (code !== 0) return null;
  if (buffer.length === 0 || buffer.length > MAX_OBJECT_BYTES) return null;
  return buffer;
}
