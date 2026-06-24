#!/usr/bin/env node
// node-pty ships a `spawn-helper` binary in its prebuilds. On some platforms the
// execute bit is lost during extraction, which makes pty.spawn() fail with
// "posix_spawnp failed.". Restore +x on every install so terminals work on a
// fresh checkout (macOS + Linux). No-op on Windows (uses conpty, not spawn-helper).
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") process.exit(0);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prebuilds = join(root, "node_modules", "node-pty", "prebuilds");

if (!existsSync(prebuilds)) process.exit(0); // node-pty not installed yet / hoisted elsewhere

let fixed = 0;
for (const dir of readdirSync(prebuilds)) {
  const helper = join(prebuilds, dir, "spawn-helper");
  if (!existsSync(helper)) continue;
  const mode = statSync(helper).mode;
  if (!(mode & 0o111)) {
    chmodSync(helper, mode | 0o755);
    fixed++;
  }
}
if (fixed) console.log(`postinstall: made ${fixed} node-pty spawn-helper binary(ies) executable`);
