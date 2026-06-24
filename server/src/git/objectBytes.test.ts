import { describe, it, expect, vi } from "vitest";
import { gitObjectBytes, type BufferExec } from "./objectBytes.js";

describe("gitObjectBytes", () => {
  it("returns the raw blob bytes of a file at a rev (`git show rev:file`)", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]); // a non-utf8 (image-like) blob
    const exec: BufferExec = vi.fn(async () => ({ buffer: bytes, code: 0 }));
    const got = await gitObjectBytes("/repo", "HEAD", "img.jpg", exec);
    expect(got).toEqual(bytes);
    expect(exec).toHaveBeenCalledWith(["show", "HEAD:img.jpg"], "/repo");
  });

  it("passes an empty rev through as `:file` (the index side)", async () => {
    const exec: BufferExec = vi.fn(async () => ({ buffer: Buffer.from([1]), code: 0 }));
    await gitObjectBytes("/repo", "", "a.png", exec);
    expect(exec).toHaveBeenCalledWith(["show", ":a.png"], "/repo");
  });

  it("returns null when the file is absent at that rev (git exits non-zero)", async () => {
    const exec: BufferExec = vi.fn(async () => ({ buffer: Buffer.alloc(0), code: 128 }));
    expect(await gitObjectBytes("/repo", "abc^", "added.png", exec)).toBeNull();
  });

  it("returns null for an empty blob", async () => {
    const exec: BufferExec = vi.fn(async () => ({ buffer: Buffer.alloc(0), code: 0 }));
    expect(await gitObjectBytes("/repo", "HEAD", "empty.png", exec)).toBeNull();
  });
});
