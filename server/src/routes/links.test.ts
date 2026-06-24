import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { createStore } from "../db/store.js";
import { createTmuxController } from "../tmux/controller.js";
import { createSessionsController } from "../presence/sessions.js";
import type { Config } from "../config.js";

const config: Config = { port: 0, host: "127.0.0.1", token: "secret", dbPath: ":memory:", fsRoots: null, reveal: null, onetimeBase: null, google: null };

function build() {
  const ctx: any = { store: createStore(":memory:"), tmux: createTmuxController(async () => ""), sessions: createSessionsController() };
  return buildApp(config, ctx);
}

const json = (res: { body: string }) => JSON.parse(res.body);

describe("links routes", () => {
  it("creates, lists, updates, and deletes a link", async () => {
    const app = await build();

    const created = await app.inject({ method: "POST", url: "/api/links", payload: { url: "example.com", title: "Example", description: "a site" } });
    expect(created.statusCode).toBe(200);
    const { link } = json(created);
    expect(link.url).toBe("example.com");
    expect(link.folderId).toBeNull();
    expect(link.sort).toBe(0);

    const listed = await app.inject({ method: "GET", url: "/api/links" });
    expect(json(listed).links).toHaveLength(1);
    expect(json(listed).folders).toHaveLength(0);

    const patched = await app.inject({ method: "PATCH", url: `/api/links/${link.id}`, payload: { title: "Renamed" } });
    expect(patched.statusCode).toBe(200);
    expect(json(patched).link.title).toBe("Renamed");
    expect(json(patched).link.url).toBe("example.com"); // untouched fields preserved

    const del = await app.inject({ method: "DELETE", url: `/api/links/${link.id}` });
    expect(del.statusCode).toBe(200);
    expect(json(await app.inject({ method: "GET", url: "/api/links" })).links).toHaveLength(0);
  });

  it("persists a custom text color on links and folders (and clears it with null)", async () => {
    const app = await build();
    const link = json(await app.inject({ method: "POST", url: "/api/links", payload: { url: "x.com" } })).link;
    const { folder } = json(await app.inject({ method: "POST", url: "/api/link-folders", payload: { name: "Tinted" } }));
    expect(link.color).toBeNull();
    expect(folder.color).toBeNull();

    // Set colors, confirm the PATCH response + a fresh GET both carry them.
    expect(json(await app.inject({ method: "PATCH", url: `/api/links/${link.id}`, payload: { color: "#ff8c00" } })).link.color).toBe("#ff8c00");
    expect(json(await app.inject({ method: "PATCH", url: `/api/link-folders/${folder.id}`, payload: { color: "#3b82f6" } })).folder.color).toBe("#3b82f6");
    const list = json(await app.inject({ method: "GET", url: "/api/links" }));
    expect(list.links[0].color).toBe("#ff8c00");
    expect(list.folders[0].color).toBe("#3b82f6");

    // Other edits leave the color untouched; an explicit null clears it.
    expect(json(await app.inject({ method: "PATCH", url: `/api/links/${link.id}`, payload: { title: "T" } })).link.color).toBe("#ff8c00");
    expect(json(await app.inject({ method: "PATCH", url: `/api/links/${link.id}`, payload: { color: null } })).link.color).toBeNull();
    expect(json(await app.inject({ method: "PATCH", url: `/api/link-folders/${folder.id}`, payload: { color: null } })).folder.color).toBeNull();
  });

  it("404s patch/delete of a missing link", async () => {
    const app = await build();
    expect((await app.inject({ method: "PATCH", url: "/api/links/nope", payload: { title: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/links/nope" })).statusCode).toBe(404);
  });

  it("appends new links with increasing sort within a folder", async () => {
    const app = await build();
    const { folder } = json(await app.inject({ method: "POST", url: "/api/link-folders", payload: { name: "Work" } }));
    const a = json(await app.inject({ method: "POST", url: "/api/links", payload: { url: "a.com", folderId: folder.id } })).link;
    const b = json(await app.inject({ method: "POST", url: "/api/links", payload: { url: "b.com", folderId: folder.id } })).link;
    expect(a.sort).toBe(0);
    expect(b.sort).toBe(1);
    expect(b.folderId).toBe(folder.id);
  });

  it("reorders + re-homes links via PUT /api/links/order", async () => {
    const app = await build();
    const a = json(await app.inject({ method: "POST", url: "/api/links", payload: { url: "a.com" } })).link;
    const b = json(await app.inject({ method: "POST", url: "/api/links", payload: { url: "b.com" } })).link;
    const { folder } = json(await app.inject({ method: "POST", url: "/api/link-folders", payload: { name: "F" } }));

    // Move b into the folder at sort 0, leave a ungrouped at sort 0.
    const res = await app.inject({ method: "PUT", url: "/api/links/order", payload: { items: [
      { id: a.id, folderId: null, sort: 0 },
      { id: b.id, folderId: folder.id, sort: 0 },
    ] } });
    expect(res.statusCode).toBe(200);

    const links = json(await app.inject({ method: "GET", url: "/api/links" })).links as any[];
    expect(links.find((l) => l.id === b.id).folderId).toBe(folder.id);
    expect(links.find((l) => l.id === a.id).folderId).toBeNull();
  });

  it("deleting a folder re-homes its links to ungrouped (non-destructive)", async () => {
    const app = await build();
    const { folder } = json(await app.inject({ method: "POST", url: "/api/link-folders", payload: { name: "Temp" } }));
    const link = json(await app.inject({ method: "POST", url: "/api/links", payload: { url: "keep.com", folderId: folder.id } })).link;

    expect((await app.inject({ method: "DELETE", url: `/api/link-folders/${folder.id}` })).statusCode).toBe(200);

    const data = json(await app.inject({ method: "GET", url: "/api/links" }));
    expect(data.folders).toHaveLength(0);
    expect(data.links).toHaveLength(1);                 // the link survives
    expect(data.links[0].id).toBe(link.id);
    expect(data.links[0].folderId).toBeNull();          // ...now ungrouped
  });

  it("requires a token when exposed (non-loopback)", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/api/links", headers: { "x-forwarded-for": "203.0.113.7" } });
    expect(res.statusCode).toBe(401);
  });
});
