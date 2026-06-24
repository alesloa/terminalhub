import type { Theme, ThemeType } from "../tokens";
import { terminalhub } from "./terminalhub";
import { darkModern } from "./darkModern";
import { terminalhubMidnight } from "./terminalhubMidnight";
// Popular open-source community themes (palettes from mbadolato/iTerm2-Color-Schemes).
import { atomOneDark } from "./atomOneDark";
import { dracula } from "./dracula";
import { nord } from "./nord";
import { tokyoNight } from "./tokyoNight";
import { nightOwl } from "./nightOwl";
import { gruvboxDark } from "./gruvboxDark";
import { monokaiPro } from "./monokaiPro";
import { catppuccinMocha } from "./catppuccinMocha";
import { githubDark } from "./githubDark";
import { cobalt2 } from "./cobalt2";
import { ayuMirage } from "./ayuMirage";
import { githubLight } from "./githubLight";
import { solarizedLight } from "./solarizedLight";
import { catppuccinLatte } from "./catppuccinLatte";
import { atomOneLight } from "./atomOneLight";

// The curated roster. Order here is the order shown in the picker (within each type group):
// house themes first, then the popular community darks, then the lights.
export const THEMES: Theme[] = [
  terminalhub,
  darkModern,
  terminalhubMidnight,
  atomOneDark,
  dracula,
  nord,
  tokyoNight,
  nightOwl,
  gruvboxDark,
  monokaiPro,
  catppuccinMocha,
  githubDark,
  cobalt2,
  ayuMirage,
  githubLight,
  solarizedLight,
  catppuccinLatte,
  atomOneLight,
];

export const DEFAULT_THEME_ID = terminalhub.id;

const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

/** Resolve an id to its theme, falling back to the default for unknown/legacy ids. */
export function getTheme(id: string | null | undefined): Theme {
  return (id && BY_ID.get(id)) || terminalhub;
}

export function isThemeId(id: string): boolean {
  return BY_ID.has(id);
}

/** Themes grouped by type, preserving roster order — drives the Light/Dark sections in the picker. */
export function themesByType(type: ThemeType): Theme[] {
  return THEMES.filter((t) => t.type === type);
}
