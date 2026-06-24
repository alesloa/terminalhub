import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createContext, type AppContext } from "../../../context.js";
import { parseSnippet } from "./parse.js";
import { resolveAccount } from "./router.js";
import { emailSkill } from "./index.js";
import type { CopilotCtx } from "../../types.js";
import type { CopilotSkillAccount } from "../../../types.js";

// Shared mutable mock state for the fake imapflow client (vi.mock is hoisted, so share via vi.hoisted).
const h = vi.hoisted(() => ({ messages: [] as any[], lastOpts: null as any }));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    constructor(opts: any) { h.lastOpts = opts; }
    async connect() { /* noop */ }
    async getMailboxLock() { return { release() { /* noop */ } }; }
    async search() { return h.messages.map((_, i) => i + 1); }
    fetch() { const msgs = h.messages; return (async function* () { for (const m of msgs) yield m; })(); }
    async logout() { /* noop */ }
  },
}));

const mkMsg = (subject: string, fromName: string, addr: string, seen: boolean, body: string) => ({
  envelope: { from: [{ name: fromName, address: addr }], subject, date: new Date("2026-06-20T10:00:00Z") },
  flags: new Set<string>(seen ? ["\\Seen"] : []),
  source: Buffer.from(`From: ${addr}\r\nSubject: ${subject}\r\n\r\n${body}`),
});

let app: AppContext;
const cctx = () => ({ app, settings: app.store.getCopilotSettings(), actor: "user" }) as CopilotCtx;
const tool = (name: string) => emailSkill.tools(app).find((t) => t.name === name)!;

beforeEach(() => { app = createContext(":memory:"); h.messages = []; h.lastOpts = null; });
afterEach(() => { app.pending.stop(); });

describe("parseSnippet", () => {
  it("extracts a trimmed text snippet from raw MIME", async () => {
    const snip = await parseSnippet("From: a@b.com\r\nSubject: Hi\r\n\r\n  Hello   there,\n this is the body.  ");
    expect(snip).toBe("Hello there, this is the body.");
  });
});

describe("resolveAccount", () => {
  const a = (id: string, label: string, provider: string): CopilotSkillAccount => ({ id, skillId: "email", label, provider, config: {}, hasSecret: true, createdAt: 0 });
  it("errors with no accounts", () => { expect("error" in resolveAccount([], {})).toBe(true); });
  it("picks the only account by default", () => { expect((resolveAccount([a("1", "P", "gmail")], {}) as any).id).toBe("1"); });
  it("routes by provider", () => {
    const accs = [a("1", "Personal", "gmail"), a("2", "Work", "outlook")];
    expect((resolveAccount(accs, { provider: "outlook" }) as any).id).toBe("2");
  });
  it("routes by label", () => {
    const accs = [a("1", "Personal", "gmail"), a("2", "Work", "gmail")];
    expect((resolveAccount(accs, { account: "Work" }) as any).id).toBe("2");
  });
  it("asks when ambiguous", () => {
    const accs = [a("1", "Personal", "gmail"), a("2", "Work", "outlook")];
    expect("error" in resolveAccount(accs, {})).toBe(true);
  });
});

describe("email_check tool", () => {
  it("connects to the provider's IMAP host and reports unread mail", async () => {
    app.store.createSkillAccount({ skillId: "email", label: "Personal", provider: "gmail", config: { user: "me@gmail.com" }, secret: "app-pw" });
    h.messages = [mkMsg("Invoice #42", "Acme", "billing@acme.com", false, "Your invoice is attached.")];

    const r = await tool("email_check").run({}, cctx());
    expect(r.ok).toBe(true);
    expect(h.lastOpts.host).toBe("imap.gmail.com");
    expect(h.lastOpts.port).toBe(993);
    expect(h.lastOpts.auth).toEqual({ user: "me@gmail.com", pass: "app-pw" });
    const data = r.data as any[];
    expect(data).toHaveLength(1);
    expect(data[0].subject).toBe("Invoice #42");
    expect(data[0].from).toContain("billing@acme.com");
    expect(data[0].unread).toBe(true);
    expect(data[0].accountLabel).toBe("Personal");
  });

  it("fails clearly when no account is connected", async () => {
    const r = await tool("email_check").run({}, cctx());
    expect(r.ok).toBe(false);
    expect(r.summary.toLowerCase()).toContain("no email accounts");
  });

  it("routes to the right mailbox by provider", async () => {
    app.store.createSkillAccount({ skillId: "email", label: "Personal", provider: "gmail", config: { user: "me@gmail.com" }, secret: "g" });
    app.store.createSkillAccount({ skillId: "email", label: "Work", provider: "outlook", config: { user: "me@work.com" }, secret: "o" });
    h.messages = [mkMsg("Standup", "Boss", "boss@work.com", false, "9am")];

    const r = await tool("email_check").run({ provider: "outlook" }, cctx());
    expect(r.ok).toBe(true);
    expect(h.lastOpts.host).toBe("outlook.office365.com");
    expect(h.lastOpts.auth.user).toBe("me@work.com");
  });

  it("uses a custom IMAP host for a generic account", async () => {
    app.store.createSkillAccount({ skillId: "email", label: "Fastmail", provider: "imap", config: { user: "u@fastmail.com", host: "imap.fastmail.com", port: 993 }, secret: "p" });
    h.messages = [];
    const r = await tool("email_check").run({}, cctx());
    expect(r.ok).toBe(true);
    expect(h.lastOpts.host).toBe("imap.fastmail.com");
  });
});
