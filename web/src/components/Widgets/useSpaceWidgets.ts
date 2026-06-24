import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useToasts } from "../../store/toasts";
import type { SpaceWidget, SpaceWidgetKind } from "../../api/types";

const EMPTY: SpaceWidget[] = [];
type Patch = Partial<{ spaceId: string | null; x: number; y: number; w: number; h: number; config: Record<string, unknown> | null }>;

/** Canvas widgets data + mutations, mirroring useStickyNotes: one query fetches all widgets; drag /
 *  resize call `save()` which patches the cache optimistically then reconciles with the server row. */
export function useSpaceWidgets() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["spaceWidgets"], queryFn: () => api.spaceWidgets.list() });
  const widgets = q.data?.spaceWidgets ?? EMPTY;

  const patchCache = (id: string, patch: Partial<SpaceWidget>) => {
    qc.setQueryData<{ spaceWidgets: SpaceWidget[] }>(["spaceWidgets"], (d) =>
      d ? { spaceWidgets: d.spaceWidgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) } : d);
  };
  const setList = (fn: (list: SpaceWidget[]) => SpaceWidget[]) =>
    qc.setQueryData<{ spaceWidgets: SpaceWidget[] }>(["spaceWidgets"], (d) => ({ spaceWidgets: fn(d?.spaceWidgets ?? []) }));

  return {
    widgets,
    create: async (b: { spaceId?: string | null; kind: SpaceWidgetKind; x: number; y: number; w: number; h: number; config?: Record<string, unknown> | null }) => {
      // Optimistic: the card appears the instant it's dropped (a temp row), then reconciles with the
      // real server row — so a drop is never a dead click. On failure we roll back and toast loudly
      // instead of swallowing the error.
      const now = Date.now();
      const tempId = `sw_tmp_${now}`;
      const temp: SpaceWidget = { id: tempId, spaceId: b.spaceId ?? null, kind: b.kind, x: b.x, y: b.y, w: b.w, h: b.h, config: b.config ?? null, createdAt: now, updatedAt: now };
      setList((l) => [...l, temp]);
      try {
        const { spaceWidget } = await api.spaceWidgets.create(b);
        setList((l) => l.map((w) => (w.id === tempId ? spaceWidget : w)));
        return spaceWidget;
      } catch (e) {
        setList((l) => l.filter((w) => w.id !== tempId));
        useToasts.getState().push(e instanceof Error ? `Couldn't add widget: ${e.message}` : "Couldn't add widget");
        return null;
      }
    },
    save: async (id: string, patch: Patch) => {
      patchCache(id, patch as Partial<SpaceWidget>);
      const { spaceWidget } = await api.spaceWidgets.update(id, patch);
      patchCache(id, spaceWidget);
      return spaceWidget;
    },
    remove: async (id: string) => {
      qc.setQueryData<{ spaceWidgets: SpaceWidget[] }>(["spaceWidgets"], (d) =>
        d ? { spaceWidgets: d.spaceWidgets.filter((w) => w.id !== id) } : d);
      await api.spaceWidgets.remove(id);
    },
  };
}
