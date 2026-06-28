import { describe, it, expect } from "vitest";
import { mapYouTubeItems } from "./youtube.js";

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
