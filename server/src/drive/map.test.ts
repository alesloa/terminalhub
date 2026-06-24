import { describe, it, expect } from "vitest";
import { toEntry, exportMimeFor, listQuery } from "./map.js";

describe("drive map", () => {
  it("maps folder/native/binary and picks export mime", () => {
    expect(toEntry({ id: "1", name: "F", mimeType: "application/vnd.google-apps.folder" }).type).toBe("dir");
    const doc = toEntry({ id: "2", name: "Doc", mimeType: "application/vnd.google-apps.document", webViewLink: "https://docs/2" });
    expect(doc).toMatchObject({ type: "file", google: true, webViewLink: "https://docs/2" });
    expect(exportMimeFor("application/vnd.google-apps.document")).toBe("application/pdf");
    expect(exportMimeFor("application/vnd.google-apps.spreadsheet")).toBe("application/pdf");
    expect(toEntry({ id: "3", name: "p.pdf", mimeType: "application/pdf" }).google).toBe(false);
  });

  it("coerces size to a number and defaults missing fields to null", () => {
    const e = toEntry({ id: "5", name: "big.bin", mimeType: "application/octet-stream", size: "2048", modifiedTime: "2026-01-01T00:00:00Z" });
    expect(e.size).toBe(2048);
    expect(e.modifiedTime).toBe("2026-01-01T00:00:00Z");
    const f = toEntry({ id: "6", name: "x", mimeType: "text/plain" });
    expect(f.size).toBeNull();
    expect(f.modifiedTime).toBeNull();
    expect(f.webViewLink).toBeNull();
  });

  it("builds the right q/params per root", () => {
    expect(listQuery({ root: "sharedWithMe" }).q).toContain("sharedWithMe");
    expect(listQuery({ folderId: "abc" }).q).toContain("'abc' in parents");
    expect(listQuery({ root: "myDrive" }).q).toContain("'root' in parents");
  });
});
