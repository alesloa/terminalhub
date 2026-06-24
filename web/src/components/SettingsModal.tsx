import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type TransitionEventHandler } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getToken, setToken, clearToken } from "../api/client";
import { useUi, type MicPosition, type SidebarPosition, type ToastPosition, type WinRect } from "../store/ui";
import type { WindowHandle } from "../hooks/useDraggableWindow";
import type { BetterCommentsConfig, CanvasBackground, SettingsResponse, StageDock } from "../api/types";
import { BetterCommentsSettings } from "./Settings/BetterCommentsSettings";
import { GoogleDriveSettings } from "./Settings/GoogleDriveSettings";
import { CopilotSettings } from "./Settings/CopilotSettings";
import { CanvasBackgroundEditor } from "./CanvasBackgroundEditor";
import { StageDockEditor } from "./Settings/StageDockEditor";
import { DEFAULT_CANVAS_BACKGROUND } from "../lib/wallpapers";
import { DEFAULT_STAGE_DOCK } from "./StageManager/dock";
import { VoiceManager } from "./Settings/VoiceManager";
import { ThemePicker } from "./ThemePicker";
import { speak, useVoices, speechSupported } from "../lib/speech";
import { describeEvent, formatHotkey, hotkeyFromEvent, type Hotkey } from "../lib/hotkey";
import { langLabel } from "../lib/langName";
import { Section, Row, Toggle, Segment, Stepper, ColorField, Code } from "./Settings/controls";
import { PaletteIcon, CodeIcon, TerminalIcon, SpeakerIcon, SparkIcon, KeyIcon, PlugIcon, EyeIcon } from "./Settings/icons";
import { TerminalAppearance } from "./Settings/TerminalAppearance";
import { SettingsSearch, type TabId } from "./Settings/settingsSearch";

const OPENAI_STT_MODELS = ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "gpt-4o-transcribe-diarize", "whisper-1"];

// User-resizable + draggable modal: defaults, floor, and a localStorage key so size AND position stick.
const SIZE_KEY = "tr.settings.box";
const DEF_W = 900, DEF_H = 660, MIN_W = 560, MIN_H = 420, MARGIN = 16;
const DURATION = 300; // ms — grow-from-icon / minimize-to-icon animation, matching the other windows

type StoredBox = { w: number; h: number; x?: number; y?: number };

function readStoredBox(): StoredBox {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "");
    if (typeof s?.w === "number" && typeof s?.h === "number") return s;
  } catch { /* fall through to default */ }
  return { w: DEF_W, h: DEF_H };
}

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "appearance", label: "Appearance", icon: <PaletteIcon /> },
  { id: "editor", label: "Editor", icon: <CodeIcon /> },
  { id: "terminal", label: "Terminal", icon: <TerminalIcon /> },
  { id: "voice", label: "Voice & Speech", icon: <SpeakerIcon /> },
  { id: "copilot", label: "Copilot", icon: <SparkIcon /> },
  { id: "connections", label: "Connections", icon: <PlugIcon /> },
  { id: "access", label: "Remote Access", icon: <KeyIcon /> },
];

interface SttForm { sttProvider: "local" | "openai"; modelSel: string; customModel: string; apiKey: string; micMode: "toggle" | "hold" }

interface SettingsForm {
  autoSave: boolean;
  autoSaveDelaySeconds: number;
  minimap: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  diffSplit: boolean;
  betterComments: BetterCommentsConfig;
}

