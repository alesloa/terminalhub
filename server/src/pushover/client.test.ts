import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPushoverController } from "./client.js";

// A minimal store stub exposing only what the controller reads.
const storeWith = (pushoverToken: string | null, pushoverUser: string | null) =>
  ({ getSettings: () => ({ pushoverToken, pushoverUser }) }) as any;

// A fetch Response-like with case-insensitive headers.
function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    json: async () => body,
  } as any;
}

const QUOTA = { "X-Limit-App-Limit": "10000", "X-Limit-App-Remaining": "9997", "X-Limit-App-Reset": "1780000000" };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("pushover client — configuration", () => {
  it("reports not configured when keys are missing and never calls fetch", async () => {
    const c = createPushoverController(storeWith(null, null));
    expect(c.isConfigured()).toBe(false);
    const r = await c.send({ message: "hi" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports configured when both keys are present", () => {
    expect(createPushoverController(storeWith("tok", "usr")).isConfigured()).toBe(true);
  });
});

describe("pushover client — send", () => {
  it("POSTs the message with token/user/title and captures the quota headers", async () => {
    fetchMock.mockResolvedValue(res(200, { status: 1, request: "req-1" }, QUOTA));
    const c = createPushoverController(storeWith("tok", "usr"));
    const r = await c.send({ message: "deploy done", title: "Terminal Hub" });

    expect(r.ok).toBe(true);
    expect(r.request).toBe("req-1");
    expect(r.quota).toEqual({ limit: 10000, remaining: 9997, reset: 1780000000 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/1/messages.json");
    expect(init.method).toBe("POST");
    const body = init.body as URLSearchParams;
    expect(body.get("token")).toBe("tok");
    expect(body.get("user")).toBe("usr");
    expect(body.get("message")).toBe("deploy done");
    expect(body.get("title")).toBe("Terminal Hub");
  });

  it("sends priority, and supplies retry/expire for emergency priority 2", async () => {
    fetchMock.mockResolvedValue(res(200, { status: 1, request: "r", receipt: "rcpt" }, QUOTA));
    const c = createPushoverController(storeWith("tok", "usr"));
    const r = await c.send({ message: "urgent", priority: 2 });
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("priority")).toBe("2");
    expect(Number(body.get("retry"))).toBeGreaterThanOrEqual(30);
    expect(Number(body.get("expire"))).toBeGreaterThan(0);
    expect(r.receipt).toBe("rcpt");
  });

  it("attaches an image as attachment_base64 + attachment_type", async () => {
    fetchMock.mockResolvedValue(res(200, { status: 1, request: "r" }, QUOTA));
    const c = createPushoverController(storeWith("tok", "usr"));
    await c.send({ message: "look", imageBase64: "BASE64DATA", imageType: "image/png" });
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("attachment_base64")).toBe("BASE64DATA");
    expect(body.get("attachment_type")).toBe("image/png");
  });

  it("surfaces Pushover's error array on a 4xx without throwing", async () => {
    fetchMock.mockResolvedValue(res(400, { status: 0, errors: ["user identifier is invalid"] }));
    const c = createPushoverController(storeWith("tok", "bad"));
    const r = await c.send({ message: "hi" });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("user identifier is invalid");
  });

  it("never throws on a network failure — returns ok:false", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const c = createPushoverController(storeWith("tok", "usr"));
    const r = await c.send({ message: "hi" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/ECONNREFUSED/);
  });
});

describe("pushover client — validate + quota", () => {
  it("validate POSTs to users/validate.json and maps status", async () => {
    fetchMock.mockResolvedValue(res(200, { status: 1, devices: ["iphone"] }));
    const c = createPushoverController(storeWith("tok", "usr"));
    const r = await c.validate();
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain("/1/users/validate.json");
  });

  it("validate returns ok:false with errors on an invalid key", async () => {
    fetchMock.mockResolvedValue(res(400, { status: 0, errors: ["user key is invalid"] }));
    const c = createPushoverController(storeWith("tok", "bad"));
    const r = await c.validate();
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("user key is invalid");
  });

  it("quota GETs apps/limits.json and parses the numbers", async () => {
    fetchMock.mockResolvedValue(res(200, { limit: 10000, remaining: 9000, reset: 1780000000 }));
    const c = createPushoverController(storeWith("tok", "usr"));
    const q = await c.quota();
    expect(q).toEqual({ limit: 10000, remaining: 9000, reset: 1780000000 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/1/apps/limits.json");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("quota returns null when not configured", async () => {
    const c = createPushoverController(storeWith(null, null));
    expect(await c.quota()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
