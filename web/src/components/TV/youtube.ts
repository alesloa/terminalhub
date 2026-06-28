// Classify the YouTube box text: a search term, a video link/id, or a playlist link/id. Pure.
// Only PL/UU/OL/FL/LL playlist ids are fetchable via playlistItems.list — auto-mixes (RD/UL) and
// Watch-Later/Liked (WL/LM) are NOT, so a link carrying both an unfetchable list AND a video falls
// back to playing the single video (the common watch?v=…&list=RD… "mix" case).

export type ParsedInput =
  | { kind: "playlist"; playlistId: string }
  | { kind: "video"; videoId: string }
  | { kind: "search"; query: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const FETCHABLE_PLAYLIST = /^(PL|UU|OL|FL|LL)/;

/** Pull an 11-char video id out of any of YouTube's URL shapes. */
function extractVideoId(s: string): string | null {
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/shorts\/([A-Za-z0-9_-]{11})/,
    /\/embed\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

function extractPlaylistId(s: string): string | null {
  const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export function parseYouTubeInput(raw: string): ParsedInput {
  const text = raw.trim();
  if (!text) return { kind: "search", query: "" };

  const looksLikeUrl = /youtu\.?be|youtube\.com/i.test(text) || /^https?:\/\//i.test(text);
  if (looksLikeUrl) {
    const playlistId = extractPlaylistId(text);
    const videoId = extractVideoId(text);
    if (playlistId && FETCHABLE_PLAYLIST.test(playlistId)) return { kind: "playlist", playlistId };
    if (videoId) return { kind: "video", videoId };
    // an unfetchable list with no video, or an unrecognized YT url → treat the text as a search
    return { kind: "search", query: text };
  }

  if (VIDEO_ID.test(text)) return { kind: "video", videoId: text };
  if (FETCHABLE_PLAYLIST.test(text) && /^[A-Za-z0-9_-]{16,}$/.test(text)) return { kind: "playlist", playlistId: text };
  return { kind: "search", query: text };
}
