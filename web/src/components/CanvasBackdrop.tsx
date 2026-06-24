import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CanvasBackground } from "../api/types";
import { resolveWallpaperCss, uploadIdOf } from "../lib/wallpapers";

/** The fixed backdrop behind a space's canvas: a solid color / wallpaper layer plus an optional
 *  black dim scrim. Sits behind the (transparent) SpaceCanvas so cards scroll over it. Renders
 *  nothing interactive — pointer-events-none so it never eats a card drag/click. */
export function CanvasBackdrop({ bg }: { bg: CanvasBackground }) {
  // Only an uploaded wallpaper needs a network fetch; built-ins + gradients resolve synchronously.
  const uploadId = bg.kind === "wallpaper" && bg.wallpaper ? uploadIdOf(bg.wallpaper) : null;
  const { data: upload } = useQuery({
    queryKey: ["wallpaper", uploadId],
    queryFn: () => api.wallpapers.get(uploadId!),
    enabled: !!uploadId,
    staleTime: Infinity,
  });

  let background: string | undefined; // CSS `background` value; undefined => fall back to the theme
  let scrim = 0;                      // 0..1 black overlay opacity
  if (bg.kind === "solid") {
    background = bg.color ?? undefined;        // null = theme default canvas color
    scrim = bg.overlay ? bg.dim / 100 : 0;
  } else {
    background = resolveWallpaperCss(bg.wallpaper, upload?.wallpaper.dataUrl) ?? undefined;
    scrim = bg.dim / 100;                       // wallpaper: the lone overlay slider
  }
  const useTheme = background === undefined;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className={`absolute inset-0 ${useTheme ? "bg-canvas" : ""}`} style={useTheme ? undefined : { background }} />
      {scrim > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: scrim }} />}
    </div>
  );
}
