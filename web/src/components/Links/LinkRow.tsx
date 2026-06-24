import { useState, type CSSProperties } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Link } from "../../api/types";
import { hostOf, normalizeUrl } from "../../hooks/useLinks";
import { ArrowDown, ArrowUp, CheckIcon, GlobeIcon, IconBtn, PencilIcon, TrashIcon, XIcon } from "./icons";

// Two-line ellipsis for the description — webkit line-clamp, inline so it doesn't depend on the
// Tailwind line-clamp plugin/version. The title above it uses the plain `truncate` class (one line).
const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as CSSProperties;

/**
 * One saved link. The whole row is the drag handle (an 8px activation distance lets a stationary
 * click still open the link in a new tab); while grabbed it follows the cursor and floats above its
 * siblings (a relative CSS transform — no fixed DragOverlay, which a transformed/blurred ancestor
 * like the dropdown panel would offset). Dropping another link on it inserts before this one (a blue
 * line marks the spot). Hover reveals reorder/edit/delete actions and a native multiline tooltip with
 * the full URL, title, and description. `dragDisabled` makes the row inert for the flat search
 * results, where cross-folder ordering is meaningless.
 */
export function LinkRow({ link, tag, indent, onOpen, onEdit, onDelete, onUp, onDown, onColorMenu, dragDisabled }: {
  link: Link; tag?: string; indent?: boolean;
  onOpen: () => void; onEdit: () => void; onDelete: () => void;
  onUp?: () => void; onDown?: () => void; onColorMenu?: (x: number, y: number) => void; dragDisabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const folderId = link.folderId ?? null;
  const drag = useDraggable({ id: link.id, data: { type: "link", folderId }, disabled: dragDisabled });
  const drop = useDroppable({ id: `link:${link.id}`, data: { type: "link", folderId, linkId: link.id }, disabled: dragDisabled });
  const setRef = (el: HTMLDivElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el); };
  const title = link.title || hostOf(link.url);
  const tip = [normalizeUrl(link.url), title, link.description].filter(Boolean).join("\n");

  return (
    <div ref={setRef} {...drag.listeners} {...drag.attributes}
      onContextMenu={onColorMenu ? (e) => { e.preventDefault(); onColorMenu(e.clientX, e.clientY); } : undefined}
      style={{
        transform: drag.transform ? `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)` : undefined,
        zIndex: drag.isDragging ? 30 : undefined,
      }}
      className={`group/row relative flex items-start gap-2 py-1.5 pr-2 ${indent ? "pl-9" : "pl-3"} ${dragDisabled ? "" : "cursor-grab active:cursor-grabbing"} ${
        drag.isDragging ? "rounded-md bg-panel shadow-lg ring-1 ring-edge-strong" : "hover:bg-elevated/50"
      }`}>
      {/* insert-before indicator while another dragged link hovers this row */}
      {drop.isOver && !drag.isDragging && <span className="pointer-events-none absolute inset-x-2 -top-px h-0.5 rounded bg-blue-500" />}

      <button onClick={onOpen} title={tip} className="flex min-w-0 flex-1 items-start gap-2 text-left">
        <span className="mt-0.5 shrink-0 text-dim" style={link.color ? { color: link.color } : undefined}><GlobeIcon small /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-bright" style={link.color ? { color: link.color } : undefined}>{title}</span>
            {tag && <span className="shrink-0 rounded bg-elevated px-1.5 text-[10px] text-dim">{tag}</span>}
          </span>
          <span className="block text-[11px] text-dim">{hostOf(link.url)}</span>
          {link.description && <span className="mt-0.5 block text-[11px] text-muted" style={link.color ? { ...clamp2, color: link.color, opacity: 0.6 } : clamp2}>{link.description}</span>}
        </span>
      </button>

      <span className="absolute right-1.5 top-1 flex items-center rounded-md bg-panel/90 opacity-0 shadow transition group-hover/row:opacity-100">
        {confirming ? (
          <>
            <IconBtn title="Confirm delete" danger onClick={() => { setConfirming(false); onDelete(); }}><CheckIcon /></IconBtn>
            <IconBtn title="Cancel" onClick={() => setConfirming(false)}><XIcon /></IconBtn>
          </>
        ) : (
          <>
            {onUp && <IconBtn title="Move up" onClick={onUp}><ArrowUp /></IconBtn>}
            {onDown && <IconBtn title="Move down" onClick={onDown}><ArrowDown /></IconBtn>}
            <IconBtn title="Edit" onClick={onEdit}><PencilIcon /></IconBtn>
            <IconBtn title="Delete" danger onClick={() => setConfirming(true)}><TrashIcon /></IconBtn>
          </>
        )}
      </span>
    </div>
  );
}
