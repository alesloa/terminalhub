import { describe, it, expect } from "vitest";
import { parseReveal, revealPresent, isDocumentPath, shouldServeBlank } from "./stealth.js";

describe("parseReveal", () => {
  it("splits name=value on the first =", () => {
    expect(parseReveal("sonos=1169")).toEqual({ name: "sonos", value: "1169" });
  });
  it("keeps later = signs inside the value", () => {
    expect(parseReveal("k=a=b")).toEqual({ name: "k", value: "a=b" });
  });
  it("returns null when unset or malformed", () => {
    expect(parseReveal(null)).toBeNull();
    expect(parseReveal(undefined)).toBeNull();
    expect(parseReveal("")).toBeNull();
    expect(parseReveal("noequals")).toBeNull();
    expect(parseReveal("=novalue")).toBeNull();
  });
});

describe("revealPresent", () => {
  it("matches the configured param in the query string", () => {
    expect(revealPresent("sonos=1169", "sonos=1169")).toBe(true);
    expect(revealPresent("sonos=1169", "foo=bar&sonos=1169")).toBe(true);
  });
  it("rejects a wrong or missing value", () => {
    expect(revealPresent("sonos=1169", "sonos=9999")).toBe(false);
    expect(revealPresent("sonos=1169", "sonos=")).toBe(false);
    expect(revealPresent("sonos=1169", "")).toBe(false);
    expect(revealPresent("sonos=1169", "other=1169")).toBe(false);
  });
  it("is false when stealth is unconfigured", () => {
    expect(revealPresent(null, "sonos=1169")).toBe(false);
  });
});

describe("isDocumentPath", () => {
  it("treats extensionless paths as document navigations", () => {
    expect(isDocumentPath("/")).toBe(true);
    expect(isDocumentPath("/workspaces/ws_abc")).toBe(true);
  });
  it("excludes built assets and API/WS paths", () => {
    expect(isDocumentPath("/assets/index-9f3a2b.js")).toBe(false);
    expect(isDocumentPath("/favicon.ico")).toBe(false);
    expect(isDocumentPath("/api/workspaces")).toBe(false);
    expect(isDocumentPath("/ws/terminal/tm_1")).toBe(false);
  });
});

describe("shouldServeBlank", () => {
  it("never blanks when stealth is unconfigured", () => {
    expect(shouldServeBlank({ reveal: null, exposed: true, queryString: "" })).toBe(false);
  });
  it("never blanks loopback, even without the flag", () => {
    expect(shouldServeBlank({ reveal: "sonos=1169", exposed: false, queryString: "" })).toBe(false);
  });
  it("blanks an exposed request that lacks the flag", () => {
    expect(shouldServeBlank({ reveal: "sonos=1169", exposed: true, queryString: "" })).toBe(true);
    expect(shouldServeBlank({ reveal: "sonos=1169", exposed: true, queryString: "sonos=wrong" })).toBe(true);
  });
  it("serves the page to an exposed request carrying the flag", () => {
    expect(shouldServeBlank({ reveal: "sonos=1169", exposed: true, queryString: "sonos=1169" })).toBe(false);
  });
});
