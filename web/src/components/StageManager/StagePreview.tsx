import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTerminalPreview } from "../../hooks/useTerminalPreview";
import { ansiToHtml } from "../../util/ansiToHtml";

// The scaled, read-only render of a terminal's CURRENT screen for a Stage Manager tile. Polls the
// server-side capture (works even when the room is unmounted) and renders the ANSI as colored HTML,
// then shrinks the WHOLE captured screen to fit the tile region (no top-left crop) by measuring the
// rendered text and applying a single transform scale. Real capture only — an empty/dead session
// renders empty, never placeholder text.
export function StagePreview({ terminalId, enabled }: { terminalId: string | null; enabled: boolean }) {
  const { data, isLoading } = useTerminalPreview(terminalId, enabled);
  const html = useMemo(() => (data?.content ? ansiToHtml(data.content) : ""), [data?.content]);
  const outerRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [scale, setScale] = useState(0); // 0 = not yet measured (keep hidden to avoid an unscaled flash)

  // Fit the full capture into the region: scale by the more constraining of width/height so every row
  // and column is visible. Re-fits on content change and whenever the tile resizes.
  useLayoutEffect(() => {
    const fit = () => {
      const outer = outerRef.current, pre = preRef.current;
      if (!outer || !pre) return;
      const pw = pre.scrollWidth || 1, ph = pre.scrollHeight || 1;
      setScale(Math.min(outer.clientWidth / pw, outer.clientHeight / ph));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (outerRef.current) ro.observe(outerRef.current);
    return () => ro.disconnect();
  }, [html]);

  return (
    <div ref={outerRef} className="absolute inset-0 overflow-hidden bg-code">
      {!terminalId ? (
        <div className="absolute inset-0 grid place-items-center text-[8px] text-dim">no terminal</div>
      ) : isLoading && !html ? (
        <div className="absolute inset-0 grid place-items-center text-[8px] text-dim">…</div>
      ) : (
        <pre
          ref={preRef}
          className="absolute top-0 left-0 m-0 font-mono text-fg whitespace-pre leading-[1.15] p-1"
          style={{
            fontSize: 9,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            visibility: scale ? "visible" : "hidden",
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
