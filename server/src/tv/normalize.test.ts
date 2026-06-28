import { describe, it, expect } from "vitest";
import { normalizeCatalog, type RawSources } from "./normalize.js";

const raw: RawSources = {
  channels: [
    { id: "BBCNews.uk", name: "BBC News", country: "GB", categories: ["news"], is_nsfw: false },
    { id: "Dead.us", name: "Dead Channel", country: "US", categories: ["news"] }, // blocklisted
    { id: "NoStream.us", name: "No Stream", country: "US", categories: ["movies"] }, // no stream -> dropped
    { id: "Adult.xx", name: "Adult", country: "US", categories: ["xxx"], is_nsfw: true },
  ],
  streams: [
    { channel: "BBCNews.uk", url: "https://cdn/bbc.m3u8", quality: "1080p", referrer: "https://ref", user_agent: "UA/1" },
    { channel: "Dead.us", url: "https://cdn/dead.m3u8" },
    { channel: null, url: "https://cdn/orphan.m3u8" },
    { channel: "Adult.xx", url: "https://cdn/adult.m3u8" },
  ],
  categories: [
    { id: "news", name: "News" },
    { id: "movies", name: "Movies" },
    { id: "xxx", name: "XXX" },
  ],
  countries: [
    { code: "GB", name: "United Kingdom", flag: "🇬🇧", languages: ["eng"] },
    { code: "US", name: "United States", flag: "🇺🇸", languages: ["eng"] },
  ],
  languages: [{ code: "eng", name: "English" }],
  logos: [
    { channel: "BBCNews.uk", url: "https://logo/bbc_small.png", width: 100, height: 100 },
    { channel: "BBCNews.uk", url: "https://logo/bbc_big.png", width: 400, height: 400 },
  ],
  feeds: [{ channel: "BBCNews.uk", is_main: true, languages: ["eng"] }],
  blocklist: [{ channel: "Dead.us" }],
};

describe("normalizeCatalog", () => {
  it("joins streams to their channel", () => {
    const bbc = normalizeCatalog(raw).channels.find((c) => c.id === "BBCNews.uk")!;
    expect(bbc.streams).toEqual([
      { url: "https://cdn/bbc.m3u8", quality: "1080p", referrer: "https://ref", userAgent: "UA/1" },
    ]);
  });

  it("drops orphan streams and channels with no stream", () => {
    const { channels } = normalizeCatalog(raw);
    expect(channels.find((c) => c.id === "NoStream.us")).toBeUndefined();
    expect(channels.some((c) => c.streams.some((s) => s.url.includes("orphan")))).toBe(false);
  });

  it("excludes blocklisted channels", () => {
    expect(normalizeCatalog(raw).channels.find((c) => c.id === "Dead.us")).toBeUndefined();
  });

  it("maps category ids to display names", () => {
    const bbc = normalizeCatalog(raw).channels.find((c) => c.id === "BBCNews.uk")!;
    expect(bbc.categories).toEqual(["News"]);
  });

  it("resolves the country code to name + flag", () => {
    const bbc = normalizeCatalog(raw).channels.find((c) => c.id === "BBCNews.uk")!;
    expect(bbc.country).toEqual({ code: "GB", name: "United Kingdom", flag: "🇬🇧" });
  });

  it("picks the largest logo for a channel", () => {
    const bbc = normalizeCatalog(raw).channels.find((c) => c.id === "BBCNews.uk")!;
    expect(bbc.logo).toBe("https://logo/bbc_big.png");
  });

  it("derives languages from the main feed, named via languages.json", () => {
    const bbc = normalizeCatalog(raw).channels.find((c) => c.id === "BBCNews.uk")!;
    expect(bbc.languages).toEqual(["English"]);
  });

  it("falls back to country languages when a channel has no feed", () => {
    const adult = normalizeCatalog(raw).channels.find((c) => c.id === "Adult.xx")!;
    expect(adult.languages).toEqual(["English"]);
  });

  it("keeps nsfw channels but flags them", () => {
    const adult = normalizeCatalog(raw).channels.find((c) => c.id === "Adult.xx")!;
    expect(adult.isNsfw).toBe(true);
  });

  it("builds facets with per-channel counts over emitted channels", () => {
    const { facets } = normalizeCatalog(raw);
    expect(facets.categories).toContainEqual({ id: "news", name: "News", count: 1 });
    expect(facets.categories).toContainEqual({ id: "xxx", name: "XXX", count: 1 });
    expect(facets.categories.find((c) => c.id === "movies")).toBeUndefined(); // no emitted channel
    expect(facets.countries).toContainEqual({ code: "GB", name: "United Kingdom", flag: "🇬🇧", count: 1 });
    expect(facets.languages).toContainEqual({ code: "eng", name: "English", count: 2 });
  });
});
