import { describe, it, expect } from "vitest";
import { createOAuth } from "./oauth.js";

describe("drive oauth: consent URL", () => {
  it("builds a consent URL with offline access + drive scope + state", () => {
    const oauth = createOAuth({ clientId: "cid", clientSecret: "sec", redirect: "https://app/api/drive/callback" });
    const url = oauth.consentUrl("xyz-state");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("access_type=offline");
    // `consent` guarantees a refresh token; `select_account` forces the chooser so a second account can be added.
    expect(decodeURIComponent(url)).toContain("prompt=select_account consent");
    expect(url).toContain("state=xyz-state");
    expect(decodeURIComponent(url)).toContain("https://www.googleapis.com/auth/drive");
  });

  it("falls back to origin + /api/drive/callback when no fixed redirect is configured", () => {
    const oauth = createOAuth({ clientId: "cid", clientSecret: "sec", redirect: null });
    expect(oauth.redirectFor("https://host:8189")).toBe("https://host:8189/api/drive/callback");
    const url = oauth.consentUrl("st", "https://host:8189");
    expect(decodeURIComponent(url)).toContain("https://host:8189/api/drive/callback");
  });
});
