import { useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { imageMime } from "../../lib/fileKinds";

// Light checkerboard so transparent PNGs/SVGs read as transparent rather than blending into the pane.
const CHECKER: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #80808022 25%, transparent 25%), linear-gradient(-45deg, #80808022 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #80808022 75%), linear-gradient(-45deg, transparent 75%, #80808022 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};

function fmtSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
}

/**
 * Inline viewer for image files (png, jpg, gif, webp, svg, …). Fetches the file's raw bytes as
 * base64 through the same endpoint the binary editors use (25 MiB cap) and renders them as a data
 * URL. Fits the image to the pane by default; "Actual size" switches to 1:1 with scroll. Renders
 * for `kind: "image-preview"` tabs, so clicking an image in the explorer shows it here instead of
 * the "binary file" message.
 */
export function ImageView({ path, name }: { path: string; name: string }) {
  const [actual, setActual] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["fs-bytes", path],
    queryFn: () => api.fsReadFileBytes(path),
    staleTime: 10_000,
  });

  if (isLoading) return <Centered>Loading…</Centered>;
  if (error) return <Centered>Couldn’t read this image.</Centered>;
  if (data?.tooLarge) return <Centered>Image is too large to preview.</Centered>;
  if (!data?.dataBase64) return <Centered>Couldn’t read this image.</Centered>;

  const src = `data:${imageMime(name)};base64,${data.dataBase64}`;

  return (
    <div className="h-full flex flex-col">
      {/* Fit mode flex-centers (image always fits, so no clipping); actual mode drops the flex so an
          oversized image scrolls from the top-left instead of being clipped by the centering. */}
      <div
        className={`flex-1 min-h-0 overflow-auto p-4 ${actual ? "" : "flex items-center justify-center"}`}
        style={CHECKER}>
        <img
          src={src}
          alt={name}
          draggable={false}
          onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className={actual ? "block max-w-none" : "max-w-full max-h-full object-contain"}
        />
      </div>
      <div className="shrink-0 flex items-center gap-3 h-7 px-3 text-xs text-dim border-t border-edge bg-panel">
        {dims && <span>{dims.w} × {dims.h}</span>}
        <span>{fmtSize(data.size)}</span>
        <span className="flex-1" />
        <button onClick={() => setActual(a => !a)} className="hover:text-fg" title={actual ? "Fit to window" : "View at 100%"}>
          {actual ? "Fit" : "Actual size"}
        </button>
      </div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="h-full flex items-center justify-center text-dim text-sm">{children}</div>;
}
