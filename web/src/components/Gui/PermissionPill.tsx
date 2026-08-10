import { useRef, useState } from "react";
import type { GuiConfig, GuiPermissionMode } from "../../api/guiTypes";
import { LockIcon, Pill, PillPopover, PopoverBody, PopoverRow } from "./ComposerPopover";
import { PERMISSION_OPTIONS } from "./composerOptions";

const MENU_W = 300;

/**
 * How much the agent may do before it has to ask. Changing this restarts the agent behind the chat
 * (the conversation is preserved by resuming it), so the session state flickers for a moment after a
 * pick — expected, not a fault.
 */
export function PermissionPill({ config, onPatch }: {
  config: GuiConfig;
  onPatch: (patch: Partial<GuiConfig>) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const active = PERMISSION_OPTIONS.find((o) => o.id === config.permissionMode) ?? null;
  const close = () => setOpen(false);
  const pick = (id: GuiPermissionMode) => { close(); onPatch({ permissionMode: id }); };

  return (
    <>
      <Pill
        ref={btnRef}
        label={active?.label ?? config.permissionMode}
        title={active?.description ?? "Permissions"}
        open={open}
        // Warn tint, not just an open padlock: skipping every prompt should be obvious at a glance.
        tone={active?.unlocked ? "warn" : undefined}
        icon={<LockIcon unlocked={active?.unlocked} />}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <PillPopover anchor={btnRef} width={MENU_W} onClose={close}>
          <PopoverBody>
            {PERMISSION_OPTIONS.map((o) => (
              <PopoverRow
                key={o.id}
                title={o.label}
                description={o.description}
                icon={<LockIcon unlocked={o.unlocked} />}
                selected={config.permissionMode === o.id}
                onClick={() => pick(o.id)}
              />
            ))}
          </PopoverBody>
        </PillPopover>
      )}
    </>
  );
}
