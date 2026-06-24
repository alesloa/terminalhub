import type { Space, Workspace } from "../../api/types";
import { useUi, rectOf } from "../../store/ui";
import { SpacePreview } from "./SpacePreview";

/** The Mission-Control panel body: a row of live space previews + a "New space" tile. Rendered inside
 *  the SpacesMenu dropdown (anchored under the Home pill in the top bar) — it owns no bar chrome of its
 *  own. Picking a space switches to it (which closes the dropdown via setActiveSpace). "New space"
 *  opens the Space Creation Wizard (growing out of the tile), where the user picks skills/commands/MCP
 *  servers/env/rules to seed into every workspace in the space. */
export function SpacesOverview({ spaces, activeSpaceId, homeSpaceId, workspaces, attentionSpaceIds }: {
  spaces: Space[]; activeSpaceId: string | null; homeSpaceId: string | null;
  workspaces: Workspace[]; attentionSpaceIds: Set<string>;
}) {
  const setActiveSpace = useUi(s => s.setActiveSpace);
  const openWizard = useUi(s => s.openSpaceWizard);

  return (
    <div className="flex gap-3 px-4 py-3 overflow-x-auto">
      {spaces.map(s => (
        <SpacePreview key={s.id} space={s}
          workspaces={workspaces.filter(w => w.spaceId === s.id)}
          active={s.id === activeSpaceId} attention={attentionSpaceIds.has(s.id)} isHome={s.id === homeSpaceId}
          onOpen={() => setActiveSpace(s.id)} />
      ))}
      {/* + tile → the wizard, growing out of this tile */}
      <button onClick={(e) => openWizard({ mode: "create", spaceId: null, origin: rectOf(e.currentTarget) })}
        className="w-[180px] h-[116px] shrink-0 rounded-lg border border-dashed border-edge text-muted hover:text-bright hover:border-accent flex items-center justify-center gap-2">
        <span className="codicon codicon-add" aria-hidden /> New space
      </button>
    </div>
  );
}
