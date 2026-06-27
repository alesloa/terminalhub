import { createStore, type Store } from "./db/store.js";
import { createTmuxController, type TmuxController } from "./tmux/controller.js";
import { createGitController, type GitController } from "./git/controller.js";
import { createGithubController, type GithubController } from "./git/github.js";
import { createAiController, type AiController } from "./ai/controller.js";
import { createClaudeController, type ClaudeController } from "./claude/controller.js";
import { createSkillsController, type SkillsController } from "./skills/controller.js";
import { createSttController, type SttController } from "./stt/controller.js";
import { createClipController, type ClipController } from "./clip/controller.js";
import { createNotifyBus, type NotifyBus } from "./notify/bus.js";
import { createPendingNotifier, type PendingNotifier } from "./notify/pending.js";
import { createPushoverController, type PushoverController } from "./pushover/client.js";
import { createReminderScheduler, type ReminderScheduler } from "./scheduler/reminderScheduler.js";
import { createCopilotScheduler, type CopilotScheduler } from "./copilot/scheduler.js";
import { createMcpHub, type McpHub } from "./copilot/mcp/client.js";
import { createAttentionWatcher, type AttentionWatcher } from "./attention/attentionWatcher.js";
import { createAttentionFirer, type AttentionFirer } from "./attention/attentionFire.js";
import { attentionFrom } from "./attention/attention.js";
import { builtinAgentBinaries } from "./activity/working.js";
import { createDriveController, type DriveController } from "./drive/controller.js";
import { createSessionsController, type SessionsController } from "./presence/sessions.js";
import { createTunnelController, type TunnelController } from "./tunnel/controller.js";
import type { GoogleConfig } from "./config.js";
import { dirname, join } from "node:path";

export interface AppContext { store: Store; tmux: TmuxController; git: GitController; github: GithubController; ai: AiController; claude: ClaudeController; skills: SkillsController; stt: SttController; clip: ClipController; notify: NotifyBus; pending: PendingNotifier; pushover: PushoverController; scheduler: ReminderScheduler; copilotScheduler: CopilotScheduler; mcp: McpHub; attentionWatcher: AttentionWatcher; attentionFirer: AttentionFirer; drive: DriveController; sessions: SessionsController; tunnel: TunnelController; }

export function createContext(dbPath: string, google: GoogleConfig | null = null): AppContext {
  const store = createStore(dbPath);
  const github = createGithubController();
  // git network ops (fetch/pull/push) authenticate as the signed-in GitHub account that owns each
  // repo's origin, resolved via gh — so a private repo owned by a NON-active account still works
  // instead of failing with "Repository not found" against the active account's credential.
  const git = createGitController(undefined, (originUrl) => github.repoAuth(originUrl));
  const tmux = createTmuxController();
  const notify = createNotifyBus();
  // Holds agent notifications as toasts; persists them to the center only if they're ignored.
  const pending = createPendingNotifier({ store, notify });
  const pushover = createPushoverController(store);
  // Constructed here but NOT started — index.ts runs catchUp()/seed + start() after the app is listening.
  const scheduler = createReminderScheduler({ store, notify, pushover });
  const attentionWatcher = createAttentionWatcher({
    pending,
    // BELL-ONLY ("explicit"), never the stored attentionMode — attention is not user-controlled
    // (mirrors computeAttention in attention/attention.ts). Silence is intentionally excluded: every
    // idle agent looked "quiet" and re-fired toasts as the flag oscillated, flooding notifications.
    // Built-in coding agents ONLY — a registered custom launcher (npm run dev, codegraph) never notifies.
    getAttention: async () => attentionFrom(await tmux.windowFlags(), store.listAllTerminals(), store.listWorkspaces(), "explicit", builtinAgentBinaries()),
  });
  // Fires "needs attention" for an OPEN terminal whose bell the watcher above can't see (an attached
  // PTY clears tmux's bell flag); the browser detects that bell and pings POST /api/terminals/:id/attention.
  const attentionFirer = createAttentionFirer({ store, pending });
  const ctx: AppContext = {
    store,
    tmux,
    git,
    github,
    ai: createAiController(store, git),
    claude: createClaudeController(),
    skills: createSkillsController(store),
    stt: createSttController({ store }),
    clip: createClipController(),
    notify,
    pending,
    pushover,
    scheduler,
    // Copilot loop runner. Needs the full app to collect tools + run them, so it's attached just
    // below once `ctx` exists. Constructed-not-started; index.ts catches up + starts it after listen.
    copilotScheduler: null as unknown as CopilotScheduler,
    // Copilot's MCP client — connects to configured tool servers on demand (connect-per-call).
    mcp: createMcpHub(),
    attentionWatcher,
    attentionFirer,
    // Always present — it resolves Google creds per request (settings DB → env `google` → null). When
    // nothing resolves, `drive.config()` is null and every /api/drive/* route returns "not configured".
    drive: createDriveController({ store, envGoogle: google }),
    // Ephemeral teammate-connection registry (temp access links): live sockets per key + admission
    // state. In-memory only; cleared on restart.
    sessions: createSessionsController(),
    // Owner-only public Cloudflare Quick Tunnel for sharing across networks. Idle until started. State +
    // log live next to the DB so a tsx-watch reload re-adopts the live tunnel instead of orphaning it.
    tunnel: createTunnelController({
      statePath: join(dirname(dbPath), "tunnel.json"),
      logPath: join(dirname(dbPath), "cloudflared.log"),
    }),
  };
  ctx.copilotScheduler = createCopilotScheduler(ctx);
  return ctx;
}
