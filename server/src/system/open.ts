import { spawn } from "node:child_process";

/**
 * The host command that opens `absPath` in the OS's default application/handler. Mirrors
 * reveal.ts but opens the file itself rather than highlighting it in the file manager. Pure
 * (no side effects) so the platform mapping stays unit-testable.
 */
export function openCommand(platform: NodeJS.Platform, absPath: string): { cmd: string; args: string[] } {
  if (platform === "darwin") return { cmd: "open", args: [absPath] };
  if (platform === "win32") return { cmd: "cmd", args: ["/c", "start", "", absPath] };
  return { cmd: "xdg-open", args: [absPath] };
}

/**
 * Best-effort "Open in Default App": spawn the OS handler detached and forget it. Only
 * meaningful when the browser is on the host machine (the route is gated client-side to
 * loopback). A missing binary or headless host just no-ops.
 */
export function openInDefaultApp(absPath: string): void {
  const { cmd, args } = openCommand(process.platform, absPath);
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {}); // swallow ENOENT / headless — fire-and-forget
  child.unref();
}
