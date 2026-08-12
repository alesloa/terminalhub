import { useRef, useState } from "react";
import type { GuiAgent, GuiConfig, GuiModel } from "../../api/guiTypes";
import { BoltIcon, Pill, PillPopover, PopoverBody, PopoverDivider, PopoverRow, PopoverSection } from "./ComposerPopover";
import { EFFORT_LABELS, isContext1m, reasoningLabel, withContextWindow } from "./composerOptions";

const MENU_W = 240;

/**
 * How hard the model thinks, how much context it gets, and whether fast mode is on — the three knobs
 * that are all properties of the *selected model*, so they share one pill and each group only appears
 * when that model actually offers it. The caller hides the pill entirely for a model that offers none.
 *
 * Ultracode and Ultrathink are plain `effort` values on this contract: picking one writes `effort`
 * like any other row. The server owns what that means (a Claude Code setting, a prompt prefix) — the
 * composer never touches the text the user typed. They are Claude Code concepts with no Codex
 * counterpart, so they are the one thing here that depends on which agent is behind the chat.
 */
export function ReasoningPill({ agent, model, config, onPatch }: {
  agent: GuiAgent;
  model: GuiModel;
  config: GuiConfig;
  onPatch: (patch: Partial<GuiConfig>) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);
  const pick = (patch: Partial<GuiConfig>) => { close(); onPatch(patch); };

  const oneM = isContext1m(config.model);

  return (
    <>
      <Pill
        ref={btnRef}
        label={reasoningLabel(model, config)}
        title="Reasoning, context window, and fast mode"
        open={open}
        icon={config.fastMode ? <BoltIcon /> : undefined}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <PillPopover anchor={btnRef} width={MENU_W} onClose={close}>
          <PopoverBody>
            {(model.effortLevels.length > 0 || model.supportsEffort) && (
              <PopoverSection label="Reasoning">
                {model.effortLevels.map((level) => (
                  <PopoverRow
                    key={level}
                    title={EFFORT_LABELS[level]}
                    chip={level === model.defaultEffort ? "Default" : undefined}
                    selected={config.effort === level}
                    onClick={() => pick({ effort: level })}
                  />
                ))}
                {agent === "claude" && model.effortLevels.includes("xhigh") && (
                  <PopoverRow
                    title="Ultracode"
                    selected={config.effort === "ultracode"}
                    onClick={() => pick({ effort: "ultracode" })}
                  />
                )}
                {agent === "claude" && model.supportsEffort && (
                  <PopoverRow
                    title="Ultrathink"
                    selected={config.effort === "ultrathink"}
                    onClick={() => pick({ effort: "ultrathink" })}
                  />
                )}
              </PopoverSection>
            )}

            {model.supportsContext1m && (
              <>
                <PopoverDivider />
                <PopoverSection label="Context Window">
                  {/* Both ids are built from this row's own `base`, never from the display name or
                      the id currently selected. */}
                  <PopoverRow
                    title="200k"
                    selected={!oneM}
                    onClick={() => pick({ model: withContextWindow(model.base, false) })}
                  />
                  <PopoverRow
                    title="1M"
                    selected={oneM}
                    onClick={() => pick({ model: withContextWindow(model.base, true) })}
                  />
                </PopoverSection>
              </>
            )}

            {model.supportsFastMode && (
              <>
                <PopoverDivider />
                <PopoverSection label="Fast Mode">
                  <PopoverRow title="On" selected={config.fastMode} onClick={() => pick({ fastMode: true })} />
                  <PopoverRow title="Off" selected={!config.fastMode} onClick={() => pick({ fastMode: false })} />
                </PopoverSection>
              </>
            )}
          </PopoverBody>
        </PillPopover>
      )}
    </>
  );
}
