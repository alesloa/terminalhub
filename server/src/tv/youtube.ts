// YouTube Data API v3 search. The API key is the user's own (stored under the `tv_youtube_api_key`
// setting); the route refuses with {error:'no_key'} when absent rather than faking results.

export interface YouTubeItem {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  publishedAt: string;
}

/** PURE: flatten the search.list response items to the shape the player needs. */
export function mapYouTubeItems(items: any[]): YouTubeItem[] {
  return items.map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails.medium.url,
    publishedAt: item.snippet.publishedAt,
  }));
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
