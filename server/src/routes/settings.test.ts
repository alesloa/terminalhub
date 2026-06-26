import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { createStore } from "../db/store.js";
import { settingsRoutes } from "./settings.js";

function build() {
  const ctx = { store: createStore(":memory:") } as any;
  const app = Fastify();
  app.register(async (a) => settingsRoutes(a, ctx));
  return { app, ctx };
}

describe("settings routes — STT fields", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("defaults to local provider + gpt-4o-transcribe, key unset, and never exposes the key field", async () => {
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.sttProvider).toBe("local");
    expect(body.openaiSttModel).toBe("gpt-4o-transcribe");
    expect(body.openaiKeySet).toBe(false);
    expect(body).not.toHaveProperty("openaiApiKey");
  });

  it("PATCH persists provider + model and round-trips on GET", async () => {
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { sttProvider: "openai", openaiSttModel: "whisper-1" } });
    expect(res.statusCode).toBe(200);
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.sttProvider).toBe("openai");
    expect(body.openaiSttModel).toBe("whisper-1");
  });

  it("stores the OpenAI key but GET exposes only openaiKeySet, never the secret", async () => {
    await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { openaiApiKey: "sk-secret-123" } });
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.openaiKeySet).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk-secret-123");
    expect(body).not.toHaveProperty("openaiApiKey");
  });

  it("rejects an invalid sttProvider", async () => {
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { sttProvider: "bogus" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("settings routes — better comments", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("GET exposes the default tags", async () => {
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.betterComments.enabled).toBe(true);
    expect(body.betterComments.tags.map((t: any) => t.tag)).toEqual(["!", "?", "//", "todo", "*"]);
  });

  it("PATCH persists a custom config and round-trips on GET", async () => {
    const payload = {
      betterComments: {
        enabled: false,
        tags: [{ tag: "@fixme", color: "#112233", bold: false, italic: true, underline: false, strikethrough: false, backgroundColor: "transparent" }],
      },
    };
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload });
    expect(res.statusCode).toBe(200);
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.betterComments.enabled).toBe(false);
    expect(body.betterComments.tags).toHaveLength(1);
    expect(body.betterComments.tags[0]).toMatchObject({ tag: "@fixme", color: "#112233", italic: true });
  });

  it("rejects a malformed betterComments body", async () => {
    const res = await h.app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: { betterComments: { enabled: "yes", tags: [] } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("settings routes — theme", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("defaults theme to terminalhub", async () => {
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.theme).toBe("terminalhub");
  });

  it("PATCH persists theme and round-trips on GET", async () => {
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { theme: "dark-modern" } });
    expect(res.statusCode).toBe(200);
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.theme).toBe("dark-modern");
  });

  it("rejects a non-string theme", async () => {
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { theme: 42 } });
    expect(res.statusCode).toBe(400);
  });
});

describe("settings routes — mic mode", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("defaults micMode to toggle", async () => {
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.micMode).toBe("toggle");
  });

  it("PATCH persists micMode and round-trips on GET", async () => {
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { micMode: "hold" } });
    expect(res.statusCode).toBe(200);
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.micMode).toBe("hold");
  });

  it("rejects an invalid micMode", async () => {
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { micMode: "bogus" } });
    expect(res.statusCode).toBe(400);
  });

  it("defaults headroomLauncherHidden to false and round-trips a hide on GET", async () => {
    const before = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(before.headroomLauncherHidden).toBe(false);
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { headroomLauncherHidden: true } });
    expect(res.statusCode).toBe(200);
    const after = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(after.headroomLauncherHidden).toBe(true);
  });
});

describe("settings routes — Pushover keys", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("defaults to not configured and never exposes the raw keys", async () => {
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.pushoverConfigured).toBe(false);
    expect(body).not.toHaveProperty("pushoverToken");
    expect(body).not.toHaveProperty("pushoverUser");
  });

  it("becomes configured only when BOTH token and user are set, and hides the secrets", async () => {
    await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { pushoverToken: "atoken" } });
    expect((await h.app.inject({ method: "GET", url: "/api/settings" })).json().pushoverConfigured).toBe(false);
    await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { pushoverUser: "auser" } });
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.pushoverConfigured).toBe(true);
    expect(JSON.stringify(body)).not.toContain("atoken");
    expect(JSON.stringify(body)).not.toContain("auser");
  });
});

describe("settings routes — breaks", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("defaults to disabled with the planned interval/duration shape", async () => {
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.breaks).toEqual({
      enabled: false, intervalMinutes: 60, durationMinutes: 10,
      pauseWhenHidden: true, preWarnSeconds: 20, allowSkip: true, speak: false,
    });
  });

  it("PATCH persists a custom config and round-trips on GET", async () => {
    const breaks = {
      enabled: true, intervalMinutes: 45, durationMinutes: 5,
      pauseWhenHidden: false, preWarnSeconds: 0, allowSkip: false, speak: true,
    };
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { breaks } });
    expect(res.statusCode).toBe(200);
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.breaks).toEqual(breaks);
  });

  it("rejects a malformed breaks body (bad type, out-of-range minutes)", async () => {
    const base = { enabled: true, intervalMinutes: 60, durationMinutes: 10, pauseWhenHidden: true, preWarnSeconds: 20, allowSkip: true, speak: false };
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { breaks: { ...base, enabled: "yes" } } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { breaks: { ...base, intervalMinutes: 0 } } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { breaks: { ...base, preWarnSeconds: -5 } } })).statusCode).toBe(400);
  });
});

