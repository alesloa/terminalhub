import { useEffect, useMemo } from "react";
import type { ITheme } from "@xterm/xterm";
import { useUi } from "../store/ui";
import { getTheme } from "./themes";
import { adjustXtermTheme, applyTheme, xtermTheme } from "./applyTheme";

// Applies the active theme to the document whenever the ui-store theme id changes (boot hydration
// flows through the same store field, so this covers initial load too). The theme picker drives
// live preview by writing the theme id straight to this field (reverting on cancel), so this hook
// recolors the chrome in real time for free. Mount once near the app root.
export function useThemeSync(): void {
  const themeId = useUi((s) => s.theme);
  const bgLevel = useUi((s) => s.terminalBgLevel);
  const focusBarColor = useUi((s) => s.focusBarColor);
  useEffect(() => {
    const theme = getTheme(themeId);
    applyTheme(theme);
    // The focused-terminal bar color (Settings → Appearance) — the focus bar (theme.css) reads this var.
    document.documentElement.style.setProperty("--tr-focus-bar", focusBarColor || "#22c55e");
    // Publish the LIVE terminal background (theme terminal bg + the background-lift slider) as a CSS
    // var so the xterm element + scroll viewport can paint the EXACT same color (theme.css). xterm.css
    // hardcodes the viewport to #000, which otherwise shows as dark bands beside the grid (the side
    // padding + the reserved scrollbar gutter) on any theme whose terminal bg isn't pure black.
    const termBg = adjustXtermTheme(xtermTheme(theme), 100, bgLevel).background ?? theme.terminal.background;
    document.documentElement.style.setProperty("--tr-term-bg", termBg);
  }, [themeId, bgLevel, focusBarColor]);
}

/** The active xterm ITheme, recomputed when the theme OR the comfort sliders change — terminals
 *  re-apply it live (the text-dim / background-lift prefs sit on top of the theme's own colors). */
export function useXtermTheme(): ITheme {
  const themeId = useUi((s) => s.theme);
  const textLevel = useUi((s) => s.terminalTextLevel);
  const bgLevel = useUi((s) => s.terminalBgLevel);
  return useMemo(
    () => adjustXtermTheme(xtermTheme(getTheme(themeId)), textLevel, bgLevel),
    [themeId, textLevel, bgLevel],
  );
}
