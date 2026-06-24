import { useEffect, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { basename } from "../../lib/paths";
import { startPathDrag } from "../../lib/dragImage";
import { getFolderIconUrl } from "../../lib/materialIcons";
import { listRef } from "./listing";
import { refKey, sameRef, type DriveRoot, type Ref } from "./ref";

// The right-clicked node, carrying its `ref` (callers that need a host path read `ref.kind==="host"`).
// `webViewLink` is the Drive "Open in Google" target (drive entries only; null for host / folders).
// `google` flags a Drive-native doc (no raw bytes → not editable, opens in Google instead).
export interface BrowserTarget { ref: Ref; name: string; type: "dir" | "file"; webViewLink?: string | null; google?: boolean }

interface TreeProps {
  roots: Ref[];
  selectedRef: Ref;
  onSelectRef: (ref: Ref) => void;
  showHidden: boolean;
  onContextMenu: (e: ReactMouseEvent, target: BrowserTarget) => void;
  isCut?: (ref: Ref) => boolean;
}

// The three fixed Drive roots an account node expands into (display label + the root key).
const DRIVE_ROOTS: { root: DriveRoot; label: string }[] = [
  { root: "myDrive", label: "My Drive" },
  { root: "sharedWithMe", label: "Shared with me" },
  { root: "sharedDrives", label: "Shared drives" },
];

// True for the synthetic account node (drive ref with neither a folder id nor a special root): it
// renders the three fixed roots as children instead of listing the API.
const isAccountNode = (r: Ref) => r.kind === "drive" && r.fileId === null && r.root === null;

function nodeLabel(ref: Ref): string {
  if (ref.kind === "host") return basename(ref.path) || ref.path;
  if (isAccountNode(ref)) return ref.accountLabel;
  const fixed = DRIVE_ROOTS.find((d) => d.root === ref.root);
  return fixed ? fixed.label : ref.accountLabel;
}

/**
 * The left navigator: a folders-only tree (files live in the middle list). Shows EVERY root at once —
 * Computer (the host) plus one node per connected Drive — as siblings, so opening a Drive never hides
 * your local files (Finder-style). Lazy-loads each folder's sub-folders on expand, keyed by `refKey`
 * so host and drive subtrees never collide. Host nodes are draggable (emit the full path so a folder
 * can be dropped into a terminal); drive nodes aren't — no host path exists to hand over. A drive
 * account node expands into My Drive / Shared with me / Shared drives. Auto-expands the chain down to
 * `selectedRef` for host (cheap path prefix walk); for drive, only the root auto-opens (Drive has no
 * cheap ancestry).
 */
export function BrowserTree({ roots, selectedRef, onSelectRef, showHidden, onContextMenu, isCut }: TreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(roots.map(refKey)));
  const toggle = (k: string) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // Keep every root open as the set of roots shifts (a host re-root, or a Drive connecting/leaving).
  useEffect(() => { setExpanded((s) => { const n = new Set(s); roots.forEach((r) => n.add(refKey(r))); return n; }); }, [roots]);
  // Keep the path from the host root down to selectedRef open (host only — cheap prefix walk).
  useEffect(() => {
    const hostRoot = roots.find((r) => r.kind === "host");
    if (!hostRoot || hostRoot.kind !== "host" || selectedRef.kind !== "host") return;
    const root = hostRoot.path, sel = selectedRef.path;
    if (!sel.startsWith(root)) return;
    setExpanded((s) => {
      const n = new Set(s);
      let p = sel;
      while (p && p.length >= root.length) {
        n.add(`host:${p}`);
        const up = p.slice(0, p.lastIndexOf("/"));
        if (up === p || up.length < root.length) break;
        p = up || "/";
      }
      return n;
    });
  }, [selectedRef, roots]);

  return (
    <div className="py-1 text-sm select-none">
      {roots.map((r) => (
        <TreeNode key={refKey(r)} ref_={r} depth={0}
          expanded={expanded} toggle={toggle} selectedRef={selectedRef} onSelectRef={onSelectRef}
          showHidden={showHidden} onContextMenu={onContextMenu} isCut={isCut} />
      ))}
    </div>
  );
}

interface NodeProps extends Omit<TreeProps, "roots"> {
  ref_: Ref; depth: number;
  expanded: Set<string>; toggle: (k: string) => void;
}

function TreeNode({ ref_, depth, expanded, toggle, selectedRef, onSelectRef, showHidden, onContextMenu, isCut }: NodeProps) {
  const key = refKey(ref_);
  const isOpen = expanded.has(key);
  const account = isAccountNode(ref_);

  // Account node lists three fixed roots (no API call); every other node lazy-lists its sub-folders.
  const { data } = useQuery({
    queryKey: ["fb-list", key, showHidden],
    queryFn: () => listRef(ref_, showHidden),
    enabled: isOpen && !account,
    staleTime: 10_000,
    refetchInterval: isOpen && !account ? 4000 : false, // keep folders fresh as files change outside the app
  });

  const childRefs: Ref[] = account
    ? DRIVE_ROOTS.map((d) => ({ kind: "drive", accountId: (ref_ as Extract<Ref, { kind: "drive" }>).accountId, accountLabel: (ref_ as Extract<Ref, { kind: "drive" }>).accountLabel, fileId: null, root: d.root }))
    : (data ?? []).filter((e) => e.type === "dir").map((e) => e.ref);

  const name = nodeLabel(ref_);
  const selected = sameRef(selectedRef, ref_);
  const draggable = ref_.kind === "host";

  return (
    <>
      <div
        draggable={draggable}
        onDragStart={draggable ? (e: ReactDragEvent<HTMLDivElement>) => startPathDrag(e, [(ref_ as Extract<Ref, { kind: "host" }>).path]) : undefined}
        onClick={() => { onSelectRef(ref_); if (!isOpen) toggle(key); }}
        onContextMenu={(e) => onContextMenu(e, { ref: ref_, name, type: "dir" })}
        style={{ paddingLeft: depth * 12 + 6 }}
        className={`pr-2 h-6 flex items-center gap-1 cursor-pointer ${selected ? "bg-elevated" : "hover:bg-surface"} ${isCut?.(ref_) ? "opacity-50" : ""}`}>
        <span onClick={(e) => { e.stopPropagation(); toggle(key); }} className="text-dim w-3 shrink-0 inline-block text-center">
          {isOpen ? "▾" : "▸"}
        </span>
        <img src={getFolderIconUrl(name, isOpen)} alt="" className="w-4 h-4 shrink-0" draggable={false} />
        <span className="truncate">{name}</span>
      </div>
      {isOpen && childRefs.map((cr) => (
        <TreeNode key={refKey(cr)} ref_={cr} depth={depth + 1}
          expanded={expanded} toggle={toggle} selectedRef={selectedRef} onSelectRef={onSelectRef}
          showHidden={showHidden} onContextMenu={onContextMenu} isCut={isCut} />
      ))}
    </>
  );
}
