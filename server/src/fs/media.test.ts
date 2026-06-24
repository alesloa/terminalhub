import { describe, it, expect } from "vitest";
import { mediaTypeFor, parseRange } from "./media.js";

describe("mediaTypeFor", () => {
  it("maps common video extensions to their MIME type (case-insensitive)", () => {
    expect(mediaTypeFor("clip.mp4")).toBe("video/mp4");
    expect(mediaTypeFor("/a/b/MASTER-DRAFT.MP4")).toBe("video/mp4");
    expect(mediaTypeFor("a.m4v")).toBe("video/mp4");
    expect(mediaTypeFor("a.mov")).toBe("video/quicktime");
    expect(mediaTypeFor("a.webm")).toBe("video/webm");
    expect(mediaTypeFor("a.ogv")).toBe("video/ogg");
    expect(mediaTypeFor("a.mkv")).toBe("video/x-matroska");
  });

  it("maps common audio extensions to their MIME type (case-insensitive)", () => {
    expect(mediaTypeFor("song.mp3")).toBe("audio/mpeg");
    expect(mediaTypeFor("/a/b/TRACK.MP3")).toBe("audio/mpeg");
    expect(mediaTypeFor("a.m4a")).toBe("audio/mp4");
    expect(mediaTypeFor("a.aac")).toBe("audio/aac");
    expect(mediaTypeFor("a.wav")).toBe("audio/wav");
    expect(mediaTypeFor("a.flac")).toBe("audio/flac");
    expect(mediaTypeFor("a.ogg")).toBe("audio/ogg");  // .ogg is treated as audio (Vorbis); .ogv is video
    expect(mediaTypeFor("a.opus")).toBe("audio/ogg");
  });

  it("falls back to octet-stream for the unmapped", () => {
    expect(mediaTypeFor("a.bin")).toBe("application/octet-stream");
    expect(mediaTypeFor("noext")).toBe("application/octet-stream");
  });
});

describe("parseRange", () => {
  const SIZE = 1000;

  it("returns null when there is no Range header or it isn't a bytes range", () => {
    expect(parseRange(undefined, SIZE)).toBeNull();
    expect(parseRange("", SIZE)).toBeNull();
    expect(parseRange("items=0-10", SIZE)).toBeNull();
  });

  it("parses a closed range, clamping the end to the last byte", () => {
    expect(parseRange("bytes=0-99", SIZE)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=200-100000", SIZE)).toEqual({ start: 200, end: 999 });
  });

  it("parses an open-ended range (start to EOF)", () => {
    expect(parseRange("bytes=500-", SIZE)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=0-", SIZE)).toEqual({ start: 0, end: 999 });
  });

  it("parses a suffix range (last N bytes), clamping to the start of file", () => {
    expect(parseRange("bytes=-300", SIZE)).toEqual({ start: 700, end: 999 });
    expect(parseRange("bytes=-5000", SIZE)).toEqual({ start: 0, end: 999 });
  });

  it("reports an unsatisfiable range when the start is past EOF", () => {
    expect(parseRange("bytes=1000-", SIZE)).toBe("unsatisfiable");
    expect(parseRange("bytes=2000-3000", SIZE)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", SIZE)).toBe("unsatisfiable");
  });

  it("returns null for a multi-range request (we serve the whole file instead)", () => {
    expect(parseRange("bytes=0-99,200-299", SIZE)).toBeNull();
  });

  it("returns null for a malformed range", () => {
    expect(parseRange("bytes=", SIZE)).toBeNull();
    expect(parseRange("bytes=abc-def", SIZE)).toBeNull();
    expect(parseRange("bytes=-", SIZE)).toBeNull();
  });
});
