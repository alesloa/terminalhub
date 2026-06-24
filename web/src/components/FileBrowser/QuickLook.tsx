import { useEffect, useState, type CSSProperties, type ReactNode, type TransitionEventHandler } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { isLocalHost, revealLabel } from "../../lib/host";
import { useToasts } from "../../store/toasts";
import { isImageFile, isEditableTextName, isVideoFile, isAudioFile } from "../../lib/fileKinds";
import { ImageView } from "../Editor/ImageView";
import { VideoView } from "../Editor/VideoView";
import { AudioView } from "../Editor/AudioView";
import type { WinRect } from "../../store/ui";
import { type Ref } from "./ref";

const DURATION = 240; // ms — zoom-from-item / shrink-to-item, like macOS Quick Look

const isPdf = (name: string) => /\.pdf$/i.test(name);

/**
 * macOS-style Quick Look: a transient, preview-only overlay that zooms open from the file's row
 * (`origin`) over a dimmed backdrop, and shrinks back into that row on dismiss (click-away, Esc, or
 * Space). Host files render images/PDFs/text inline (anything else → a "no preview" card with an
 * Open-in-default-app fallback). Drive files render from the server-streamed bytes — images via
 * <img>, everything else (incl. Google-native docs, which the server returns as PDF) via <iframe> —
 * plus an "Open in Google ↗" button when the file has a webViewLink. Not editable — it never writes.
 */
