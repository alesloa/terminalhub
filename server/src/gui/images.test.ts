import { describe, expect, it } from "vitest";
import { base64Bytes, checkImages, imageContentBlock, MAX_IMAGE_BYTES, MAX_IMAGES_PER_PROMPT } from "./images.js";

const png = (data = "aGVsbG8=") => ({ mediaType: "image/png", dataBase64: data });
/** base64 for `bytes` bytes of payload. */
const payload = (bytes: number) => "A".repeat(Math.ceil(bytes / 3) * 4);

describe("base64Bytes", () => {
  it("counts the decoded length without decoding", () => {
    expect(base64Bytes("")).toBe(0);
    expect(base64Bytes("aGVsbG8=")).toBe(5);   // "hello"
    expect(base64Bytes("aGVsbG8h")).toBe(6);   // "hello!"
    expect(base64Bytes("aGVsbG8hIQ==")).toBe(7);
  });
});

describe("checkImages", () => {
  it("treats a missing attachment list as no attachments", () => {
    expect(checkImages(undefined)).toEqual({ ok: true, images: [] });
    expect(checkImages(null)).toEqual({ ok: true, images: [] });
  });

  it("accepts the four types the API reads", () => {
    for (const mediaType of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(checkImages([{ mediaType, dataBase64: "aGk=" }]).ok).toBe(true);
    }
  });

  it("lowercases the media type so IMAGE/PNG is not rejected", () => {
    const checked = checkImages([{ mediaType: "IMAGE/PNG", dataBase64: "aGk=" }]);
    expect(checked).toEqual({ ok: true, images: [{ mediaType: "image/png", dataBase64: "aGk=" }] });
  });

  it("rejects a type the model cannot read rather than letting the turn fail", () => {
    // A dropped PDF or SVG has to fail here, where it can be explained, not deep inside a turn.
    const checked = checkImages([{ mediaType: "application/pdf", dataBase64: "aGk=" }]);
    expect(checked.ok).toBe(false);
  });

  it("rejects an image over the size ceiling", () => {
    const checked = checkImages([png(payload(MAX_IMAGE_BYTES + 1024))]);
    expect(checked.ok).toBe(false);
  });

  it("accepts one right at the ceiling", () => {
    expect(checkImages([png(payload(MAX_IMAGE_BYTES - 3))]).ok).toBe(true);
  });

  it("rejects more images than a turn is allowed", () => {
    const many = Array.from({ length: MAX_IMAGES_PER_PROMPT + 1 }, () => png());
    expect(checkImages(many).ok).toBe(false);
  });

  it("rejects an attachment with no data", () => {
    expect(checkImages([{ mediaType: "image/png", dataBase64: "" }]).ok).toBe(false);
  });

  it("rejects something that is not a list", () => {
    expect(checkImages({ mediaType: "image/png" }).ok).toBe(false);
  });
});

describe("imageContentBlock", () => {
  it("builds the base64 source block the API expects", () => {
    expect(imageContentBlock({ mediaType: "image/png", dataBase64: "aGk=" })).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "aGk=" },
    });
  });
});
