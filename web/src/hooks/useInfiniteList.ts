import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";

const PAGE = 50;

/**
 * Filter a whole-in-memory list (branches, worktrees — git hands them over all at once) and reveal
 * it incrementally as the user scrolls, so a repo with thousands of refs doesn't mount thousands of
 * rows up front. Same grow-on-scroll shape as the commit graph: start with one page, add a page when
 * the scroll nears the bottom, and auto-grow until the list fills a tall panel (no scrollbar to pull).
 *
 * `toText` maps an item to the string the filter matches against (case-insensitive substring). It's
 * intentionally left out of the memo deps (treated as stable) so an inline lambda doesn't thrash.
 */
export function useInfiniteList<T>(items: T[], toText: (item: T) => string, page = PAGE) {
  const [filter, setFilter] = useState("");
  const [count, setCount] = useState(page);
  const scrollRef = useRef<HTMLDivElement>(null);

  const q = filter.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? items.filter(i => toText(i).toLowerCase().includes(q)) : items),
    [items, q], // eslint-disable-line react-hooks/exhaustive-deps -- toText is stable by contract
  );

  // Reset the window to the top when the filter changes. Deliberately NOT keyed on `items`: the list
  // polls on an interval and hands back a fresh array each refetch — resetting on that would yank the
  // user back to the top and re-collapse the window every few seconds mid-scroll.
  useEffect(() => { setCount(page); if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [q, page]);

  const hasMore = count < filtered.length;
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (hasMore && el.scrollHeight - el.scrollTop - el.clientHeight < 240) setCount(c => c + page);
  };

  // Grow until the rendered rows overflow the panel — otherwise a short list in a tall panel never
  // scrolls and can't load more. Re-checks when the data or the panel size changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fill = () => { if (count < filtered.length && el.scrollHeight <= el.clientHeight) setCount(c => c + page); };
    fill();
    const ro = new ResizeObserver(fill);
    ro.observe(el);
    return () => ro.disconnect();
  }, [filtered.length, count, page]);

  return { filter, setFilter, scrollRef, onScroll, visible: filtered.slice(0, count), filtered, hasMore };
}
