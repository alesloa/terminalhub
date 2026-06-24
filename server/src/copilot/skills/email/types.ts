// Email skill shared types. Providers map to well-known IMAP hosts so the user only enters an
// address + app-password; a generic "imap" account supplies its own host/port.
export type EmailProvider = "gmail" | "icloud" | "outlook" | "yahoo" | "imap";

export interface EmailMessage {
  from: string;
  subject: string;
  date: string;        // ISO-8601, or "" if the server gave none
  snippet: string;     // first ~200 chars of the body text
  unread: boolean;
  accountLabel?: string;
}

export interface ImapConfig { host: string; port: number; user: string; pass: string }

// Known IMAP endpoints (all SSL/993). Apple Mail = iCloud IMAP — there's no public Apple API, so an
// app-specific password is the only path. Outlook/Hotmail share the office365 host.
export const PROVIDER_HOSTS: Record<string, { host: string; port: number }> = {
  gmail: { host: "imap.gmail.com", port: 993 },
  icloud: { host: "imap.mail.me.com", port: 993 },
  outlook: { host: "outlook.office365.com", port: 993 },
  yahoo: { host: "imap.mail.yahoo.com", port: 993 },
};