export const SettingsModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(function SettingsModal({ origin, onClose }, ref) {
  const current: SettingsForm = {
    autoSave: useUi(s => s.autoSave),
    autoSaveDelaySeconds: useUi(s => s.autoSaveDelaySeconds),
    minimap: useUi(s => s.minimap),
    wordWrap: useUi(s => s.wordWrap),
    lineNumbers: useUi(s => s.lineNumbers),
    diffSplit: useUi(s => s.diffSplit),
    betterComments: useUi(s => s.betterComments),
  };
  const applySettings = useUi(s => s.setSettings);
  // Activity Bar Position applies instantly (like the theme / spaces bar), not via the Save button.
  const sidebarPosition = useUi(s => s.sidebarPosition);
  const setSidebarPosition = useUi(s => s.setSidebarPosition);
  const stageEnabled = useUi(s => s.stageManagerEnabled);
  const stageManagerPosition = useUi(s => s.stageManagerPosition);
  const setStageManagerPosition = useUi(s => s.setStageManagerPosition);
  const stageManagerScale = useUi(s => s.stageManagerScale);
  const setStageManagerScale = useUi(s => s.setStageManagerScale);
  const setUiSettings = useUi(s => s.setSettings);
  const stageMode = useUi(s => s.stageMode);
  const setStageMode = useUi(s => s.setStageMode);
  const stageOpen = useUi(s => s.stageOpen);
  const toggleStage = useUi(s => s.toggleStage);
  const micPosition = useUi(s => s.micPosition);
  const setMicPosition = useUi(s => s.setMicPosition);
  const dictationHotkey = useUi(s => s.dictationHotkey);
  const setDictationHotkey = useUi(s => s.setDictationHotkey);
  const dictationHotkeyMode = useUi(s => s.dictationHotkeyMode);
  const setDictationHotkeyMode = useUi(s => s.setDictationHotkeyMode);
  const dictationSound = useUi(s => s.dictationSound);
  const setDictationSound = useUi(s => s.setDictationSound);
  // Spaces bar visibility is a per-device preference (localStorage) that applies live, like the
  // theme picker and the voice prefs below — not part of the Save-gated form.
  const showSpacesBar = useUi(s => s.showSpacesBar);
  const setShowSpacesBar = useUi(s => s.setShowSpacesBar);
  // Bottom-bar chrome — per-device live toggles, like the spaces switcher. Turning system stats off
  // also unmounts the readout, which stops its background 2s CPU/RAM/network poll (matters on slower
  // hosts); the active-windows taskbar piggybacks on app-wide polls, so off just hides it.
  const showSystemStats = useUi(s => s.showSystemStats);
  const setShowSystemStats = useUi(s => s.setShowSystemStats);
  const showRoomTaskbar = useUi(s => s.showRoomTaskbar);
  const setShowRoomTaskbar = useUi(s => s.setShowRoomTaskbar);
  // The per-device terminal typography/layout prefs (font size, family, line height, brightness, …)
  // are read+written inside <TerminalAppearance/> (Settings → Appearance → Terminal) — see that file.
  // Focus-bar color — server-synced (so it follows you across browsers/the tunnel) but applied live
  // via the ui store (CSS var) so the change shows instantly without a Save.
  const focusBarColor = useUi(s => s.focusBarColor);
  const setFocusBarColor = useUi(s => s.setFocusBarColor);
  // Voice-alert prefs are per-device (localStorage) and apply live — handled outside the form's
  // Save flow, like the access token below. The Test button speaks a sample with the chosen voice.
  const voiceAlerts = useUi(s => s.voiceAlerts);
  const setVoiceAlerts = useUi(s => s.setVoiceAlerts);
  const voiceName = useUi(s => s.voiceName);
  const setVoiceName = useUi(s => s.setVoiceName);
  const voiceRate = useUi(s => s.voiceRate);
  const setVoiceRate = useUi(s => s.setVoiceRate);
  const voiceVolume = useUi(s => s.voiceVolume);
  const setVoiceVolume = useUi(s => s.setVoiceVolume);
  const toastPosition = useUi(s => s.toastPosition);
  const setToastPosition = useUi(s => s.setToastPosition);
  const speakAgentMessages = useUi(s => s.speakAgentMessages);
  const setSpeakAgentMessages = useUi(s => s.setSpeakAgentMessages);
  const beepBeforeSpeak = useUi(s => s.beepBeforeSpeak);
  const setBeepBeforeSpeak = useUi(s => s.setBeepBeforeSpeak);
  const voices = useVoices();
  // Your notification voice can be ANY voice installed on this computer — it's independent of the
  // agent pool below (that's curated separately in "Agent voice pool"). Grouped by language with
  // <optgroup> so it stays scannable.
  const pickerGroups = useMemo(() => {
    const m = new Map<string, SpeechSynthesisVoice[]>();
    for (const v of voices) { const k = langLabel(v.lang); const arr = m.get(k); if (arr) arr.push(v); else m.set(k, [v]); }
    return [...m.entries()]
      .map(([lang, vs]) => [lang, vs.slice().sort((a, b) => a.name.localeCompare(b.name))] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [voices]);
  const qc = useQueryClient();
  // A panel (e.g. the File Browser's Places bar) can ask Settings to open on a specific tab via the
  // store. TopBar opens the modal; we read the requested tab here, switch to it, then clear the signal.
  const settingsRequest = useUi(s => s.settingsRequest);
  const clearSettingsRequest = useUi(s => s.clearSettingsRequest);
  const [tab, setTab] = useState<TabId>(() =>
    settingsRequest && TABS.some(t => t.id === settingsRequest.tab) ? settingsRequest.tab as TabId : "appearance");
  const [form, setForm] = useState<SettingsForm>(current);
  const [error, setError] = useState("");
  // Settings search → jump: switch to the setting's tab, then (after the panel mounts) scroll its row
  // into view and flash it. rAF×2 waits a frame for the new tab to render. A missing anchor (settings
  // that live inside child components) just no-ops the scroll — the tab switch alone still gets there.
  const contentRef = useRef<HTMLDivElement>(null);
  const jumpToSetting = (t: TabId, id: string) => {
    setTab(t);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const node = contentRef.current?.querySelector<HTMLElement>(`[data-setting-id="${id}"]`);
      if (!node) return;
      node.scrollIntoView({ block: "center", behavior: "smooth" });
      node.classList.add("tr-setting-flash");
      window.setTimeout(() => node.classList.remove("tr-setting-flash"), 1400);
    }));
  };
  useEffect(() => {
    if (!settingsRequest) return;
    if (TABS.some(t => t.id === settingsRequest.tab)) setTab(settingsRequest.tab as TabId);
    clearSettingsRequest();
  }, [settingsRequest, clearSettingsRequest]);

  // Resizable + draggable modal. Size and position both persist; a stored position is clamped to
  // the current viewport, and falls back to centered when absent. The top-left anchor lets the
  // bottom-right grip track the cursor 1:1, and the header drags the whole window around.
  const [box, setBox] = useState(() => {
    const s = readStoredBox();
    const w = Math.min(s.w, window.innerWidth - MARGIN * 2);
    const h = Math.min(s.h, window.innerHeight - MARGIN * 2);
    const cx = Math.max(MARGIN, (window.innerWidth - w) / 2);
    const cy = Math.max(MARGIN, (window.innerHeight - h) / 2);
    const x = typeof s.x === "number" ? Math.min(Math.max(MARGIN, s.x), Math.max(MARGIN, window.innerWidth - w - MARGIN)) : cx;
    const y = typeof s.y === "number" ? Math.min(Math.max(MARGIN, s.y), Math.max(MARGIN, window.innerHeight - h - MARGIN)) : cy;
    return { w, h, x, y };
  });
  // One pointer gesture at a time — either resizing from the grip or dragging from the header.
  const drag = useRef<{ mode: "resize" | "move"; px: number; py: number; w: number; h: number; x: number; y: number } | null>(null);
  const persist = (b: typeof box) => { try { localStorage.setItem(SIZE_KEY, JSON.stringify(b)); } catch { /* private mode: skip */ } };

  const onResizeStart = (e: ReactPointerEvent) => {
    e.preventDefault();
    drag.current = { mode: "resize", px: e.clientX, py: e.clientY, w: box.w, h: box.h, x: box.x, y: box.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMoveStart = (e: ReactPointerEvent) => {
    if ((e.target as Element).closest("button")) return; // let the close button (and any header button) work
    e.preventDefault();
    drag.current = { mode: "move", px: e.clientX, py: e.clientY, w: box.w, h: box.h, x: box.x, y: box.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px, dy = e.clientY - d.py;
    if (d.mode === "resize") {
      setBox(b => ({
        ...b,
        w: Math.max(MIN_W, Math.min(d.w + dx, window.innerWidth - b.x - MARGIN)),
        h: Math.max(MIN_H, Math.min(d.h + dy, window.innerHeight - b.y - MARGIN)),
      }));
    } else {
      setBox(b => ({
        ...b,
        x: Math.min(Math.max(MARGIN, d.x + dx), Math.max(MARGIN, window.innerWidth - b.w - MARGIN)),
        y: Math.min(Math.max(MARGIN, d.y + dy), Math.max(MARGIN, window.innerHeight - b.h - MARGIN)),
      }));
    }
  };
  const onDragEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    persist(box);
  };

  // Keep the modal on-screen if the viewport shrinks under it.
  useEffect(() => {
    const clamp = () => setBox(b => {
      const w = Math.min(b.w, window.innerWidth - MARGIN * 2);
      const h = Math.min(b.h, window.innerHeight - MARGIN * 2);
      return { w, h, x: Math.min(b.x, Math.max(MARGIN, window.innerWidth - w - MARGIN)), y: Math.min(b.y, Math.max(MARGIN, window.innerHeight - h - MARGIN)) };
    });
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);

  // Grow-from-icon on open, minimize-to-icon on close — same trick as the other windows. Mount
  // collapsed onto the gear icon's rect, flip to full size next frame, and only unmount (onClose)
  // once the collapse transition ends. A second press of the gear runs close() to play it too.
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const handleClose = () => { if (reduce) { onClose(); return; } setExpanded(false); };
  useImperativeHandle(ref, () => ({ close: handleClose }));
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
  };

  // Access token (for remote/exposed use) lives only in this browser's localStorage, not the
  // server settings — apply it on save and reload so the new auth header takes effect.
  const tokenAlreadySet = !!getToken();
  // Pre-fill with the saved token so it can be revealed (the eye toggle) and copied
  // to share with another device, not just typed fresh.
  const [tokenField, setTokenField] = useState(getToken() ?? "");
  const [showToken, setShowToken] = useState(false);

  // STT settings live only on the server (the key is write-only), so fetch + edit them here
  // separately from the ui-store-backed editor prefs above.
  const { data: serverSettings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const keyAlreadySet = serverSettings?.openaiKeySet ?? false;
  const pushoverConfigured = serverSettings?.pushoverConfigured ?? false;
  const [pushover, setPushover] = useState({ token: "", user: "" });
  const [pushTest, setPushTest] = useState<{ state: "idle" | "busy" | "ok" | "fail"; msg?: string }>({ state: "idle" });
  const [stt, setStt] = useState<SttForm>({ sttProvider: "local", modelSel: "gpt-4o-transcribe", customModel: "", apiKey: "", micMode: "toggle" });
  useEffect(() => {
    if (!serverSettings) return;
    const m = serverSettings.openaiSttModel;
    const known = OPENAI_STT_MODELS.includes(m);
    setStt(s => ({ ...s, sttProvider: serverSettings.sttProvider, modelSel: known ? m : "custom", customModel: known ? "" : m, micMode: serverSettings.micMode }));
  }, [serverSettings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (reduce) onClose(); else setExpanded(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, reduce]);

  const save = useMutation({
    mutationFn: (payload: Parameters<typeof api.updateSettings>[0]) => api.updateSettings(payload),
    onSuccess: () => {
      applySettings(form);
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["stt", "status"] });
      handleClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  // Canvas backdrop (Settings → Appearance) applies instantly like the theme — not part of the
  // Save-gated form. Optimistically patch the cached settings so the canvas behind the modal updates
  // live, and debounce the PATCH so a slider/color drag doesn't hammer the server.
  const canvasBackground = serverSettings?.canvasBackground ?? DEFAULT_CANVAS_BACKGROUND;
  const bgTimer = useRef<number | null>(null);
  const onCanvasBackground = (bg: CanvasBackground) => {
    qc.setQueryData<SettingsResponse>(["settings"], (old) => old ? { ...old, canvasBackground: bg } : old);
    if (bgTimer.current) window.clearTimeout(bgTimer.current);
    bgTimer.current = window.setTimeout(() => { api.updateSettings({ canvasBackground: bg }).catch(() => {}); }, 250);
  };
  useEffect(() => () => { if (bgTimer.current) window.clearTimeout(bgTimer.current); }, []);

  // Stage Manager dock frosted-panel background — same live-apply pattern: optimistically patch the
  // cached settings so the dock (which reads the ["settings"] query) restyles live as you drag, and
  // debounce the PATCH so a color/opacity/blur drag doesn't hammer the server.
  const stageDock = serverSettings?.stageDock ?? DEFAULT_STAGE_DOCK;
  const dockTimer = useRef<number | null>(null);
  const onStageDock = (d: StageDock) => {
    qc.setQueryData<SettingsResponse>(["settings"], (old) => old ? { ...old, stageDock: d } : old);
    if (dockTimer.current) window.clearTimeout(dockTimer.current);
    dockTimer.current = window.setTimeout(() => { api.updateSettings({ stageDock: d }).catch(() => {}); }, 250);
  };
  useEffect(() => () => { if (dockTimer.current) window.clearTimeout(dockTimer.current); }, []);

  // Terminal colors (focus bar + status-bar text). Both apply live and persist server-side; the PATCH
  // is debounced so dragging the color picker doesn't hammer the server (and, for the status text,
  // re-style every live tmux session on every tick). The focus bar updates its CSS var instantly via
  // the ui store; the status text reflects in the cached settings so its swatch tracks the drag.
  const colorTimer = useRef<number | null>(null);
  const debouncePatch = (patch: Parameters<typeof api.updateSettings>[0]) => {
    if (colorTimer.current) window.clearTimeout(colorTimer.current);
    colorTimer.current = window.setTimeout(() => { api.updateSettings(patch).catch(() => {}); }, 250);
  };
  useEffect(() => () => { if (colorTimer.current) window.clearTimeout(colorTimer.current); }, []);
  const statusFg = serverSettings?.tmuxStatusFg ?? "#22c55e";
  const onFocusBarColor = (hex: string) => { setFocusBarColor(hex); debouncePatch({ focusBarColor: hex }); };
  const onStatusFg = (hex: string) => {
    qc.setQueryData<SettingsResponse>(["settings"], (old) => old ? { ...old, tmuxStatusFg: hex } : old);
    debouncePatch({ tmuxStatusFg: hex });
  };

  // Attention detection (server-synced, applies live): mode picker + quiet window. Optimistically patch
  // the cached settings so the controls track instantly; the seconds stepper debounces its PATCH so the
  // server doesn't re-arm every live session on each click. The mode change persists immediately.
  const attentionMode = serverSettings?.attentionMode ?? "layered";
  const silenceSeconds = serverSettings?.silenceSeconds ?? 10;
  const onAttentionMode = (m: "layered" | "explicit" | "silence") => {
    qc.setQueryData<SettingsResponse>(["settings"], (old) => old ? { ...old, attentionMode: m } : old);
    api.updateSettings({ attentionMode: m }).catch(() => {});
  };
  const silenceTimer = useRef<number | null>(null);
  const onSilenceSeconds = (n: number) => {
    const v = Math.max(1, Math.min(120, n));
    qc.setQueryData<SettingsResponse>(["settings"], (old) => old ? { ...old, silenceSeconds: v } : old);
    if (silenceTimer.current) window.clearTimeout(silenceTimer.current);
    silenceTimer.current = window.setTimeout(() => { api.updateSettings({ silenceSeconds: v }).catch(() => {}); }, 250);
  };
  useEffect(() => () => { if (silenceTimer.current) window.clearTimeout(silenceTimer.current); }, []);

  // Persist the picked Activity Bar Position to the server (the ui-store change already applied it
  // live for the open room).
  const persistSidebar = useMutation({
    mutationFn: (p: SidebarPosition) => api.updateSettings({ sidebarPosition: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const pickSidebar = (p: SidebarPosition) => { setSidebarPosition(p); persistSidebar.mutate(p); };

  // Stage Manager: position + enabled are server-synced (apply live in the store, persist to server);
  // mode + show are per-browser (store only).
  const persistStagePos = useMutation({
    mutationFn: (p: SidebarPosition) => api.updateSettings({ stageManagerPosition: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const pickStagePos = (p: SidebarPosition) => { setStageManagerPosition(p); persistStagePos.mutate(p); };
  const persistStageEnabled = useMutation({
    mutationFn: (on: boolean) => api.updateSettings({ stageManagerEnabled: on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const setStageEnabled = (on: boolean) => { setUiSettings({ stageManagerEnabled: on }); persistStageEnabled.mutate(on); };

  // Verify the Pushover keys. If new ones are typed, save them first so the server tests the values
  // the user is looking at (the test endpoint validates the STORED keys). Never fakes a result.
  const testPushover = async () => {
    setPushTest({ state: "busy" });
    try {
      const token = pushover.token.trim(), user = pushover.user.trim();
      if (token || user) {
        await api.updateSettings({ ...(token ? { pushoverToken: token } : {}), ...(user ? { pushoverUser: user } : {}) });
        qc.invalidateQueries({ queryKey: ["settings"] });
      }
      const r = await api.pushover.test();
      setPushTest(r.ok ? { state: "ok" } : { state: "fail", msg: r.errors.join(", ") || "Validation failed" });
    } catch (e) { setPushTest({ state: "fail", msg: (e as Error).message }); }
  };

  const onSave = async () => {
    // The access token is client-side (localStorage) and gates EVERY request —
    // including the settings PATCH below. So when it changes, handle it first:
    // store it, then validate against an auth-gated endpoint. Doing the PATCH first
    // would 401 on an exposed host before the token could ever be saved (the bug
    // that made the token unsettable through a tunnel). On loopback the probe always
    // passes (token is ignored there), which is fine.
    const t = tokenField.trim();
    const prev = getToken() ?? "";
    if (t !== prev) {
      setError("");
      if (!t) { clearToken(); location.reload(); return; } // clearing: no probe needed
      setToken(t);
      try {
        await api.getSettings(); // carries the new token; throws 401 if the server rejects it
      } catch {
        if (prev) setToken(prev); else clearToken(); // roll back so a bad token can't lock the UI out
        setError("Token rejected — make sure it matches the server's TERMINALHUB_TOKEN.");
        setTab("access");
        return;
      }
      location.reload();
      return;
    }

    const model = (stt.modelSel === "custom" ? stt.customModel.trim() : stt.modelSel) || "gpt-4o-transcribe";
    save.mutate({
      ...form,
      sttProvider: stt.sttProvider,
      openaiSttModel: model,
      micMode: stt.micMode,
      ...(stt.apiKey.trim() ? { openaiApiKey: stt.apiKey.trim() } : {}),
      ...(pushover.token.trim() ? { pushoverToken: pushover.token.trim() } : {}),
      ...(pushover.user.trim() ? { pushoverUser: pushover.user.trim() } : {}),
    });
  };

  const update = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setError("");
    setForm(s => ({ ...s, [key]: value }));
  };

  const saveDisabled = save.isPending
    || !Number.isFinite(form.autoSaveDelaySeconds)
    || form.autoSaveDelaySeconds < 1
    || form.autoSaveDelaySeconds > 60;

  const appearance = (
    <div className="space-y-8">
      <Section title="Appearance">
        <Row id="theme" title="Theme" hint="Applies instantly. Open the list, arrow ↑/↓ to preview live, click to keep.">
          <ThemePicker align="right" />
        </Row>
      </Section>

      <Section title="Canvas Background">
        <div className="text-xs text-dim">
          The backdrop behind your workspace cards. Applies instantly to every space. Right-click a space's
          canvas to give just that space its own background.
        </div>
        <CanvasBackgroundEditor value={canvasBackground} onChange={onCanvasBackground} />
      </Section>

      <Section title="Workbench">
        <Row id="activity-bar-position" title="Activity Bar Position" hint="Where the view switcher (Explorer, Source Control, …) lives. Top/left/right sit inside the side panel. Applies instantly.">
          <div className="flex rounded border border-edge-strong bg-canvas p-0.5">
            {(["bottom", "left", "right", "top"] as SidebarPosition[]).map(p => (
              <Segment key={p} active={sidebarPosition === p} onClick={() => pickSidebar(p)}>{p[0].toUpperCase() + p.slice(1)}</Segment>
            ))}
          </div>
        </Row>
        <Toggle
          id="spaces-switcher"
          title="Spaces switcher"
          hint="Show the virtual-spaces switcher (the Home pill + dots) in the top bar. Off hides it. Applies instantly."
          checked={showSpacesBar}
          onChange={setShowSpacesBar}
        />
        <Toggle
          id="system-stats"
          title="System stats"
          hint="Show the CPU / RAM / network readout in the bottom bar. Off hides it AND stops its background polling. Applies instantly."
          checked={showSystemStats}
          onChange={setShowSystemStats}
        />
        <Toggle
          id="active-windows"
          title="Active windows"
          hint="Show the open-rooms taskbar (one pill per open room) in the bottom bar. Off hides it. Applies instantly."
          checked={showRoomTaskbar}
          onChange={setShowRoomTaskbar}
        />
      </Section>

      <Section title="Stage Manager">
        <Toggle
          id="stage-enable"
          title="Enable Stage Manager"
          hint="A macOS-style edge dock of live previews of your open rooms. Off hides it completely — no launcher tile, nothing mounts."
          checked={stageEnabled}
          onChange={setStageEnabled}
        />
        <Row id="stage-position" title="Dock position" hint="Which edge the Stage Manager dock anchors to. Applies instantly.">
          <div className="flex rounded border border-edge-strong bg-canvas p-0.5">
            {(["left", "right", "bottom"] as SidebarPosition[]).map(p => (
              <Segment key={p} active={stageManagerPosition === p} onClick={() => pickStagePos(p)}>{p[0].toUpperCase() + p.slice(1)}</Segment>
            ))}
          </div>
        </Row>
        <Row id="stage-size" title="Dock size" hint="Shrink the whole dock — every tile and the gaps between them get smaller, same layout. Drag to preview live.">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={stageManagerScale}
              onChange={(e) => setStageManagerScale(Number(e.target.value))}
              className="w-40 accent-blue-500"
            />
            <span className="w-9 text-right tabular-nums text-xs text-muted">{Math.round(stageManagerScale * 100)}%</span>
          </div>
        </Row>
        <Row id="stage-mode" title="Default mode" hint="All-open keeps every room on the canvas (the dock is a switcher). Spotlight shows only the centered room; the rest keep running off-canvas.">
          <div className="flex rounded border border-edge-strong bg-canvas p-0.5">
            <Segment active={stageMode === "all"} onClick={() => setStageMode("all")}>All-open</Segment>
            <Segment active={stageMode === "spotlight"} onClick={() => setStageMode("spotlight")}>Spotlight</Segment>
          </div>
        </Row>
        <StageDockEditor value={stageDock} onChange={onStageDock} />
        <Toggle
          title="Show dock now"
          hint="Show or hide the dock. You can also toggle it from the launcher (Stage Manager)."
          checked={stageOpen}
          onChange={(v) => { if (v !== stageOpen) toggleStage(); }}
        />
      </Section>
    </div>
  );

  const editor = (
    <div className="space-y-8">
      <Section title="Files">
        <Toggle id="auto-save" title="Auto Save" hint="Save edited files after a short quiet period." checked={form.autoSave} onChange={(v) => update("autoSave", v)} />
        <Row id="auto-save-delay" title="Auto-save delay" hint="Seconds after the last edit before saving.">
          <input
            type="number"
            min={1}
            max={60}
            value={form.autoSaveDelaySeconds}
            onChange={(e) => update("autoSaveDelaySeconds", Number(e.target.value))}
            className="w-20 rounded border border-edge-strong bg-canvas px-2 py-1 text-right text-bright outline-none focus:border-blue-500"
          />
        </Row>
      </Section>

      <Section title="Editor">
        <Toggle id="word-wrap" title="Word Wrap" hint="Wrap long lines inside the editor." checked={form.wordWrap} onChange={(v) => update("wordWrap", v)} />
        <Toggle id="minimap" title="Minimap" hint="Show the file minimap beside code." checked={form.minimap} onChange={(v) => update("minimap", v)} />
        <Toggle id="line-numbers" title="Line Numbers" hint="Show the editor line-number gutter." checked={form.lineNumbers} onChange={(v) => update("lineNumbers", v)} />
        <Toggle id="split-diff" title="Split Diff View" hint="Show diffs side by side instead of inline." checked={form.diffSplit} onChange={(v) => update("diffSplit", v)} />
      </Section>

      <BetterCommentsSettings value={form.betterComments} onChange={(v) => update("betterComments", v)} />
    </div>
  );

  const terminal = (
    <div className="space-y-8">
      <Section title="Colors">
        <Row id="focus-bar-color" title="Focus bar color" hint="The glowing bar under the terminal that's taking input. Applies instantly.">
          <ColorField value={focusBarColor || "#22c55e"} onChange={onFocusBarColor} />
        </Row>
        <Row id="status-bar-color" title="Status bar text color" hint="The text in each terminal's bottom (tmux) status bar. Applies to all open terminals.">
          <ColorField value={statusFg} onChange={onStatusFg} />
        </Row>
      </Section>

      <TerminalAppearance />
    </div>
  );

  const voice = (
    <div className="space-y-8">
      <Section title="Notifications">
        <Row id="attention-mode" title="Detect agent attention by" hint="Layered = bell/notify codes AND going quiet (never miss). Explicit only = bell/notify codes (no false alarms). Silence only = went quiet after working (works for any tool).">
          <div className="flex rounded border border-edge-strong bg-canvas p-0.5">
            <Segment active={attentionMode === "layered"} onClick={() => onAttentionMode("layered")}>Layered</Segment>
            <Segment active={attentionMode === "explicit"} onClick={() => onAttentionMode("explicit")}>Explicit</Segment>
            <Segment active={attentionMode === "silence"} onClick={() => onAttentionMode("silence")}>Silence</Segment>
          </div>
        </Row>
        {attentionMode !== "explicit" && (
          <Row id="quiet-window" title="Quiet window" hint="How many seconds a terminal must be silent before it counts as finished. Higher = fewer false alarms mid-task; lower = quicker notice.">
            <Stepper value={silenceSeconds} min={1} max={120} suffix="s" onChange={onSilenceSeconds} />
          </Row>
        )}
        <ToastPositionPicker id="toast-position" value={toastPosition} onChange={setToastPosition} />
        {speechSupported() ? (
          <>
            <Toggle
              id="voice-announcements"
              title="Voice announcements"
              hint="Speak aloud when a terminal needs attention, using your system voice. Silent for the terminal you're already looking at."
              checked={voiceAlerts}
              onChange={setVoiceAlerts}
            />
            <Row id="notification-voice" title="Your notification voice" hint="Speaks your attention alerts — and agent messages when the agent doesn't pick its own from the pool below.">
              <div className="flex items-center gap-2">
                <select
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  className="w-40 rounded border border-edge-strong bg-canvas px-2 py-1 text-bright outline-none focus:border-blue-500">
                  <option value="">System default</option>
                  {pickerGroups.map(([lang, vs]) => (
                    <optgroup key={lang} label={lang}>
                      {vs.map(v => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                    </optgroup>
                  ))}
                </select>
                <button type="button" onClick={() => speak("Claude needs attention", voiceName, voiceRate, voiceVolume)}
                  className="rounded bg-surface px-2 py-1 text-xs text-fg hover:bg-elevated">Test</button>
              </div>
            </Row>
            <Row id="voice-speed" title="Speed" hint="How fast announcements are spoken. Test to hear the change.">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={voiceRate}
                  onChange={(e) => setVoiceRate(Number(e.target.value))}
                  className="w-40 accent-blue-500"
                />
                <span className="w-9 text-right tabular-nums text-xs text-muted">{voiceRate.toFixed(1)}×</span>
              </div>
            </Row>
            <Row id="voice-volume" title="Volume" hint="How loud announcements are spoken in this browser. Test to hear the change.">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={voiceVolume}
                  onChange={(e) => setVoiceVolume(Number(e.target.value))}
                  className="w-40 accent-blue-500"
                />
                <span className="w-9 text-right tabular-nums text-xs text-muted">{Math.round(voiceVolume * 100)}%</span>
              </div>
            </Row>
            <Toggle
              id="speak-agent"
              title="Speak agent messages"
              hint="Read messages your agents send to the dashboard out loud, so you don't miss them."
              checked={speakAgentMessages}
              onChange={setSpeakAgentMessages}
            />
            <Toggle
              id="chime"
              title="Chime before speaking"
              hint="Play a short attention sound before a spoken message."
              checked={beepBeforeSpeak}
              onChange={setBeepBeforeSpeak}
            />
            <div className="text-xs text-dim">Saved on this device; applies immediately.</div>
          </>
        ) : (
          <div className="text-xs text-dim">This browser doesn't support speech synthesis, so voice announcements aren't available.</div>
        )}
      </Section>

      {speechSupported() && <VoiceManager />}

      <Section title="Speech-to-Text">
        <Row id="stt-mic-mode" title="Mic button" hint="Toggle: click to start, click again to stop. Hold: record while pressed, transcribe on release.">
          <div className="flex rounded border border-edge-strong bg-canvas p-0.5">
            <Segment active={stt.micMode === "toggle"} onClick={() => setStt(s => ({ ...s, micMode: "toggle" }))}>Toggle</Segment>
            <Segment active={stt.micMode === "hold"} onClick={() => setStt(s => ({ ...s, micMode: "hold" }))}>Hold</Segment>
          </div>
        </Row>
        <Row id="mic-position" title="Mic button position" hint="Where the dictation mic sits in a room — the window top bar or the bottom bar. Applies instantly.">
          <div className="flex rounded border border-edge-strong bg-canvas p-0.5">
            {(["top", "bottom"] as MicPosition[]).map(p => (
              <Segment key={p} active={micPosition === p} onClick={() => setMicPosition(p)}>{p[0].toUpperCase() + p.slice(1)}</Segment>
            ))}
          </div>
        </Row>
        <Row id="mic-shortcut-mode" title="Mic shortcut mode" hint="Toggle: press once to start, press again to stop. Hold: record only while the shortcut is held, transcribe on release. Applies instantly.">
          <div className="flex rounded border border-edge-strong bg-canvas p-0.5">
            <Segment active={dictationHotkeyMode === "toggle"} onClick={() => setDictationHotkeyMode("toggle")}>Toggle</Segment>
            <Segment active={dictationHotkeyMode === "hold"} onClick={() => setDictationHotkeyMode("hold")}>Hold</Segment>
          </div>
        </Row>
        <Row id="mic-shortcut" title="Mic shortcut" hint={dictationHotkeyMode === "hold" ? "Hold this combo to dictate into the focused terminal, release to transcribe. Click the key, then type your combo." : "Press to start dictating into the focused terminal, press again to stop. Click the key, then type your combo."}>
          <HotkeyField value={dictationHotkey} onChange={setDictationHotkey} />
        </Row>
        <Toggle
          id="mic-sound"
          title="Mic activation sound"
          hint="Play a short blip when dictation starts and stops, so you don't have to watch the mic. Applies instantly."
          checked={dictationSound}
          onChange={setDictationSound}
        />
        <Row id="stt-engine" title="Engine" hint="Local whisper.cpp when running, otherwise OpenAI.">
          <div className="flex rounded border border-edge-strong bg-canvas p-0.5">
            <Segment active={stt.sttProvider === "local"} onClick={() => setStt(s => ({ ...s, sttProvider: "local" }))}>Local</Segment>
            <Segment active={stt.sttProvider === "openai"} onClick={() => setStt(s => ({ ...s, sttProvider: "openai" }))}>OpenAI</Segment>
          </div>
        </Row>
        <Row id="openai-key" title="OpenAI API key" hint={keyAlreadySet ? "A key is saved. Type to replace it." : "Stored on the server, never shown again."}>
          <input
            type="password"
            autoComplete="off"
            value={stt.apiKey}
            placeholder={keyAlreadySet ? "•••••• saved" : "sk-..."}
            onChange={(e) => { setError(""); setStt(s => ({ ...s, apiKey: e.target.value })); }}
            className="w-44 rounded border border-edge-strong bg-canvas px-2 py-1 text-bright outline-none focus:border-blue-500"
          />
        </Row>
        <Row id="openai-model" title="OpenAI model" hint="Used when transcribing via OpenAI.">
          <select
            value={stt.modelSel}
            onChange={(e) => setStt(s => ({ ...s, modelSel: e.target.value }))}
            className="w-44 rounded border border-edge-strong bg-canvas px-2 py-1 text-bright outline-none focus:border-blue-500">
            {OPENAI_STT_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            <option value="custom">Custom…</option>
          </select>
        </Row>
        {stt.modelSel === "custom" && (
          <input
            value={stt.customModel}
            placeholder="model id (e.g. a newer transcription model)"
            onChange={(e) => setStt(s => ({ ...s, customModel: e.target.value }))}
            className="w-full rounded border border-edge-strong bg-canvas px-2 py-1 text-bright outline-none focus:border-blue-500"
          />
        )}
        <div className="text-xs text-dim">
          No local server? Build <a className="text-blue-400 hover:underline" href="https://github.com/ggml-org/whisper.cpp" target="_blank" rel="noreferrer">whisper.cpp</a>, run it on :8080, and <code>brew install ffmpeg</code>.
        </div>
      </Section>

      <Section title="Pushover">
        <div className="text-xs text-dim">
          Push calendar reminders to your phone. Create an app at <a className="text-blue-400 hover:underline" href="https://pushover.net" target="_blank" rel="noreferrer">pushover.net</a>,
          then paste the application <span className="text-fg">API token</span> and your <span className="text-fg">user key</span>. Stored on the server, never shown again.
        </div>
        <Row id="pushover" title="API token" hint={pushoverConfigured ? "Configured. Type to replace it." : "Your Pushover application API token."}>
          <input type="password" autoComplete="off" value={pushover.token}
            placeholder={pushoverConfigured ? "•••••• saved" : "azGDORePK8gMaC0QOYAMyEEuzJnyUi"}
            onChange={(e) => { setError(""); setPushTest({ state: "idle" }); setPushover(s => ({ ...s, token: e.target.value })); }}
            className="w-44 rounded border border-edge-strong bg-canvas px-2 py-1 text-bright outline-none focus:border-blue-500" />
        </Row>
        <Row title="User key" hint={pushoverConfigured ? "Configured. Type to replace it." : "Your Pushover user (or group) key."}>
          <input type="password" autoComplete="off" value={pushover.user}
            placeholder={pushoverConfigured ? "•••••• saved" : "uQiRzpo4DXghDmr9QzzfQu27cmVRsG"}
            onChange={(e) => { setError(""); setPushTest({ state: "idle" }); setPushover(s => ({ ...s, user: e.target.value })); }}
            className="w-44 rounded border border-edge-strong bg-canvas px-2 py-1 text-bright outline-none focus:border-blue-500" />
        </Row>
        <Row title="Status" hint="Validate the keys against Pushover (saves typed keys first; no message is sent).">
          <div className="flex items-center gap-2">
            {pushTest.state === "ok" && <span className="text-xs text-success">✓ Working</span>}
            {pushTest.state === "fail" && <span className="text-xs text-error">{pushTest.msg || "Failed"}</span>}
            {pushTest.state === "idle" && pushoverConfigured && <span className="text-xs text-dim">Configured</span>}
            <button type="button" onClick={testPushover} disabled={pushTest.state === "busy" || (!pushoverConfigured && !pushover.token.trim() && !pushover.user.trim())}
              className="rounded bg-surface px-2 py-1 text-xs text-fg hover:bg-elevated disabled:opacity-50">
              {pushTest.state === "busy" ? "Testing…" : "Test"}
            </button>
          </div>
        </Row>
      </Section>
    </div>
  );

  const copilot = <CopilotSettings />;

  const connections = (
    <div className="space-y-8">
      <GoogleDriveSettings />
    </div>
  );

  const access = (
    <div className="space-y-8">
      <Section title="Remote Access">
        <Row id="access-token" title="Access token" hint={tokenAlreadySet ? "A token is saved in this browser. Type to replace it." : "Needed to reach Terminal Hub over a tunnel or non-loopback host."}>
          <div className="relative w-44">
            <input
              type={showToken ? "text" : "password"}
              autoComplete="off"
              value={tokenField}
              placeholder="paste token"
              onChange={(e) => { setError(""); setTokenField(e.target.value); }}
              className="w-full rounded border border-edge-strong bg-canvas py-1 pl-2 pr-8 text-bright outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowToken(s => !s)}
              aria-label={showToken ? "Hide token" : "Show token"}
              title={showToken ? "Hide token" : "Show token"}
              className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-dim hover:text-fg"
            >
              <EyeIcon off={showToken} />
            </button>
          </div>
        </Row>
        <div className="text-xs text-dim">Saved on this device only; the page reloads when you set it.</div>

        <details className="group rounded border border-edge bg-canvas/50 px-3 py-2">
          <summary className="flex cursor-pointer select-none list-none items-center text-xs text-muted hover:text-fg">
            <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">▸</span>
            How does this work?
          </summary>
          <div className="mt-2 space-y-2 text-xs leading-relaxed text-dim">
            <p>
              On your own machine (<Code>localhost</Code>) no token is needed. One is required only when you reach
              Terminal Hub through a tunnel (e.g. Cloudflare) or a non-loopback host.
            </p>
            <p>
              It has two halves that must match: the server is started with a <Code>TERMINALHUB_TOKEN</Code> env var,
              and you paste that <em>same</em> value here on each device you connect from (iPad, laptop…).
            </p>
            <ol className="list-decimal space-y-1.5 pl-4">
              <li>Generate a secret: <Code>openssl rand -hex 32</Code></li>
              <li>Start the server with it: <Code>TERMINALHUB_TOKEN=… npm start</Code>, with your tunnel pointed at <Code>127.0.0.1:8189</Code>.</li>
              <li>Paste the same value in the box above and save — the page reloads and sends it with every request.</li>
            </ol>
            <p>A wrong or missing server token shows up as a connection that never authorizes (HTTP 401).</p>
          </div>
        </details>
      </Section>
    </div>
  );

  const panels = { appearance, editor, terminal, voice, copilot, connections, access };

  // Collapse target: scale down + slide the window's top-left onto the gear icon's top-left. Falls
  // back to a centered shrink when the opener rect is unknown. Animate transform/opacity only — never
  // left/top/width/height — so drag and resize stay instant.
  const collapsed = origin
    ? `translate(${origin.x - box.x}px, ${origin.y - box.y}px) scale(${origin.w / box.w}, ${origin.h / box.h})`
    : "scale(0.94)";
  const boxStyle: CSSProperties = {
    left: box.x, top: box.y, width: box.w, height: box.h,
    ...(reduce ? {} : {
      transformOrigin: origin ? "0 0" : "50% 50%",
      transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
      opacity: expanded ? 1 : 0,
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  return (
    // No click-away-to-close: the backdrop is a transparent stacking layer that lets clicks pass
    // straight through (pointer-events-none) so the gear icon underneath still receives a second
    // press to minimize-close. The box re-enables pointer events for itself. The user closes the
    // modal deliberately (✕, Cancel, Escape, or that second gear press) — clicking outside never does.
    <div className="pointer-events-none fixed inset-0 z-[80]">
      <div
        onTransitionEnd={onTransitionEnd}
        style={boxStyle}
        className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border border-edge-strong bg-canvas shadow-2xl">
        <div
          onPointerDown={onMoveStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          className="flex cursor-move touch-none select-none items-center justify-between border-b border-edge px-5 py-3.5">
          <div>
            <div className="text-sm font-semibold text-bright">Settings</div>
            <div className="text-xs text-dim">Editor and workbench preferences</div>
          </div>
          <button onClick={handleClose} title="Close settings"
            className="h-7 w-7 cursor-pointer rounded text-muted leading-none hover:bg-elevated hover:text-bright">×</button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-edge p-3">
            <SettingsSearch onJump={jumpToSetting} />
            {TABS.map(t => {
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                    isActive ? "bg-surface text-bright" : "text-muted hover:bg-surface/60 hover:text-fg"
                  }`}>
                  {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
                  <span className={isActive ? "text-accent" : "text-dim"}>{t.icon}</span>
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </nav>

          <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto px-6 py-5 text-sm">
            {panels[tab]}
          </div>
        </div>

        <div className="border-t border-edge px-5 py-3">
          {error && <div className="mb-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={handleClose} className="rounded bg-surface px-3 py-1.5 text-sm text-fg hover:bg-elevated">Cancel</button>
            <button disabled={saveDisabled} onClick={onSave}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50">
              {save.isPending ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </div>

        <button
          type="button"
          aria-label="Resize settings"
          title="Drag to resize"
          onPointerDown={onResizeStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          className="group absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize touch-none items-end justify-end p-1 text-edge-strong hover:text-muted">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <path d="M9 3 3 9M9 7l-2 2" />
          </svg>
        </button>
      </div>
    </div>
  );
});

// Section / Row / Toggle / Segment / Stepper / ColorField / Slider / Code primitives + the tab icons
// now live in ./Settings/controls and ./Settings/icons (shared with the per-tab section components).

// Click to arm, then press a combo to rebind. Captures in the capture phase so the keystroke can't
// leak to the app; Escape cancels. Modifiers are shown live as they're held (so ⌘/⌥/⇧ register
// visibly), and the binding commits the moment a non-modifier key lands.
function HotkeyField({ value, onChange }: { value: Hotkey; onChange: (hk: Hotkey) => void }) {
  const [capturing, setCapturing] = useState(false);
  const [held, setHeld] = useState("");
  useEffect(() => {
    if (!capturing) { setHeld(""); return; }
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") { setCapturing(false); return; }
      // Backspace / Delete clears the binding (back to unbound) so the user can blank a shortcut, not
      // just rebind it — handy since the default ships unbound to avoid colliding with hard-refresh.
      if (e.code === "Backspace" || e.code === "Delete") { onChange({ mod: false, shift: false, alt: false, code: "" }); setCapturing(false); return; }
      setHeld(describeEvent(e));            // live feedback for the modifiers held so far
      const hk = hotkeyFromEvent(e);
      if (!hk) return;                       // bare modifier — keep waiting for the real key
      onChange(hk);
      setCapturing(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, onChange]);
  return (
    <button
      type="button"
      onClick={() => setCapturing(c => !c)}
      className={`min-w-[6rem] rounded border px-3 py-1 font-mono text-sm ${capturing ? "border-blue-500 text-blue-300" : "border-edge-strong text-bright hover:border-edge"}`}
    >
      {capturing ? (held || "Press keys… (⌫ clears)") : (formatHotkey(value) || "Click to set")}
    </button>
  );
}

// The 9 toast anchors, laid out as a 3×3 mini-screen so picking a spot is point-and-click. Reading
// order matches the grid (top row → bottom row), and the labels double as button tooltips.
const TOAST_CELLS: { pos: ToastPosition; label: string }[] = [
  { pos: "top-left", label: "Top left" }, { pos: "top-center", label: "Top center" }, { pos: "top-right", label: "Top right" },
  { pos: "center-left", label: "Center left" }, { pos: "center", label: "Center" }, { pos: "center-right", label: "Center right" },
  { pos: "bottom-left", label: "Bottom left" }, { pos: "bottom-center", label: "Bottom center" }, { pos: "bottom-right", label: "Bottom right" },
];

/** Pick where toasts appear: a little 3×3 "screen" where each cell is a position. The selected cell
 *  fills its accent pill; everything else is a faint placeholder. */
function ToastPositionPicker({ id, value, onChange }: { id?: string; value: ToastPosition; onChange: (p: ToastPosition) => void }) {
  return (
    <div data-setting-id={id} className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-fg">Toast position</div>
        <div className="text-xs text-dim">Where pop-up messages appear on screen. {TOAST_CELLS.find(c => c.pos === value)?.label}.</div>
      </div>
      <div className="grid aspect-[16/10] w-44 shrink-0 grid-cols-3 grid-rows-3 gap-1 rounded-lg border border-edge-strong bg-canvas p-1.5">
        {TOAST_CELLS.map(({ pos, label }) => {
          const active = value === pos;
          return (
            <button key={pos} type="button" onClick={() => onChange(pos)} title={label} aria-label={label}
              className={`grid place-items-center rounded-md transition ${active ? "bg-accent/20 ring-1 ring-accent" : "hover:bg-surface"}`}>
              <span className={`h-1.5 w-4 rounded-full ${active ? "bg-accent" : "bg-edge-strong"}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Segment / Stepper / ColorField / Slider / Code and the tab/eye icons moved to ./Settings/controls
// and ./Settings/icons so this file stays under the size limit and the section components can reuse them.