export function QuickLook({ ref_, name, origin, onClose, webViewLink }:
  { ref_: Ref; name: string; origin: WinRect; onClose: () => void; webViewLink?: string | null }) {
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  const push = useToasts(s => s.push);
  const hostPath = ref_.kind === "host" ? ref_.path : null;

  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);

  const handleClose = () => { if (reduce) { onClose(); return; } setExpanded(false); };
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
  };

  // Space toggles Quick Look shut (matching Finder); Esc closes. Capture phase so it beats the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " ") { e.preventDefault(); e.stopPropagation(); handleClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  // The panel sits centered; size is a comfortable share of the viewport, like Quick Look.
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(980, Math.round(vw * 0.8));
  const h = Math.min(760, Math.round(vh * 0.82));
  const x = Math.round((vw - w) / 2), y = Math.round((vh - h) / 2);
  const collapsed = `translate(${origin.x - x}px, ${origin.y - y}px) scale(${origin.w / w}, ${origin.h / h})`;
  const style: CSSProperties = {
    left: x, top: y, width: w, height: h,
    ...(reduce ? {} : {
      transformOrigin: "0 0",
      transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
      opacity: expanded ? 1 : 0,
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center"
      onPointerDown={handleClose}>
      <div className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${expanded ? "opacity-100" : "opacity-0"}`} />
      <div onTransitionEnd={onTransitionEnd} style={style} onPointerDown={(e) => e.stopPropagation()}
        className="fixed flex flex-col rounded-xl overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
        <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-edge select-none">
          <span className="flex-1 min-w-0 truncate text-sm font-medium">{name}</span>
          {hostPath && isLocalHost && (
            <>
              <button onClick={() => api.openPath(hostPath).catch((e: Error) => push(e.message))}
                className="px-2 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded text-xs">Open</button>
              <button onClick={() => api.revealPath(hostPath).catch((e: Error) => push(e.message))}
                title={revealLabel}
                className="px-2 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded text-xs">Reveal</button>
            </>
          )}
          {ref_.kind === "drive" && webViewLink && (
            <button onClick={() => window.open(webViewLink, "_blank", "noopener")}
              className="px-2 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded text-xs">Open in Google ↗</button>
          )}
          <button onClick={handleClose} title="Close (Esc / Space)"
            className="px-2 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded text-xs">✕</button>
        </div>
        <div className="flex-1 min-h-0">
          {hostPath
            ? <QuickLookBody path={hostPath} name={name} />
            : <DriveBody ref_={ref_} name={name} />}
        </div>
      </div>
    </div>
  );
}

/** Picks a renderer by type: image → ImageView; video → VideoView; audio → AudioView; pdf → embedded; else text. (Host.) */
function QuickLookBody({ path, name }: { path: string; name: string }) {
  if (isImageFile(name)) return <ImageView path={path} name={name} />;
  if (isVideoFile(name)) return <VideoView path={path} name={name} />;
  if (isAudioFile(name)) return <AudioView path={path} name={name} />;
  if (isPdf(name)) return <PdfPreview path={path} name={name} />;
  return <TextPreview path={path} name={name} />;
}

/** Drive preview: text/code files render as themed text (so they're readable in dark mode — a raw
 *  text iframe renders white-on-white); images via the streamed blob in an <img>; everything else
 *  (PDF, native docs exported to PDF, other viewable types) in an <iframe>. A real extension gates the
 *  text path so extensionless Google-native docs (which export to PDF) stay on the iframe. */
function DriveBody({ ref_, name }: { ref_: Ref; name: string }) {
  const account = (ref_ as Extract<Ref, { kind: "drive" }>).accountId;
  const id = (ref_ as Extract<Ref, { kind: "drive" }>).fileId!;
  if (name.includes(".") && isEditableTextName(name)) return <DriveTextPeek account={account} id={id} />;
  return <DriveBlobBody account={account} id={id} name={name} />;
}

/** Fetch a Drive text file's content and show it themed (matches the host TextPreview). */
function DriveTextPeek({ account, id }: { account: string; id: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["drive-text", account, id],
    queryFn: () => api.driveReadText(account, id),
    staleTime: 60_000,
  });
  if (isLoading) return <Centered>Loading…</Centered>;
  if (error || data === undefined) return <Centered>Couldn’t load this file.</Centered>;
  return <pre className="h-full overflow-auto p-4 text-xs leading-relaxed whitespace-pre font-mono text-fg">{data}</pre>;
}

/** The blob path: an authed object URL for images (<img>) and everything else (<iframe>). */
function DriveBlobBody({ account, id, name }: { account: string; id: string; name: string }) {
  const { data: url, isLoading, error } = useQuery({
    queryKey: ["drive-bytes", account, id],
    queryFn: () => api.driveFileUrl(account, id),
    staleTime: 60_000,
  });
  // Revoke the object URL when it changes / the preview unmounts so blobs don't pile up.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (isLoading) return <Centered>Loading…</Centered>;
  if (error || !url) return <Centered>Couldn’t load this file.</Centered>;
  if (isImageFile(name)) {
    return (
      <div className="h-full flex items-center justify-center overflow-auto p-4">
        <img src={url} alt={name} draggable={false} className="max-w-full max-h-full object-contain" />
      </div>
    );
  }
  if (isVideoFile(name)) {
    return (
      <div className="h-full flex items-center justify-center bg-black">
        <video src={url} controls playsInline className="max-w-full max-h-full" />
      </div>
    );
  }
  if (isAudioFile(name)) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-black px-6">
        <div className="text-sm text-bright truncate max-w-[80%] text-center">{name}</div>
        <audio src={url} controls className="w-full max-w-md" />
      </div>
    );
  }
  return <iframe title={name} src={url} className="w-full h-full bg-white" />;
}

function PdfPreview({ path, name }: { path: string; name: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["fs-bytes", path], queryFn: () => api.fsReadFileBytes(path), staleTime: 10_000 });
  if (isLoading) return <Centered>Loading…</Centered>;
  if (error || !data?.dataBase64) return <NoPreview path={path} name={name} reason="Couldn’t read this file." />;
  if (data.tooLarge) return <NoPreview path={path} name={name} reason="File is too large to preview." />;
  return <iframe title={name} src={`data:application/pdf;base64,${data.dataBase64}`} className="w-full h-full bg-white" />;
}

function TextPreview({ path, name }: { path: string; name: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["fs-file", path], queryFn: () => api.fsReadFile(path), staleTime: 10_000 });
  if (isLoading) return <Centered>Loading…</Centered>;
  if (error) return <NoPreview path={path} name={name} reason="Couldn’t read this file." />;
  if (data?.tooLarge) return <NoPreview path={path} name={name} reason="File is too large to preview." />;
  if (data?.binary || data?.content === undefined) return <NoPreview path={path} name={name} reason="No preview available." />;
  return <pre className="h-full overflow-auto p-4 text-xs leading-relaxed whitespace-pre font-mono text-fg">{data.content}</pre>;
}

function NoPreview({ path, name, reason }: { path: string; name: string; reason: string }) {
  const push = useToasts(s => s.push);
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-dim text-sm">
      <div className="truncate max-w-[80%]">{name}</div>
      <div>{reason}</div>
      {isLocalHost && (
        <button onClick={() => api.openPath(path).catch((e: Error) => push(e.message))}
          className="px-3 h-7 inline-flex items-center bg-elevated hover:bg-edge rounded text-xs">Open in default app</button>
      )}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="h-full flex items-center justify-center text-dim text-sm">{children}</div>;
}
