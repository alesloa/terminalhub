// YouTube Data API v3. The API key is the user's own (stored under the `tv_youtube_api_key` setting);
// the routes refuse with {error:'no_key'} when absent rather than faking results. Four endpoints are
// wrapped: search, a playlist's items, a single video's metadata, and a playlist's own title/cover.

export interface YouTubeItem {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  publishedAt: string;
}

export interface YouTubePlaylistInfo {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
}

// playlistItems entries that are gone still carry a resourceId.videoId but a placeholder title — skip them.
const JUNK_TITLES = new Set(["Deleted video", "Private video"]);

/** Pick the best available thumbnail url for a snippet (medium → default → high), "" if none. */
function thumb(snippet: any): string {
  const t = snippet?.thumbnails ?? {};
  return t.medium?.url ?? t.default?.url ?? t.high?.url ?? "";
}

/** PURE: flatten search.list items (id is an OBJECT: id.videoId) to the player's flat shape. */
export function mapYouTubeItems(items: any[]): YouTubeItem[] {
  return items.map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle ?? "",
    thumbnail: thumb(item.snippet),
    publishedAt: item.snippet.publishedAt ?? "",
  }));
}

/** PURE: flatten playlistItems.list. Prefers the video's own uploader (videoOwnerChannelTitle) over the
 *  playlist owner (channelTitle), and drops deleted/private/no-id entries that can't play. */
export function mapPlaylistItems(items: any[]): YouTubeItem[] {
  return items
    .filter((it) => it?.snippet?.resourceId?.videoId && !JUNK_TITLES.has(it.snippet.title))
    .map((it) => ({
      videoId: it.snippet.resourceId.videoId,
      title: it.snippet.title,
      channelTitle: it.snippet.videoOwnerChannelTitle || it.snippet.channelTitle || "",
      thumbnail: thumb(it.snippet),
      publishedAt: it.snippet.publishedAt ?? "",
    }));
}

/** PURE: flatten a videos.list item. NOTE: here `id` is the video-id STRING (not id.videoId). */
export function mapVideo(item: any): YouTubeItem {
  return {
    videoId: item.id,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle ?? "",
    thumbnail: thumb(item.snippet),
    publishedAt: item.snippet.publishedAt ?? "",
  };
}

/** PURE: flatten a playlists.list item to the playlist's own title + cover. */
export function mapPlaylistInfo(item: any): YouTubePlaylistInfo {
  return {
    id: item.id,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle ?? "",
    thumbnail: thumb(item.snippet),
  };
}

export async function searchYouTube(
  key: string,
  q: string,
  pageToken?: string,
): Promise<{ items: YouTubeItem[]; nextPageToken: string | undefined }> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "25");
  url.searchParams.set("q", q);
  url.searchParams.set("key", key);
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const res = await fetch(url.toString());
  const json: any = await res.json();
  return { items: mapYouTubeItems(json.items ?? []), nextPageToken: json.nextPageToken };
}

/** A playlist's videos. Costs 1 quota unit (vs 100 for search). Returns up to 50 + a nextPageToken. */
export async function fetchPlaylistItems(
  key: string,
  playlistId: string,
  pageToken?: string,
): Promise<{ items: YouTubeItem[]; nextPageToken: string | undefined }> {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("playlistId", playlistId);
  url.searchParams.set("key", key);
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const res = await fetch(url.toString());
  const json: any = await res.json();
  return { items: mapPlaylistItems(json.items ?? []), nextPageToken: json.nextPageToken };
}

/** A single video's metadata (for a pasted video link). null when the id isn't found. */
export async function fetchVideo(key: string, videoId: string): Promise<YouTubeItem | null> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", key);
  const res = await fetch(url.toString());
  const json: any = await res.json();
  const item = json.items?.[0];
  return item ? mapVideo(item) : null;
}

/** A playlist's own title + cover (playlistItems does NOT carry the playlist title). null if not found. */
export async function fetchPlaylistInfo(key: string, playlistId: string): Promise<YouTubePlaylistInfo | null> {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", playlistId);
  url.searchParams.set("key", key);
  const res = await fetch(url.toString());
  const json: any = await res.json();
  const item = json.items?.[0];
  return item ? mapPlaylistInfo(item) : null;
}
