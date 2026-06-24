import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { BoardCard, BoardColumn } from "../../api/types";

const EMPTY: BoardCard[] = [];
const KEY = ["board"];

/** Optimistic local copy of the server's move: pull the card out, splice it into the target column
 *  at `position` among the others, and renumber that column. The refetch reconciles exact order. */
function reorder(cards: BoardCard[], id: string, column: BoardColumn, position: number): BoardCard[] {
  const moving = cards.find((c) => c.id === id);
  if (!moving) return cards;
  const others = cards.filter((c) => c.id !== id);
  const target = others.filter((c) => c.column === column).sort((a, b) => a.position - b.position);
  target.splice(Math.max(0, Math.min(position, target.length)), 0, { ...moving, column });
  const repositioned = target.map((c, i) => ({ ...c, position: i }));
  return [...others.filter((c) => c.column !== column), ...repositioned];
}

/**
 * Task-board data + mutations. The board is server-backed (so terminal agents can move cards too),
 * so the list is polled — an agent's `curl` PATCH shows up within a couple seconds. Mutations write
 * the cache optimistically for an instant feel, then invalidate so the server's canonical order wins.
 */
export function useBoard() {
  const qc = useQueryClient();
  // Poll the DB-backed board so an agent moving a card (via the API or a direct sqlite write) shows
  // up on its own. Keep polling in the background — the board is usually open behind a terminal.
  const q = useQuery({ queryKey: KEY, queryFn: api.board.list, refetchInterval: 2500, refetchIntervalInBackground: true });
  const cards = q.data?.cards ?? EMPTY;

  const patchCache = (fn: (cards: BoardCard[]) => BoardCard[]) =>
    qc.setQueryData<{ cards: BoardCard[] }>(KEY, (d) => ({ cards: fn(d?.cards ?? []) }));
  const invalidate = () => { qc.invalidateQueries({ queryKey: KEY }); };

  return {
    cards, isLoading: q.isLoading,
    create: async (column: BoardColumn, title = "") => {
      const { card } = await api.board.create({ column, title });
      invalidate();
      return card;
    },
    update: async (id: string, patch: { title?: string; body?: string; color?: string | null }) => {
      patchCache((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      await api.board.update(id, patch);
      invalidate();
    },
    move: async (id: string, column: BoardColumn, position: number) => {
      patchCache((cs) => reorder(cs, id, column, position));
      await api.board.update(id, { column, position });
      invalidate();
    },
    remove: async (id: string) => {
      patchCache((cs) => cs.filter((c) => c.id !== id));
      await api.board.remove(id);
      invalidate();
    },
  };
}
