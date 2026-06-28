import { describe, it, expect } from "vitest";
import { mapYouTubeItems, mapPlaylistItems, mapVideo, mapPlaylistInfo } from "./youtube.js";

describe("mapYouTubeItems", () => {
  it("maps the search-result shape to a flat item", () => {
    const items = [
      {
        id: { videoId: "abc123" },
        snippet: {
          title: "Live Lo-fi",
          channelTitle: "Lofi Girl",
          publishedAt: "2024-01-02T03:04:05Z",
          thumbnails: { medium: { url: "https://i.ytimg.com/vi/abc123/mq.jpg" } },
        },
      },
    ];
    expect(mapYouTubeItems(items)).toEqual([
      {
        videoId: "abc123",
        title: "Live Lo-fi",
        channelTitle: "Lofi Girl",
        thumbnail: "https://i.ytimg.com/vi/abc123/mq.jpg",
        publishedAt: "2024-01-02T03:04:05Z",
      },
    ]);
  });

  it("returns an empty array for no items", () => {
    expect(mapYouTubeItems([])).toEqual([]);
  });
});

describe("mapPlaylistItems", () => {
  it("maps playlistItems, preferring the video's own uploader over the playlist owner", () => {
    const items = [{
      snippet: {
        title: "Track A",
        channelTitle: "Playlist Owner",
        videoOwnerChannelTitle: "Real Artist",
        publishedAt: "2024-05-01T00:00:00Z",
        thumbnails: { medium: { url: "https://i.ytimg.com/vi/v1/mq.jpg" } },
        resourceId: { videoId: "v1" },
      },
    }];
    expect(mapPlaylistItems(items)).toEqual([{
      videoId: "v1", title: "Track A", channelTitle: "Real Artist",
      thumbnail: "https://i.ytimg.com/vi/v1/mq.jpg", publishedAt: "2024-05-01T00:00:00Z",
    }]);
  });

  it("falls back to channelTitle when videoOwnerChannelTitle is absent", () => {
    const items = [{ snippet: { title: "T", channelTitle: "Owner", resourceId: { videoId: "v" }, thumbnails: { medium: { url: "u" } }, publishedAt: "" } }];
    expect(mapPlaylistItems(items)[0].channelTitle).toBe("Owner");
  });

  it("skips deleted/private entries and items with no videoId", () => {
    const items = [
      { snippet: { title: "Deleted video", channelTitle: "c", publishedAt: "", thumbnails: {}, resourceId: { videoId: "d1" } } },
      { snippet: { title: "Private video", channelTitle: "c", publishedAt: "", thumbnails: {}, resourceId: { videoId: "p1" } } },
      { snippet: { title: "No id", channelTitle: "c", publishedAt: "", thumbnails: {}, resourceId: {} } },
      { snippet: { title: "Good", channelTitle: "c", publishedAt: "", thumbnails: { medium: { url: "u" } }, resourceId: { videoId: "g1" } } },
    ];
    expect(mapPlaylistItems(items).map((i) => i.videoId)).toEqual(["g1"]);
  });
});

describe("mapVideo", () => {
  it("maps a videos.list item whose id is a plain string (not id.videoId)", () => {
    const item = { id: "vid9", snippet: { title: "Solo", channelTitle: "Chan", publishedAt: "2024-01-01T00:00:00Z", thumbnails: { medium: { url: "u9" } } } };
    expect(mapVideo(item)).toEqual({ videoId: "vid9", title: "Solo", channelTitle: "Chan", thumbnail: "u9", publishedAt: "2024-01-01T00:00:00Z" });
  });
});

describe("mapPlaylistInfo", () => {
  it("maps a playlists.list item to id/title/channel/cover", () => {
    const item = { id: "PLabc", snippet: { title: "My Mix", channelTitle: "Me", thumbnails: { medium: { url: "cover" } } } };
    expect(mapPlaylistInfo(item)).toEqual({ id: "PLabc", title: "My Mix", channelTitle: "Me", thumbnail: "cover" });
  });
});
