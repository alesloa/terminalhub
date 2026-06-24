import { EditorView, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { resolveDefinition, type DefinitionTarget } from "./gotoDefinition";

// `sourcePos` is the document offset the jump started from — recorded in the history so Back returns here.
export type NavigateFn = (target: DefinitionTarget, sourcePos: number) => void;

const LONG_PRESS_MS = 500; // hold this long on touch to pop the "Go to Definition" menu
const MOVE_TOLERANCE = 10;  // px of finger drift that cancels a long-press

/** A tiny floating menu (themed via the app's CSS vars) with a single "Go to Definition" action.
 *  Appended to <body> so it isn't clipped by the editor; dismisses on the next outside pointer. */
function buildMenu(x: number, y: number, label: string, onPick: () => void): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText =
    `position:fixed;left:${x}px;top:${y}px;z-index:9999;min-width:160px;`
    + `background:rgb(var(--tr-surface));border:1px solid rgb(var(--tr-edge));`
    + `border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.4);padding:4px;`
    + `font:13px/1.4 ui-sans-serif,system-ui,sans-serif;`;
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.style.cssText =
    `display:block;width:100%;text-align:left;padding:6px 10px;border:0;background:transparent;`
    + `color:rgb(var(--tr-fg));cursor:pointer;border-radius:4px;`;
  btn.addEventListener("pointerenter", () => { btn.style.background = "rgb(var(--tr-bg))"; });
  btn.addEventListener("pointerleave", () => { btn.style.background = "transparent"; });
  btn.addEventListener("click", (e) => { e.stopPropagation(); onPick(); });
  el.appendChild(btn);

  const dismiss = (e: Event) => {
    if (el.contains(e.target as Node)) return;
    el.remove();
    document.removeEventListener("pointerdown", dismiss, true);
  };
  // Defer so the opening event itself doesn't immediately dismiss it.
  setTimeout(() => document.addEventListener("pointerdown", dismiss, true), 0);
  return el;
}

// Cursor affordance: while Cmd/Ctrl is held, hovered code reads as clickable (like an IDE).
const modHoverTheme = EditorView.theme({ "&.cm-lsp-modready .cm-content": { cursor: "pointer" } });

/** Adaptive go-to-definition input. Per-EVENT pointerType (never a global device guess), so hybrid
 *  devices (iPad+trackpad, touch laptops) behave correctly:
 *   - mouse / pen + Cmd(mac)/Ctrl(win,linux) click → jump to definition
 *   - touch long-press → popover menu with "Go to Definition"
 *   - right-click → same menu (desktop discoverability)
 *   - F12 → jump to definition at the cursor (keyboard)
 */
export function lspNavigation(opts: { onNavigate: NavigateFn; onNoDefinition?: () => void }): Extension {
  let openMenu: HTMLElement | null = null;
  const closeMenu = () => { openMenu?.remove(); openMenu = null; };

  const go = async (view: EditorView, pos: number) => {
    const target = await resolveDefinition(view, pos);
    if (target) opts.onNavigate(target, pos);
    else opts.onNoDefinition?.();
  };
  const showMenu = (view: EditorView, x: number, y: number, pos: number) => {
    closeMenu();
    openMenu = buildMenu(x, y, "Go to Definition", () => { closeMenu(); void go(view, pos); });
    document.body.appendChild(openMenu);
  };

  let longPress = 0;

  return [
    modHoverTheme,
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (!(e.metaKey || e.ctrlKey)) return false;
        if ((e as PointerEvent).pointerType === "touch") return false; // touch uses long-press
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        e.preventDefault();
        void go(view, pos);
        return true;
      },
      pointerdown(e, view) {
        if (e.pointerType !== "touch") return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        const startX = e.clientX, startY = e.clientY;
        window.clearTimeout(longPress);
        longPress = window.setTimeout(() => { detach(); showMenu(view, startX, startY, pos); }, LONG_PRESS_MS);
        const onMove = (m: PointerEvent) => {
          if (Math.hypot(m.clientX - startX, m.clientY - startY) > MOVE_TOLERANCE) { window.clearTimeout(longPress); detach(); }
        };
        const onUp = () => { window.clearTimeout(longPress); detach(); };
        const detach = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp, { once: true });
        window.addEventListener("pointercancel", onUp, { once: true });
        return false; // don't block the normal tap/caret placement
      },
      contextmenu(e, view) {
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        e.preventDefault();
        showMenu(view, e.clientX, e.clientY, pos);
        return true;
      },
      // Toggle the clickable-cursor affordance as the modifier goes down/up while hovering.
      mousemove(e, view) {
        const want = e.metaKey || e.ctrlKey;
        const has = view.dom.classList.contains("cm-lsp-modready");
        if (want && !has) view.dom.classList.add("cm-lsp-modready");
        else if (!want && has) view.dom.classList.remove("cm-lsp-modready");
        return false;
      },
      mouseleave(_e, view) { view.dom.classList.remove("cm-lsp-modready"); return false; },
    }),
    keymap.of([{ key: "F12", run: (view) => { void go(view, view.state.selection.main.head); return true; } }]),
  ];
}
