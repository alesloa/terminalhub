import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { createStore } from "../db/store.js";
import { bookmarkRoutes } from "./bookmarks.js";

function build() {
  const ctx = { store: createStore(":memory:") } as any;
  const app = Fastify();
  app.register(async a => bookmarkRoutes(a, ctx));
  const ws = ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
  return { app, ctx, ws };
}

describe("bookmark routes", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  const create = (wsId: string, body: any) =>
    h.app.inject({ method: "POST", url: `/api/workspaces/${wsId}/bookmarks`, payload: body });

  it("creates a bookmark, resolving the folder from the workspace", async () => {
    const res = await create(h.ws.id, { filePath: "/work/a.ts", line: 7, preview: "x" });
    expect(res.statusCode).toBe(200);
    const bm = res.json().bookmark;
    expect(bm.id).toMatch(/^bk_/);
    expect(bm.folder).toBe("/work");
    expect(bm.line).toBe(7);
    expect(bm.label).toBeNull();
  });

  it("creates a labeled bookmark", async () => {
    const bm = (await create(h.ws.id, { filePath: "/work/a.ts", line: 3, label: "TODO" })).json().bookmark;
    expect(bm.label).toBe("TODO");
  });

  it("404s creating a bookmark for an unknown workspace", async () => {
    const res = await create("ws_missing", { filePath: "/work/a.ts", line: 1 });
    expect(res.statusCode).toBe(404);
  });

  it("400s when filePath or line is missing", async () => {
    expect((await create(h.ws.id, { line: 1 })).statusCode).toBe(400);
    expect((await create(h.ws.id, { filePath: "/work/a.ts" })).statusCode).toBe(400);
  });

  it("lists the workspace's bookmarks", async () => {
    await create(h.ws.id, { filePath: "/work/b.ts", line: 2 });
    await create(h.ws.id, { filePath: "/work/a.ts", line: 5 });
    const res = await h.app.inject({ method: "GET", url: `/api/workspaces/${h.ws.id}/bookmarks` });
    expect(res.statusCode).toBe(200);
    expect(res.json().bookmarks.map((b: any) => [b.filePath, b.line])).toEqual([["/work/a.ts", 5], ["/work/b.ts", 2]]);
  });

  it("patches a label", async () => {
    const bm = (await create(h.ws.id, { filePath: "/work/a.ts", line: 1 })).json().bookmark;
    const res = await h.app.inject({ method: "PATCH", url: `/api/bookmarks/${bm.id}`, payload: { label: "note" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().bookmark.label).toBe("note");
  });

  it("patches a line (sticky reconcile)", async () => {
    const bm = (await create(h.ws.id, { filePath: "/work/a.ts", line: 1 })).json().bookmark;
    const res = await h.app.inject({ method: "PATCH", url: `/api/bookmarks/${bm.id}`, payload: { line: 42 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().bookmark.line).toBe(42);
  });

  it("deletes a single bookmark", async () => {
    const bm = (await create(h.ws.id, { filePath: "/work/a.ts", line: 1 })).json().bookmark;
    const res = await h.app.inject({ method: "DELETE", url: `/api/bookmarks/${bm.id}` });
    expect(res.statusCode).toBe(200);
    expect(h.ctx.store.getBookmark(bm.id)).toBeUndefined();
  });

  it("clears one file's bookmarks", async () => {
    await create(h.ws.id, { filePath: "/work/a.ts", line: 1 });
    await create(h.ws.id, { filePath: "/work/a.ts", line: 9 });
    await create(h.ws.id, { filePath: "/work/b.ts", line: 1 });
    const res = await h.app.inject({ method: "DELETE", url: `/api/workspaces/${h.ws.id}/bookmarks?filePath=${encodeURIComponent("/work/a.ts")}` });
    expect(res.statusCode).toBe(200);
    expect(h.ctx.store.listBookmarks("/work").map(b => b.filePath)).toEqual(["/work/b.ts"]);
  });

  it("clears all of a workspace's bookmarks", async () => {
    await create(h.ws.id, { filePath: "/work/a.ts", line: 1 });
    await create(h.ws.id, { filePath: "/work/b.ts", line: 1 });
    const res = await h.app.inject({ method: "DELETE", url: `/api/workspaces/${h.ws.id}/bookmarks` });
    expect(res.statusCode).toBe(200);
    expect(h.ctx.store.listBookmarks("/work")).toHaveLength(0);
  });
});
