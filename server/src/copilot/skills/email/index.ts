import type { AppContext } from "../../../context.js";
import type { Skill } from "../types.js";
import type { ToolDef, ToolResult } from "../../types.js";
import { resolveAccount } from "./router.js";
import { imapSearch } from "./providers/imap.js";
import { PROVIDER_HOSTS, type ImapConfig } from "./types.js";
import type { SkillAccountSecret } from "../../../db/store.js";

// Build the IMAP connection config from a stored account: well-known host for a named provider, or
// the account's own host/port for a generic "imap" account.
function imapConfigFor(full: SkillAccountSecret): ImapConfig | { error: string } {
  const cfg = full.config as { user?: string; host?: string; port?: number };
  const user = cfg.user;
  if (!user) return { error: `${full.label} has no email address configured.` };
  const known = PROVIDER_HOSTS[full.provider];
  if (known) return { host: known.host, port: known.port, user, pass: full.secret };
  if (!cfg.host) return { error: `${full.label} (custom IMAP) needs a host.` };
  return { host: cfg.host, port: cfg.port ?? 993, user, pass: full.secret };
}

// Shared search backend for both tools. `unreadOnly` defaults differently per tool (check = unread,
// search = all). Resolves the account, loads its secret server-side, runs the IMAP fetch, and returns
// a friendly summary + structured findings the model reports back verbatim.
async function doSearch(app: AppContext, args: any, defaults: { unreadOnly: boolean }): Promise<ToolResult> {
  const accounts = app.store.listSkillAccounts("email");
  const picked = resolveAccount(accounts, { account: typeof args?.account === "string" ? args.account : undefined, provider: typeof args?.provider === "string" ? args.provider : undefined });
  if ("error" in picked) return { ok: false, summary: picked.error };

  const full = app.store.getSkillAccountSecret(picked.id);
  if (!full || !full.secret) return { ok: false, summary: `No app password is stored for ${picked.label}. Add it in Copilot → Skills → Email.` };
  const cfg = imapConfigFor(full);
  if ("error" in cfg) return { ok: false, summary: cfg.error };

  const unreadOnly = typeof args?.unreadOnly === "boolean" ? args.unreadOnly : defaults.unreadOnly;
  const limit = Math.min(typeof args?.limit === "number" && args.limit > 0 ? args.limit : 10, 25);
  try {
    const msgs = await imapSearch(cfg, { unreadOnly, query: typeof args?.query === "string" ? args.query : undefined, since: typeof args?.since === "number" ? args.since : undefined, limit });
    const unread = msgs.filter((m) => m.unread).length;
    const summary = msgs.length === 0
      ? `No${unreadOnly ? " unread" : ""} mail in ${picked.label}.`
      : `${msgs.length}${unreadOnly ? " unread" : ""} in ${picked.label}${!unreadOnly && unread ? ` (${unread} unread)` : ""}: ${msgs.slice(0, 3).map((m) => `"${m.subject}"`).join(", ")}${msgs.length > 3 ? "…" : ""}`;
    return { ok: true, summary, data: msgs.map((m) => ({ ...m, accountLabel: picked.label })) };
  } catch (e) {
    return { ok: false, summary: `Couldn't reach ${picked.label}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function emailTools(app: AppContext): ToolDef[] {
  return [
    {
      name: "email_check",
      description: "Check a mailbox for unread email and report what's there (from, subject, when). Use for 'check my email', 'any new mail in my Gmail?'. Pass `provider` (gmail/icloud/outlook/yahoo/imap) or `account` (a label) to pick which mailbox; omit if there's only one.",
      skillId: "email",
      input_schema: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["gmail", "icloud", "outlook", "yahoo", "imap"], description: "Which provider's mailbox" },
          account: { type: "string", description: "Account label (if you have several)" },
          unreadOnly: { type: "boolean", description: "Only unread (default true)" },
          limit: { type: "number", description: "Max messages (default 10, max 25)" },
        },
      },
      run: (args) => doSearch(app, args, { unreadOnly: true }),
    },
    {
      name: "email_search",
      description: "Search a mailbox for messages matching a query (subject/body text), newest first. Use for 'search my work email for the invoice'. Same account/provider selection as email_check.",
      skillId: "email",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for in the message body" },
          provider: { type: "string", enum: ["gmail", "icloud", "outlook", "yahoo", "imap"] },
          account: { type: "string", description: "Account label (if you have several)" },
          unreadOnly: { type: "boolean", description: "Only unread (default false)" },
          since: { type: "number", description: "Only mail after this epoch-ms time" },
          limit: { type: "number", description: "Max messages (default 10, max 25)" },
        },
        required: ["query"],
      },
      run: (args) => doSearch(app, args, { unreadOnly: false }),
    },
  ];
}

export const emailSkill: Skill = {
  id: "email",
  name: "Email",
  description: "Check and search your inboxes by natural language — Gmail, iCloud / Apple Mail, Outlook / Hotmail, Yahoo, or any IMAP server. Connect each mailbox with an app-specific password.",
  icon: "✉",
  builtin: false,
  accountsProvider: true,
  examples: ["Check my email", "Any unread in my Gmail?", "Search my work email for the invoice", "What's new in my Apple Mail?"],
  tools: emailTools,
};
