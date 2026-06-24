import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("reads the new TERMINALHUB_ env names", () => {
    const c = loadConfig({ TERMINALHUB_TOKEN: "new", TERMINALHUB_DB: "x.db", TERMINALHUB_REVEAL: "a=b" });
    expect(c.token).toBe("new");
    expect(c.dbPath).toBe("x.db");
    expect(c.reveal).toBe("a=b");
  });

  it("uses the data/terminalhub.db default path", () => {
    expect(loadConfig({}).dbPath).toBe("data/terminalhub.db");
  });

  it("exposes onetimeBase from ONETIME_BASE, null when unset or blank", () => {
    expect(loadConfig({}).onetimeBase).toBeNull();
    expect(loadConfig({ ONETIME_BASE: "  " }).onetimeBase).toBeNull();
    expect(loadConfig({ ONETIME_BASE: "https://x.example/" }).onetimeBase).toBe("https://x.example");
  });

  it("refuses a non-loopback HOST without a token", () => {
    expect(() => loadConfig({ HOST: "0.0.0.0" })).toThrow();
    expect(() => loadConfig({ HOST: "0.0.0.0", TERMINALHUB_TOKEN: "t" })).not.toThrow();
  });

  it("parses google creds, null when unset", () => {
    expect(loadConfig({ HOST: "127.0.0.1" }).google).toBeNull();
    const c = loadConfig({ HOST: "127.0.0.1", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" });
    expect(c.google).toEqual({ clientId: "cid", clientSecret: "sec", redirect: null });
    const r = loadConfig({ HOST: "127.0.0.1", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec", GOOGLE_OAUTH_REDIRECT: "https://app/api/drive/callback" });
    expect(r.google).toEqual({ clientId: "cid", clientSecret: "sec", redirect: "https://app/api/drive/callback" });
  });
});
