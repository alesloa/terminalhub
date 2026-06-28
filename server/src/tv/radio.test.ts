import { describe, it, expect } from "vitest";
import { normalizeStations } from "./radio.js";

describe("normalizeStations", () => {
  it("maps radio-browser fields onto the station shape", () => {
    const out = normalizeStations([
      {
        stationuuid: "uuid-1",
        name: "Jazz FM",
        favicon: "https://x/fav.png",
        url_resolved: "https://stream/jazz",
        codec: "MP3",
        bitrate: 128,
        countrycode: "GB",
        tags: "jazz, smooth , ",
      },
    ]);
    expect(out).toEqual([
      {
        id: "uuid-1",
        name: "Jazz FM",
        favicon: "https://x/fav.png",
        url: "https://stream/jazz",
        codec: "MP3",
        bitrate: 128,
        country: "GB",
        tags: ["jazz", "smooth"],
      },
    ]);
  });

  it("drops stations with an empty url_resolved", () => {
    const out = normalizeStations([
      { stationuuid: "a", name: "Good", url_resolved: "https://ok", tags: "" },
      { stationuuid: "b", name: "Dead", url_resolved: "", tags: "" },
      { stationuuid: "c", name: "Missing", tags: "" },
    ]);
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });

  it("yields an empty tags array when there are no tags", () => {
    const out = normalizeStations([{ stationuuid: "a", name: "X", url_resolved: "https://ok" }]);
    expect(out[0].tags).toEqual([]);
  });
});
