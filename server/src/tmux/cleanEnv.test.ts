import { describe, it, expect } from "vitest";
import { cleanShellEnv, shouldDropEnvKey } from "./cleanEnv.js";

describe("shouldDropEnvKey", () => {
  it("drops the hub's own listener port and PM2's NODE_ENV", () => {
    expect(shouldDropEnvKey("PORT")).toBe(true);
    expect(shouldDropEnvKey("NODE_ENV")).toBe(true);
    expect(shouldDropEnvKey("NODE_APP_INSTANCE")).toBe(true);
  });

  it("drops every TERMINALHUB_* var (server config + the secret token)", () => {
    expect(shouldDropEnvKey("TERMINALHUB_TOKEN")).toBe(true);
    expect(shouldDropEnvKey("TERMINALHUB_DB")).toBe(true);
    expect(shouldDropEnvKey("TERMINALHUB_REVEAL")).toBe(true);
  });

  it("drops PM2's process-descriptor vars (lowercase keys + PM2_/pm_/axm_ prefixes)", () => {
    for (const k of ["pm_id", "pm_exec_path", "pm_cwd", "name", "status", "exec_mode",
                     "node_args", "instances", "autorestart", "watch", "PM2_HOME", "axm_actions"]) {
      expect(shouldDropEnvKey(k)).toBe(true);
    }
  });

  it("keeps a normal login shell's real environment untouched", () => {
    for (const k of ["PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "TERM",
                     "SSH_AUTH_SOCK", "SSH_CONNECTION", "TMPDIR", "EDITOR", "PWD"]) {
      expect(shouldDropEnvKey(k)).toBe(false);
    }
  });
});

describe("cleanShellEnv", () => {
  it("returns a copy with hub/PM2 junk stripped and real vars preserved", () => {
    const dirty = {
      PATH: "/usr/bin", HOME: "/Users/me", SHELL: "/bin/zsh", LANG: "en_US.UTF-8",
      PORT: "5173", NODE_ENV: "production",
      TERMINALHUB_TOKEN: "secret", TERMINALHUB_DB: "/x/db.sqlite",
      pm_id: "0", pm_exec_path: "/x/start.mjs", name: "terminalhub", status: "online",
    };
    const clean = cleanShellEnv(dirty);
    expect(clean).toEqual({
      PATH: "/usr/bin", HOME: "/Users/me", SHELL: "/bin/zsh", LANG: "en_US.UTF-8",
    });
  });

  it("does not mutate the input env", () => {
    const dirty = { PATH: "/usr/bin", PORT: "5173" };
    cleanShellEnv(dirty);
    expect(dirty.PORT).toBe("5173");
  });

  it("skips undefined values", () => {
    const clean = cleanShellEnv({ PATH: "/usr/bin", FOO: undefined });
    expect(clean).toEqual({ PATH: "/usr/bin" });
    expect("FOO" in clean).toBe(false);
  });
});
