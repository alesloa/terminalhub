/**
 * The shell inside every tmux pane inherits whatever environment Terminal Hub spawned tmux
 * with. Under PM2 + scripts/start.mjs that environment is polluted: start.mjs sets PORT (5173)
 * for the hub's OWN listener, PM2 injects NODE_ENV=production plus its process-descriptor vars
 * (pm_id, pm_exec_path, name, status, …), and index.ts copies the repo .env into process.env
 * (so TERMINALHUB_TOKEN — a secret — is in there too). tmux bakes the spawn environment into its
 * *global environment*, so all of that lands in every pane: PORT collides with other dev servers
 * (vue-cli / vite read $PORT and try to grab 5173), NODE_ENV wrongly flips tooling to production,
 * and the access token becomes readable in every shell.
 *
 * Strip that junk so panes start like a normal login shell. The filter is SUBTRACTIVE (a denylist)
 * so the user's real environment — PATH, HOME, SSH_*, LANG, everything else — passes through
 * untouched; a whitelist would risk dropping something a shell or agent needs.
 */

// Non-prefixed vars to drop. The lowercase entries are PM2's process-descriptor keys: PM2 injects
// them lowercase, so dropping them can't collide with conventional UPPER_CASE shell variables.
const DROP_EXACT = new Set<string>([
  "PORT",             // the hub's own listener port (scripts/start.mjs) — the headline collision
  "HOST",             // the hub's own listener host. Leaked as HOST=0.0.0.0, which prompt themes
                      // render as the machine name — every pane read `alesloas@0`.
  "NODE_ENV",         // PM2 sets "production"; meaningless / harmful for an arbitrary pane
  "NODE_APP_INSTANCE",
  // PM2 process descriptor (all injected lowercase):
  "name", "namespace", "version", "versioning", "instances", "exec_mode", "exec_interpreter",
  "node_args", "args", "autorestart", "watch", "vizion", "vizion_running", "automation",
  "treekill", "windowsHide", "kill_retry_time", "created_at", "unique_id", "restart_time",
  "unstable_restarts", "prev_restart_delay", "status", "merge_logs", "km_link",
  "max_memory_restart", "instance_var", "filter_env", "wait_ready", "shutdown_with_message",
  // …and the ones observed live that the list above missed:
  "autostart", "cwd", "exit_code", "node_version", "script", "username",
  // Editor injection. Whatever launched PM2 may have been a VS Code integrated terminal; those
  // vars outlive the window that set them. GIT_ASKPASS / VSCODE_GIT_IPC_HANDLE then point at a
  // dead socket (git credential prompts hang), GIT_EDITOR tries to open a window that isn't
  // there, and VSCODE_INJECTION makes every pane shell source VS Code's integration script.
  "GIT_ASKPASS", "GIT_EDITOR", "TERM_PROGRAM", "TERM_PROGRAM_VERSION",
  // An agent's own session identity. Inherited, these make a BRAND-NEW pane look like it is
  // already running inside a Claude/Codex session — the CLI launched there treats itself as a
  // nested child and dials CLAUDE_CODE_SSE_PORT, an IDE server that is long gone.
  "CLAUDECODE", "AI_AGENT",
]);

// Drop any var whose name starts with one of these. Covers TERMINALHUB_* (server config + the
// secret token), every PM2 namespace (PM2_*, pm_*, pm2_*, axm_*, pmx*), the editor-injection
// block (VSCODE_*), and the agent-session block (CLAUDE_*, CODEX_*). Dropping a whole agent
// namespace is safe: a pane's shell re-sources the user's rc files, so anything they set there
// for themselves comes straight back — only the INHERITED session identity is removed.
const DROP_PREFIX = ["TERMINALHUB_", "PM2_", "pm_", "pm2_", "axm_", "pmx",
                     "VSCODE_", "CLAUDE_", "CODEX_"];

/** True when an env var is hub/PM2 injected noise that must not leak into a pane's shell. */
export function shouldDropEnvKey(key: string): boolean {
  if (DROP_EXACT.has(key)) return true;
  return DROP_PREFIX.some((p) => key.startsWith(p));
}

/** A copy of `env` with the hub/PM2-injected variables removed — the environment to spawn tmux
 *  (and thus every pane shell) with. Never mutates the input. */
export function cleanShellEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of Object.keys(env)) {
    const v = env[k];
    if (v === undefined) continue;
    if (shouldDropEnvKey(k)) continue;
    out[k] = v;
  }
  return out;
}
