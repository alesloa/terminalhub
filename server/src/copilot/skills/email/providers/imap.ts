import { ImapFlow } from "imapflow";
import { parseSnippet } from "../parse.js";
import type { EmailMessage, ImapConfig } from "../types.js";

export interface SearchOpts { unreadOnly?: boolean; query?: string; since?: number; limit: number }

// Universal IMAP fetch (imapflow). Connects, searches INBOX by the given criteria, and returns the
// newest `limit` messages with from/subject/date/unread + a body snippet. Works for Gmail (app
// password), iCloud/Apple Mail, Outlook/Hotmail, Yahoo, or any IMAP server.
export async function imapSearch(cfg: ImapConfig, opts: SearchOpts): Promise<EmailMessage[]> {
  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const criteria: Record<string, unknown> = {};
      if (opts.unreadOnly) criteria.seen = false;
      if (opts.since) criteria.since = new Date(opts.since);
      if (opts.query) criteria.body = opts.query;
      const searchArg = Object.keys(criteria).length ? criteria : { all: true };
      const found = (await client.search(searchArg as any, { uid: true })) || [];
      const uids = found.slice(-opts.limit).reverse(); // newest first
      const out: EmailMessage[] = [];
      if (uids.length) {
        for await (const msg of client.fetch(uids as any, { uid: true, envelope: true, flags: true, source: true } as any, { uid: true })) {
          const fromAddr = msg.envelope?.from?.[0];
          out.push({
            from: fromAddr ? (fromAddr.name ? `${fromAddr.name} <${fromAddr.address}>` : (fromAddr.address ?? "(unknown)")) : "(unknown)",
            subject: msg.envelope?.subject || "(no subject)",
            date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : "",
            snippet: msg.source ? await parseSnippet(msg.source) : "",
            unread: !flagHasSeen(msg.flags),
          });
        }
      }
      return out;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => { /* best-effort close */ });
  }
}

// imapflow returns flags as a Set; tolerate an array too. \\Seen present = read.
function flagHasSeen(flags: unknown): boolean {
  if (flags instanceof Set) return flags.has("\\Seen");
  if (Array.isArray(flags)) return flags.includes("\\Seen");
  return false;
}
