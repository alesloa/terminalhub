import { useUi } from "../../store/ui";
import { Section, Row, Toggle, Stepper, Slider, Range, Select } from "./controls";
import { TERM_FONT_OPTIONS, TERM_FONT_WEIGHTS, TERM_SCROLLBACKS } from "../../lib/terminalFonts";

const WEIGHT_LABELS: Record<number, string> = { 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold" };
const weightOptions = TERM_FONT_WEIGHTS.map((w) => ({ label: `${WEIGHT_LABELS[w]} (${w})`, value: w }));
const scrollbackOptions = TERM_SCROLLBACKS.map((n) => ({ label: n === 1000 ? "1,000 (default)" : n.toLocaleString(), value: n }));

// Settings → Appearance → Terminal. Every control is a per-browser preference that applies live to
// every open terminal (see useTerminalSocket's appearance effect). Defaults reproduce the historical
// look, so an untouched install is unchanged. Persistence is per-device because xterm renders in THIS
// browser — installed fonts differ per machine — matching how the terminal font size already works.
export function TerminalAppearance() {
  const fontFamily = useUi((s) => s.terminalFontFamily);
  const setFontFamily = useUi((s) => s.setTerminalFontFamily);
  const fontSize = useUi((s) => s.terminalFontSize);
  const setFontSize = useUi((s) => s.setTerminalFontSize);
  const fontWeight = useUi((s) => s.terminalFontWeight);
  const setFontWeight = useUi((s) => s.setTerminalFontWeight);
  const lineHeight = useUi((s) => s.terminalLineHeight);
  const setLineHeight = useUi((s) => s.setTerminalLineHeight);
  const letterSpacing = useUi((s) => s.terminalLetterSpacing);
  const setLetterSpacing = useUi((s) => s.setTerminalLetterSpacing);
  const padding = useUi((s) => s.terminalPadding);
  const setPadding = useUi((s) => s.setTerminalPadding);
  const scrollback = useUi((s) => s.terminalScrollback);
  const setScrollback = useUi((s) => s.setTerminalScrollback);
  const ligatures = useUi((s) => s.terminalLigatures);
  const setLigatures = useUi((s) => s.setTerminalLigatures);
  const textLevel = useUi((s) => s.terminalTextLevel);
  const setTextLevel = useUi((s) => s.setTerminalTextLevel);
  const bgLevel = useUi((s) => s.terminalBgLevel);
  const setBgLevel = useUi((s) => s.setTerminalBgLevel);

  return (
    <Section title="Terminal">
      <Row id="term-font-family" title="Font family" hint="Used for every terminal. The MesloLGS Nerd Font stays in the fallback chain so powerline/devicon glyphs still render. Applies instantly.">
        <Select value={fontFamily} options={TERM_FONT_OPTIONS} onChange={setFontFamily} />
      </Row>
      <Row id="term-font-size" title="Font size" hint="Default text size for new terminals. The +/− on a terminal overrides just that one. Applies instantly.">
        <Stepper value={fontSize} min={8} max={32} suffix="px" onChange={setFontSize} />
      </Row>
      <Row id="term-font-weight" title="Font weight" hint="Thickness of normal terminal text. Applies instantly to open terminals.">
        <Select value={fontWeight} options={weightOptions} onChange={setFontWeight} />
      </Row>
      <Row id="term-line-height" title="Line height" hint="Vertical breathing room between rows. 1.0 is tight (default); higher spreads lines out. Applies instantly.">
        <Range value={lineHeight} min={1} max={1.8} step={0.05} format={(v) => v.toFixed(2)} onChange={setLineHeight} />
      </Row>
      <Row id="term-letter-spacing" title="Letter spacing" hint="Extra whole-pixel gap between characters. 0 is default. Applies instantly.">
        <Range value={letterSpacing} min={0} max={4} step={1} format={(v) => `${v}px`} onChange={setLetterSpacing} />
      </Row>
      <Row id="term-padding" title="Padding" hint="Space around the terminal grid inside its pane. 12px is default. Applies instantly.">
        <Range value={padding} min={0} max={32} step={2} format={(v) => `${v}px`} onChange={setPadding} />
      </Row>
      <Row id="term-scrollback" title="Scrollback" hint="Lines xterm keeps in the pane for scrolling/selection. tmux always holds the full history regardless. Applies to new output.">
        <Select value={scrollback} options={scrollbackOptions} onChange={setScrollback} />
      </Row>
      <Toggle
        id="term-ligatures"
        title="Font ligatures"
        hint="Fuse code sequences (→ != => ===) into single glyphs, when the chosen font supports them (Fira Code, JetBrains Mono, Cascadia Code). Applies instantly."
        checked={ligatures}
        onChange={setLigatures}
      />
      <Row id="term-text-brightness" title="Text brightness" hint="Soften stark-white text — dims the foreground and every terminal color together. Applies instantly to open terminals.">
        <Slider value={textLevel} min={40} max={100} onChange={setTextLevel} />
      </Row>
      <Row id="term-background" title="Background" hint="Lift the terminal background off pure black toward a lighter gray. Applies instantly to open terminals.">
        <Slider value={bgLevel} min={100} max={180} onChange={setBgLevel} />
      </Row>
    </Section>
  );
}
