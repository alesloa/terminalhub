import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { tmuxStatusStyle } from "../tmux/controller.js";

// A CSS hex color (#rgb or #rrggbb) — validates the focus-bar / status-text color inputs.
const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);

const commentTag = z.object({
  tag: z.string(),
  color: z.string(),
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  strikethrough: z.boolean(),
  backgroundColor: z.string(),
});
const betterComments = z.object({ enabled: z.boolean(), tags: z.array(commentTag) });

// Break / stand-up enforcer config — a JSON blob persisted verbatim (the timer + overlay are
// client-side; the server only stores this). See BreakSettings in types.ts for field semantics.
const breaks = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().min(1).max(600),
  durationMinutes: z.number().min(1).max(120),
  pauseWhenHidden: z.boolean(),
  preWarnSeconds: z.number().min(0).max(300),
  allowSkip: z.boolean(),
  speak: z.boolean(),
});

// The canvas/spaces backdrop config — shared by the global setting (here) and per-space overrides
// (routes/spaces.ts). See CanvasBackground in types.ts for field semantics.
export const canvasBackground = z.object({
  kind: z.enum(["solid", "wallpaper"]),
  color: z.string().nullable(),
  wallpaper: z.string().nullable(),
  overlay: z.boolean(),
  dim: z.number().min(0).max(100),
});

// The Stage Manager dock's frosted-glass panel config (see StageDock in types.ts). `color` is a hex
// (#rgb/#rrggbb) or null to track the theme; opacity 0-100, blur 0-40px.
const stageDock = z.object({
  enabled: z.boolean(),
  color: hexColor.nullable(),
  opacity: z.number().min(0).max(100),
  blur: z.number().min(0).max(40),
  borderColor: hexColor.nullable(),
  borderOpacity: z.number().min(0).max(100),
});

export async function settingsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/settings", async () => {
    const s = ctx.store.getSettings();
    return {
      defaultLaunchCommand: s.defaultLaunchCommand,
      defaultShell: s.defaultShell,
      tokenSet: Boolean(s.token),
      autoSave: s.autoSave,
      autoSaveDelaySeconds: s.autoSaveDelaySeconds,
      minimap: s.minimap,
      wordWrap: s.wordWrap,
      lineNumbers: s.lineNumbers,
      diffSplit: s.diffSplit,
      sidebarPosition: s.sidebarPosition,
      theme: s.theme,
      sttProvider: s.sttProvider,
      openaiSttModel: s.openaiSttModel,
      openaiKeySet: Boolean(s.openaiApiKey), // never return the key itself
      pushoverConfigured: Boolean(s.pushoverToken && s.pushoverUser), // needs BOTH; raw keys never returned
      micMode: s.micMode,
      attentionMode: s.attentionMode,
      silenceSeconds: s.silenceSeconds,
      headroomLauncherHidden: s.headroomLauncherHidden,
      focusBarColor: s.focusBarColor,
      tmuxStatusFg: s.tmuxStatusFg,
      stageManagerEnabled: s.stageManagerEnabled,
      stageManagerPosition: s.stageManagerPosition,
      betterComments: ctx.store.getBetterComments(),
      canvasBackground: ctx.store.getCanvasBackground(),
      stageDock: ctx.store.getStageDock(),
      breaks: ctx.store.getBreaks(),
    };
  });
  app.patch("/api/settings", async (req, reply) => {
    const b = z.object({
      defaultLaunchCommand: z.string().optional(),
      defaultShell: z.string().optional(),
      autoSave: z.boolean().optional(),
      autoSaveDelaySeconds: z.number().min(1).max(60).optional(),
      minimap: z.boolean().optional(),
      wordWrap: z.boolean().optional(),
      lineNumbers: z.boolean().optional(),
      diffSplit: z.boolean().optional(),
      sidebarPosition: z.enum(["bottom", "left", "right", "top"]).optional(),
      theme: z.string().min(1).max(64).optional(), // id validated client-side; unknown ids fall back to default
      sttProvider: z.enum(["local", "openai"]).optional(),
      openaiSttModel: z.string().optional(),
      openaiApiKey: z.string().optional(), // write-only; stored, never read back
      pushoverToken: z.string().optional(), // write-only Pushover app token; stored, never read back
      pushoverUser: z.string().optional(),  // write-only Pushover user/group key; stored, never read back
      micMode: z.enum(["toggle", "hold"]).optional(),
      attentionMode: z.enum(["layered", "explicit", "silence"]).optional(), // which signals fire a toast
      silenceSeconds: z.number().min(1).max(120).optional(),                 // quiet window for silence detection
      headroomLauncherHidden: z.boolean().optional(),
      focusBarColor: hexColor.optional(),  // focused-terminal bar color (client renders it via a CSS var)
      tmuxStatusFg: hexColor.optional(),   // terminal status-bar text color (applied to tmux, server-side)
      stageManagerEnabled: z.boolean().optional(),                       // master on/off for the Stage Manager
      stageManagerPosition: z.enum(["left", "right", "top", "bottom"]).optional(), // dock edge anchor
      betterComments: betterComments.optional(), // JSON blob, persisted separately
      canvasBackground: canvasBackground.optional(), // JSON blob, persisted separately
      stageDock: stageDock.optional(), // JSON blob, persisted separately
      breaks: breaks.optional(), // JSON blob, persisted separately
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const { betterComments: bc, canvasBackground: cb, stageDock: sd, breaks: br, ...rest } = b.data;
    if (bc) ctx.store.setBetterComments(bc);
    if (cb) ctx.store.setCanvasBackground(cb);
    if (sd) ctx.store.setStageDock(sd);
    if (br) ctx.store.setBreaks(br);
    ctx.store.setSettings(rest);
    // Recolor every live terminal's status bar now (not just on next attach) when the status-text
    // color changes, so the change shows immediately across all open terminals.
    if (rest.tmuxStatusFg !== undefined) {
      await ctx.tmux?.setStatusStyleAll(tmuxStatusStyle(rest.tmuxStatusFg)).catch(() => {});
    }
    // No tmux silence re-arm here: attention is bell-only now (silence flagged every idle agent and
    // flooded toasts), so the quiet-window setting is dormant and never touches tmux monitoring.
    return { ok: true };
  });
}
