import { spawn } from "node:child_process";
import { dirname } from "node:path";

/**
 * The host command that opens the OS file manager with `absPath` selected. macOS and
 * Windows can highlight the file itself; Linux file managers can't, so we open its
 * containing folder. Pure (no side effects) so the platform mapping is unit-testable.
 */
export function revealCommand(platform: NodeJS.Platform, absPath: string): { cmd: string; args: string[] } {
  if (platform === "darwin") return { cmd: "open", args: ["-R", absPath] };
  if (platform === "win32") return { cmd: "explorer", args: [`/select,${absPath.replace(/\//g, "\\")}`] };
  return { cmd: "xdg-open", args: [dirname(absPath)] };
}

/**
 * Best-effort reveal: spawn the file manager detached and forget it. Only meaningful when
 * the browser is on the same machine as the host (the route is gated client-side to
 * loopback). A missing binary or headless host just no-ops — nothing we can do remotely.
 */
export function revealInFileManager(absPath: string): void {
  const { cmd, args } = revealCommand(process.platform, absPath);
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {}); // swallow ENOENT / headless — fire-and-forget
  child.unref();
}