describe("settings routes — terminal colors", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("defaults focusBarColor + tmuxStatusFg to Terminal Hub green", async () => {
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.focusBarColor).toBe("#22c55e");
    expect(body.tmuxStatusFg).toBe("#22c55e");
  });

  it("PATCH persists both colors and round-trips on GET", async () => {
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { focusBarColor: "#ff0000", tmuxStatusFg: "#00f" } });
    expect(res.statusCode).toBe(200);
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.focusBarColor).toBe("#ff0000");
    expect(body.tmuxStatusFg).toBe("#00f");
  });

  it("re-styles every live terminal when the status text color changes", async () => {
    const applied: string[] = [];
    h.ctx.tmux = { setStatusStyleAll: async (style: string) => { applied.push(style); } };
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { tmuxStatusFg: "#abcdef" } });
    expect(res.statusCode).toBe(200);
    expect(applied).toEqual(["bg=#141414,fg=#abcdef"]);
  });

  it("does NOT touch tmux when only the focus-bar color changes (it's client-rendered)", async () => {
    let called = false;
    h.ctx.tmux = { setStatusStyleAll: async () => { called = true; } };
    await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { focusBarColor: "#123456" } });
    expect(called).toBe(false);
  });

  it("rejects a non-hex color", async () => {
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { focusBarColor: "red" } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { tmuxStatusFg: "#12g" } })).statusCode).toBe(400);
  });
});

describe("settings routes — canvas background", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("defaults to the theme solid backdrop (no color, scrim off)", async () => {
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.canvasBackground).toEqual({ kind: "solid", color: null, wallpaper: null, overlay: false, dim: 50 });
  });

  it("PATCH persists a wallpaper backdrop and round-trips on GET", async () => {
    const canvasBackground = { kind: "wallpaper", color: null, wallpaper: "orionids", overlay: false, dim: 35 };
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { canvasBackground } });
    expect(res.statusCode).toBe(200);
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.canvasBackground).toEqual(canvasBackground);
  });

  it("rejects a malformed canvasBackground (dim out of range, bad kind)", async () => {
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { canvasBackground: { kind: "solid", color: null, wallpaper: null, overlay: false, dim: 200 } } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { canvasBackground: { kind: "rainbow", color: null, wallpaper: null, overlay: false, dim: 10 } } })).statusCode).toBe(400);
  });
});

describe("settings routes — stage dock background", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("defaults to the frosted panel on, theme tints, 55% fill, 16px blur, subtle border", async () => {
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.stageDock).toEqual({ enabled: true, color: null, opacity: 55, blur: 16, borderColor: null, borderOpacity: 40 });
  });

  it("PATCH persists a custom dock background (incl. transparent fill + border) and round-trips on GET", async () => {
    const stageDock = { enabled: true, color: "#101418", opacity: 0, blur: 24, borderColor: "#3a3a3a", borderOpacity: 0 };
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { stageDock } });
    expect(res.statusCode).toBe(200);
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.stageDock).toEqual(stageDock);
  });

  it("rejects a malformed stageDock (non-hex colors, out-of-range blur/opacity)", async () => {
    const base = { enabled: true, color: null, opacity: 55, blur: 16, borderColor: null, borderOpacity: 40 };
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { stageDock: { ...base, color: "navy" } } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { stageDock: { ...base, borderColor: "navy" } } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { stageDock: { ...base, blur: 99 } } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { stageDock: { ...base, opacity: 200 } } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { stageDock: { ...base, borderOpacity: -5 } } })).statusCode).toBe(400);
  });
});

describe("settings routes — attention detection", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("defaults attentionMode to layered with a 10s quiet window", async () => {
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.attentionMode).toBe("layered");
    expect(body.silenceSeconds).toBe(10);
  });

  it("PATCH persists mode + quiet window and round-trips on GET", async () => {
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { attentionMode: "silence", silenceSeconds: 25 } });
    expect(res.statusCode).toBe(200);
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.attentionMode).toBe("silence");
    expect(body.silenceSeconds).toBe(25);
  });

  it("rejects an invalid mode and an out-of-range quiet window", async () => {
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { attentionMode: "bogus" } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { silenceSeconds: 0 } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { silenceSeconds: 999 } })).statusCode).toBe(400);
  });

  it("re-arms monitor-silence with the configured quiet window", async () => {
    const armed: number[] = [];
    h.ctx.tmux = { setMonitorSilenceAll: async (sec: number) => { armed.push(sec); } };
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { silenceSeconds: 12 } });
    expect(res.statusCode).toBe(200);
    expect(armed).toEqual([12]);
  });

  it("never disables monitor-silence — attention is always-on layered, never mode-gated", async () => {
    const armed: number[] = [];
    h.ctx.tmux = { setMonitorSilenceAll: async (sec: number) => { armed.push(sec); } };
    // A legacy 'explicit' mode PATCH must NOT disarm silence (no 0) — it arms the quiet window like any other.
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { attentionMode: "explicit", silenceSeconds: 15 } });
    expect(res.statusCode).toBe(200);
    expect(armed).toEqual([15]);
  });
});

describe("settings routes — stage manager", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("defaults position to left and the feature enabled", async () => {
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.stageManagerPosition).toBe("left");
    expect(body.stageManagerEnabled).toBe(true);
  });

  it("PATCH persists position + enabled and round-trips on GET", async () => {
    const res = await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { stageManagerPosition: "bottom", stageManagerEnabled: false } });
    expect(res.statusCode).toBe(200);
    const body = (await h.app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(body.stageManagerPosition).toBe("bottom");
    expect(body.stageManagerEnabled).toBe(false);
  });

  it("rejects an invalid position and a non-boolean enabled", async () => {
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { stageManagerPosition: "middle" } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PATCH", url: "/api/settings", payload: { stageManagerEnabled: "yes" } })).statusCode).toBe(400);
  });
});
